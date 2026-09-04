import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deriveWaypoints } from "../src/lib/deriveWaypoints";
import { extractCityState, geocodeQuery } from "../src/lib/geocode";
import { parseRouteCsvRows } from "../src/lib/parseRouteCsv";
import { PLACEHOLDER_META } from "../src/lib/placeholderMeta";
import { waypointCacheKey } from "../src/lib/waypointCache";
import type { WaypointCache } from "../src/lib/waypointCache";

const ROUTE_CSV_PATH = join(__dirname, "..", "public", "data", "route-125.csv");
const CACHE_PATH = join(__dirname, "..", "public", "data", "route-125-waypoints.json");

// Nominatim's usage policy: max 1 request/second. Only applied between
// actual network calls - a cache hit costs nothing, so it doesn't wait.
const RATE_LIMIT_MS = 1100;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
 * Run with `npm run geocode`.
 */
async function main() {
  const csvText = readFileSync(ROUTE_CSV_PATH, "utf8");
  const rows = parseRouteCsvRows(csvText);
  const schoolAddress = PLACEHOLDER_META.schoolAddress;
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

    const entry = await geocodeQuery(waypoint, locationContext);

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
      "Failed lookups usually need a wording fix in route-125.csv (or the road just isn't in OSM) " +
        "- they'll be retried automatically next run since they weren't cached.",
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
