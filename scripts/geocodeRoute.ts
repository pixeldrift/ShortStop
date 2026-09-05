import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deriveWaypoints } from "../src/lib/deriveWaypoints";
import type { WaypointQuery } from "../src/lib/deriveWaypoints";
import { extractCityState } from "../src/lib/geocode";
import { parseRouteCsvRows } from "../src/lib/parseRouteCsv";
import { parseRouteMasterList, stepsCsvBaseName } from "../src/lib/parseRouteMasterList";
import { parseSchoolsCsv } from "../src/lib/parseSchoolsCsv";
import { resolveGeocodableQuery, resolveSchoolAnchor } from "../src/lib/resolveWaypoint";
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
const DATA_DIR = join(process.cwd(), "public", "data");
const MASTER_LIST_PATH = join(DATA_DIR, "route-master-list.csv");
const SCHOOLS_CSV_PATH = join(DATA_DIR, "schools.csv");
const ENV_LOCAL_PATH = join(process.cwd(), ".env.local");

// Conservative pacing between actual network calls - a cache hit costs
// nothing, so it doesn't wait. Kept from the Nominatim-era 1 req/sec
// limit; both ORS's geocoding quota and Overpass's public instance are
// more generous than that, but there's no need to push it for the
// handful of lookups a route's whole steps sheet has. Applied uniformly
// to every real network call regardless of which of the two services
// (ORS for addresses, Overpass for intersections) answered it.
const RATE_LIMIT_MS = 1100;

// Half-width of the Overpass search box around each route's own school
// address, in degrees - see src/lib/overpassGeocode.ts and README,
// "Maps, part nine", for why this is wide enough to hold a route this
// size without also catching a same-named road elsewhere in the metro
// area. Shared across every route rather than tuned per-route since
// they're all short in-town routes around the same handful of schools.
const SEARCH_RADIUS_DEG = 0.06;

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

/** Refreshes one route's own sidecar waypoint cache
 * (`${baseName}-waypoints.json`) from its own steps CSV
 * (`${baseName}.csv`): derives every row's geocodable location
 * (deriveWaypoints.ts), looks up whichever ones aren't already cached
 * - addresses via ORS, intersections via the Overpass module, an
 * "unresolvable" row (a driver instruction, not a real road - see
 * deriveWaypoints.ts) skipped entirely, spending no query at all - and
 * writes the result back. The steps CSV stays the one source of truth
 * for the route - editing it changes what deriveWaypoints produces,
 * which changes the cache keys (content-addressed, see
 * waypointCacheKey), which is what makes "edit the CSV, re-run this" a
 * real refresh rather than something that needs separate invalidation
 * bookkeeping. Also prunes any cache entry no longer referenced by the
 * current CSV, so the cache file doesn't accumulate cruft from
 * since-edited-away rows. */
async function geocodeRoute(
  baseName: string,
  schoolAddress: string,
  apiKey: string,
): Promise<{ hits: number; fetched: number; failed: number; skipped: number; pruned: number }> {
  const stepsCsvPath = join(DATA_DIR, `${baseName}.csv`);
  const cachePath = join(DATA_DIR, `${baseName}-waypoints.json`);

  const csvText = readFileSync(stepsCsvPath, "utf8");
  const rows = parseRouteCsvRows(csvText);
  const waypoints = deriveWaypoints(rows, schoolAddress);

  const locationContext = extractCityState(schoolAddress);
  if (!locationContext) {
    throw new Error(`Couldn't pull a "City, ST" context out of schoolAddress: "${schoolAddress}"`);
  }

  const skipped = waypoints.filter((w) => w.kind === "unresolvable").length;
  const geocodable = waypoints.filter(
    (w): w is Extract<WaypointQuery, { kind: "address" | "intersection" }> => w.kind !== "unresolvable",
  );

  const currentKeys = new Set(geocodable.map(waypointCacheKey));
  const existingCache: WaypointCache = existsSync(cachePath)
    ? JSON.parse(readFileSync(cachePath, "utf8"))
    : {};
  const prunedCount = Object.keys(existingCache).filter((key) => !currentKeys.has(key)).length;

  const cache: WaypointCache = {};
  for (const key of currentKeys) {
    if (existingCache[key]) cache[key] = existingCache[key];
  }

  let hits = 0;
  let fetched = 0;
  let failed = 0;

  // Only computed (one ORS call) if this route actually has an
  // uncached intersection to resolve - Overpass needs it as the center
  // of its search box, but a route with every intersection already
  // cached, or with none at all, shouldn't spend the call.
  let anchor: { lat: number; lon: number } | null = null;
  let lastResolved: { lat: number; lon: number } | null = null;

  for (const waypoint of geocodable) {
    const key = waypointCacheKey(waypoint);
    const cached = cache[key];
    if (cached) {
      hits++;
      // Only "ok" entries are ever written to the cache (see
      // WaypointCacheEntry's doc comment) - this narrows purely for
      // the type checker's benefit, not a real runtime possibility.
      if (waypoint.kind === "intersection" && cached.status === "ok") {
        lastResolved = { lat: cached.lat, lon: cached.lon };
      }
      continue;
    }

    if (waypoint.kind === "address") {
      const { entry } = await resolveGeocodableQuery(waypoint, {
        locationContext,
        apiKey,
        anchor: null,
        near: null,
        searchRadiusDeg: SEARCH_RADIUS_DEG,
      });
      await sleep(RATE_LIMIT_MS);

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
      continue;
    }

    // From here, waypoint.kind === "intersection" - needs the school's
    // own anchor point (for Overpass's search box), computed lazily the
    // first time one is actually needed. Reuses whatever's already in
    // `cache` under the school address's own key first - a route whose
    // school-parking-lot stop resolves to this same address (see
    // isGenericPlaceholder, deriveWaypoints.ts) already geocoded it
    // moments earlier in this very loop, and re-querying ORS with the
    // exact same text back-to-back isn't just wasteful, it's what
    // actually happened here: a live run came back 403 Forbidden on
    // that literal repeat, not a wording problem or a rate limit this
    // pacing hadn't already covered. Only a genuine cache miss spends a
    // real network call, and its result is written into `cache` under
    // the address's own key too, so a route whose school address never
    // otherwise appears as a waypoint still only ever geocodes it once,
    // this run or any future one.
    if (!anchor) {
      const schoolAddressQuery: WaypointQuery = { stepId: -1, kind: "address", text: schoolAddress };
      const schoolAddressKey = waypointCacheKey(schoolAddressQuery);
      const alreadyCached = cache[schoolAddressKey];
      const { entry: anchorEntry, point } = await resolveSchoolAnchor(
        schoolAddress,
        locationContext,
        apiKey,
        alreadyCached,
      );
      if (!point) {
        throw new Error(
          `Couldn't geocode the school address itself: ${anchorEntry.status === "error" ? anchorEntry.message : "unknown error"}`,
        );
      }
      if (!alreadyCached) {
        cache[schoolAddressKey] = anchorEntry;
        await sleep(RATE_LIMIT_MS);
      }
      anchor = point;
      lastResolved = lastResolved ?? anchor;
    }

    const { entry, resolvedPoint } = await resolveGeocodableQuery(waypoint, {
      locationContext,
      apiKey,
      anchor,
      near: lastResolved,
      searchRadiusDeg: SEARCH_RADIUS_DEG,
    });
    await sleep(RATE_LIMIT_MS);

    if (entry.status === "ok") {
      cache[key] = entry;
      if (resolvedPoint) lastResolved = resolvedPoint;
      fetched++;
      console.log(`  ok    ${key}\n        -> ${entry.lat}, ${entry.lon}`);
    } else {
      failed++;
      console.log(`  FAIL  ${key}\n        "${entry.source}": ${entry.message}`);
    }
  }

  const sortedCache: WaypointCache = Object.fromEntries(
    Object.entries(cache).sort(([a], [b]) => a.localeCompare(b)),
  );
  writeFileSync(cachePath, JSON.stringify(sortedCache, null, 2) + "\n");

  return { hits, fetched, failed, skipped, pruned: prunedCount };
}

