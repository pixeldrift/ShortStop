import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deriveWaypoints } from "../src/lib/deriveWaypoints";
import { extractCityState, geocodeQuery } from "../src/lib/geocode";
import { parseRouteCsvRows } from "../src/lib/parseRouteCsv";
import { SCHOOL_ADDRESSES } from "../src/lib/placeholderMeta";
import { waypointCacheKey } from "../src/lib/waypointCache";
import type { WaypointCache } from "../src/lib/waypointCache";

// process.cwd(), not __dirname - __dirname's compiled location is
// scripts/.dist/scripts (scripts/tsconfig.json's rootDir spans the
// whole repo, so it doesn't just recompile to scripts/.dist/ the way
// its own source layout might suggest), one level deeper than a
// single ".." accounted for - silently produced the wrong path
// (scripts/.dist/public/... instead of public/...) rather than
// erroring anywhere near its own source. cwd is reliable instead
// because this script only ever runs one way, from the repo root: via
// `npm run geocode`, whether invoked locally or from
// geocode-route.yml's own `run: npm run geocode` step - npm always
// runs package.json scripts with the directory containing that
// package.json (here, the repo root - the only one in this project)
// as cwd, regardless of the caller's own working directory.
const ROUTE_CSV_PATH = join(process.cwd(), "public", "data", "route-125.csv");
const CACHE_PATH = join(process.cwd(), "public", "data", "route-125-waypoints.json");
const ENV_LOCAL_PATH = join(process.cwd(), ".env.local");

// Conservative pacing between actual network calls - a cache hit costs
// nothing, so it doesn't wait. Kept from the Nominatim-era 1 req/sec
// limit; ORS's own geocoding quota is more generous, but there's no
// need to push it for ~20 lookups.
const RATE_LIMIT_MS = 1100;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** This script runs as a plain Node process, not through Next.js, so
 * it doesn't get Next's automatic .env.local loading - a minimal
 * stand-in rather than pulling in a `dotenv` dependency for five lines
 * of parsing. Only fills in keys not already set in the environment,
 * same precedence dotenv itself uses, so a real shell-exported value
 * (e.g. in CI, via `secrets.ORS_API_KEY`) always wins over the file. */
function loadEnvLocal(): void {
  if (!existsSync(ENV_LOCAL_PATH)) return;
  for (const line of readFileSync(ENV_LOCAL_PATH, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
}

/**
 * Refreshes public/data/route-125-waypoints.json from route-125.csv:
 * derives every row's geocodable location (deriveWaypoints.ts), looks
 * up whichever ones aren't already cached, and writes the result back.
 * route-125.csv stays the one source of truth for the route - editing
 * it changes what deriveWaypoints produces, which changes the cache
 * keys (content-addressed, see waypointCacheKey), which is what makes
 * "edit the CSV, re-run this" a real refresh rather than something
 * that needs separate invalidation bookkeeping. Also prunes any cache
 * entry no longer referenced by the current CSV, so the cache file
 * doesn't accumulate cruft from since-edited-away rows.
 *
 * Run with `npm run geocode`. Needs an OpenRouteService API key
 * (ORS_API_KEY) - free at openrouteservice.org - either exported in
 * the shell, in a gitignored .env.local, or (in CI) a repository
 * secret. See geocode.ts for why ORS rather than Nominatim.
 */
async function main() {
  loadEnvLocal();
  const apiKey = process.env.ORS_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ORS_API_KEY isn't set. Get a free key at openrouteservice.org, then either export it, " +
        "put it in a gitignored .env.local (ORS_API_KEY=...), or set it as a repository secret in CI.",
    );
  }

  const csvText = readFileSync(ROUTE_CSV_PATH, "utf8");
  const rows = parseRouteCsvRows(csvText);
  const schoolAddress = SCHOOL_ADDRESSES["Lavergne Lake Elementary"];
  const waypoints = deriveWaypoints(rows, schoolAddress);

  const locationContext = extractCityState(schoolAddress);
  if (!locationContext) {
    throw new Error(`Couldn't pull a "City, ST" context out of schoolAddress: "${schoolAddress}"`);
  }

  const currentKeys = new Set(waypoints.map(waypointCacheKey));
  const existingCache: WaypointCache = existsSync(CACHE_PATH)
    ? JSON.parse(readFileSync(CACHE_PATH, "utf8"))
    : {};
  const prunedCount = Object.keys(existingCache).filter((key) => !currentKeys.has(key)).length;

  const cache: WaypointCache = {};
  for (const key of currentKeys) {
    if (existingCache[key]) cache[key] = existingCache[key];
  }

  let hits = 0;
  let fetched = 0;
  let failed = 0;

  for (const waypoint of waypoints) {
    const key = waypointCacheKey(waypoint);
    if (cache[key]) {
      hits++;
      continue;
    }

    const entry = await geocodeQuery(waypoint, locationContext, apiKey);

    if (entry.status === "ok") {
      cache[key] = entry;
      fetched++;
      console.log(`  ok    ${key}\n        -> ${entry.lat}, ${entry.lon} (${entry.displayName})`);
    } else {
      // Not cached, deliberately - a failure usually means the query
      // wording needs fixing, and leaving it uncached means it's
      // retried on the very next run with no separate cache-clearing
      // step needed, rather than silently staying failed forever.
      failed++;
      console.log(`  FAIL  ${key}\n        "${entry.source}": ${entry.message}`);
    }

    // Only actual network calls need to be rate-limited.
    await sleep(RATE_LIMIT_MS);
  }

  const sortedCache: WaypointCache = Object.fromEntries(
    Object.entries(cache).sort(([a], [b]) => a.localeCompare(b)),
  );
  writeFileSync(CACHE_PATH, JSON.stringify(sortedCache, null, 2) + "\n");

  console.log(
    `\n${hits} already cached, ${fetched} newly geocoded, ${failed} failed, ${prunedCount} stale ` +
      `entries pruned. ${Object.keys(sortedCache).length} total entries written to ${CACHE_PATH}.`,
  );
  if (failed > 0) {
    console.log(
      "Failed lookups usually need a wording fix in route-125.csv (or the road just isn't found) " +
        "- they'll be retried automatically next run since they weren't cached.",
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