/**
 * Refreshes every active route's own sidecar waypoint cache from
 * public/data/route-master-list.csv - one geocodeRoute() call per
 * published row whose steps CSV actually exists on disk (a published
 * row with no steps sheet yet, or with no school address on file, is
 * logged and skipped rather than crashing the whole run - the same
 * kind of gap page.tsx already tolerates for a route whose data isn't
 * ready).
 *
 * Run with `npm run geocode`. Needs an OpenRouteService API key
 * (ORS_API_KEY) - free at openrouteservice.org - either exported in
 * the shell, in a gitignored .env.local, or (in CI) a repository
 * secret. See geocode.ts for why ORS rather than Nominatim for
 * addresses; see overpassGeocode.ts for why Overpass rather than a
 * free-text geocoder for intersections.
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

  const masterList = parseRouteMasterList(readFileSync(MASTER_LIST_PATH, "utf8"));
  const schoolAddresses = parseSchoolsCsv(readFileSync(SCHOOLS_CSV_PATH, "utf8"));
  const publishedRoutes = masterList.filter((route) => route.status === "published");

  let totalHits = 0;
  let totalFetched = 0;
  let totalFailed = 0;
  let totalSkipped = 0;
  let totalPruned = 0;
  let routesProcessed = 0;

  for (const route of publishedRoutes) {
    const baseName = stepsCsvBaseName(route);
    const stepsCsvPath = join(DATA_DIR, `${baseName}.csv`);

    if (!existsSync(stepsCsvPath)) {
      console.log(`Skipping ${baseName} (${route.id}) - no steps CSV at ${stepsCsvPath} yet.\n`);
      continue;
    }

    const schoolAddress = schoolAddresses[route.schoolName];
    if (!schoolAddress) {
      console.log(`Skipping ${baseName} (${route.id}) - no address on file for "${route.schoolName}" in schools.csv.\n`);
      continue;
    }

    console.log(`${baseName} (${route.id}):`);
    const result = await geocodeRoute(baseName, schoolAddress, apiKey);
    routesProcessed++;
    totalHits += result.hits;
    totalFetched += result.fetched;
    totalFailed += result.failed;
    totalSkipped += result.skipped;
    totalPruned += result.pruned;

    console.log(
      `  -> ${result.hits} cached, ${result.fetched} newly geocoded, ${result.failed} failed, ` +
        `${result.skipped} unresolvable (skipped), ${result.pruned} stale entries pruned.\n`,
    );
  }

  console.log(
    `${routesProcessed} route(s) processed. ${totalHits} already cached, ${totalFetched} newly ` +
      `geocoded, ${totalFailed} failed, ${totalSkipped} unresolvable rows skipped, ${totalPruned} ` +
      `stale entries pruned overall.`,
  );
  if (totalFailed > 0) {
    console.log(
      "Failed lookups usually need a wording fix in the route's steps CSV (or the road just isn't " +
        "found) - they'll be retried automatically next run since they weren't cached.",
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
