import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deriveWaypoints } from "../src/lib/deriveWaypoints";
import type { WaypointQuery } from "../src/lib/deriveWaypoints";
import { extractCityState, geocodeQuery } from "../src/lib/geocode";
import { boundingBoxAround, pickNearest, resolveIntersection } from "../src/lib/overpassGeocode";
import { parseRouteCsvRows } from "../src/lib/parseRouteCsv";
import { parseSchoolsCsv } from "../src/lib/parseSchoolsCsv";

/**
 * One-off re-test harness for the Overpass intersection lookup in
 * src/lib/overpassGeocode.ts (the same module scripts/geocodeRoute.ts
 * now uses in production) - not itself part of the production
 * pipeline. Useful for re-checking a specific road name fix (via
 * PROTOTYPE_FILTER) without spending a full route's worth of calls, or
 * for inspecting raw results in scripts/prototype-overpass-results.json.
 * Tests whether resolving a route's cross-street stops ("Bill Stewart
 * Blvd & Hidden Forest Ln") against OpenStreetMap's actual road graph
 * works better than treating them as free-text search against a
 * general geocoder (ORS/Nominatim's /geocode/search, which is what
 * geocode.ts's providers do for plain addresses - fine there, but "Road
 * A and Road B, City, ST" sent to a geocoder is still just fuzzy text
 * matching, not a real intersection lookup).
 *
 * The approach: geocode the school's own real address once (the
 * existing ORS provider still does this fine - it's a normal address,
 * not a cross-street), use that point as the center of a bounding box
 * for every Overpass query on this route, then for each intersection
 * ask Overpass for a node that's a member of BOTH named roads' ways
 * within that box - a structured graph query against the real road
 * network, not text search. This is what answers "does starting from a
 * known address help": not by resolving stops one at a time in
 * sequence, but by giving every query (independently, in any order) the
 * right neighborhood to search in, so a same-named road elsewhere in
 * the metro area can't produce a wrong match.
 *
 * Run with: npx tsx scripts/prototypeOverpassGeocode.ts
 * (no ORS_API_KEY needed for the Overpass calls themselves - only the
 * one-time school-address geocode still uses ORS, same as
 * scripts/geocodeRoute.ts.)
 */

const ROUTE_CSV_PATH = join(process.cwd(), "public", "data", "125-PM-EL.csv");
const SCHOOLS_CSV_PATH = join(process.cwd(), "public", "data", "schools.csv");
const OUTPUT_PATH = join(process.cwd(), "scripts", "prototype-overpass-results.json");
const ENV_LOCAL_PATH = join(process.cwd(), ".env.local");

// Half-width of the search box around the school's own geocoded point,
// in degrees - route 125 is 8.4 miles round trip (see
// route-master-list.csv), so every stop is well within this. Roughly
// 0.06° latitude / 0.075° longitude ≈ 4-5 miles at this latitude - wide
// enough to hold the whole route, narrow enough that a same-named road
// clear across the metro area shouldn't fall inside it.
const SEARCH_RADIUS_DEG = 0.06;

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

async function main() {
  loadEnvLocal();
  const apiKey = process.env.ORS_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ORS_API_KEY isn't set - still needed for the one-time school-address geocode this " +
        "prototype anchors its search box on (see scripts/geocodeRoute.ts for how to set it).",
    );
  }

  const csvText = readFileSync(ROUTE_CSV_PATH, "utf8");
  const rows = parseRouteCsvRows(csvText);
  const schoolAddresses = parseSchoolsCsv(readFileSync(SCHOOLS_CSV_PATH, "utf8"));
  const schoolAddress = schoolAddresses["Lavergne Lake Elementary"]?.address;
  const waypoints = deriveWaypoints(rows, schoolAddress);

  const locationContext = extractCityState(schoolAddress);
  if (!locationContext) {
    throw new Error(`Couldn't pull a "City, ST" context out of schoolAddress: "${schoolAddress}"`);
  }

  console.log(`Anchoring on: ${schoolAddress}`);
  const anchor = await geocodeQuery({ stepId: -1, kind: "address", text: schoolAddress }, locationContext, apiKey);
  if (anchor.status !== "ok") {
    throw new Error(`Couldn't geocode the school address itself: ${anchor.message}`);
  }
  console.log(`  -> ${anchor.lat}, ${anchor.lon}`);

  const box = boundingBoxAround(anchor.lat, anchor.lon, SEARCH_RADIUS_DEG);
  console.log(
    `Search box: (${box.south.toFixed(4)}, ${box.west.toFixed(4)}) to ` +
      `(${box.north.toFixed(4)}, ${box.east.toFixed(4)})\n`,
  );

  const allIntersections = waypoints.filter(
    (w): w is WaypointQuery & { kind: "intersection" } => w.kind === "intersection",
  );

  // Optional: re-test just the intersections naming one road, instead
  // of the whole route - useful after fixing a specific name mismatch
  // (see README, "Maps, part nine") without re-spending calls (and
  // rate-limit risk) on ones already known to resolve or not.
  const filter = process.env.PROTOTYPE_FILTER?.toLowerCase();
  const intersections = filter
    ? allIntersections.filter(
        (w) => w.roadA.toLowerCase().includes(filter) || w.roadB.toLowerCase().includes(filter),
      )
    : allIntersections;

  if (filter) {
    console.log(`Filter: only intersections naming "${process.env.PROTOTYPE_FILTER}"`);
    console.log(`  -> ${intersections.length} of ${allIntersections.length} total\n`);
  }

  let lastResolved = { lat: anchor.lat, lon: anchor.lon };
  const results: Record<string, unknown>[] = [];

  for (const waypoint of intersections) {
    const label = `${waypoint.roadA} & ${waypoint.roadB}`;
    try {
      const resolution = await resolveIntersection(waypoint.roadA, waypoint.roadB, box, fetch);

      if (resolution.status === "ok") {
        console.log(`  ok        ${label}\n            -> ${resolution.lat}, ${resolution.lon}`);
        lastResolved = { lat: resolution.lat, lon: resolution.lon };
        results.push({ label, status: "ok", lat: resolution.lat, lon: resolution.lon });
      } else if (resolution.status === "ambiguous") {
        const picked = pickNearest(resolution.candidates, lastResolved);
        console.log(
          `  ambiguous ${label}\n            ${resolution.candidates.length} shared nodes - ` +
            `picked ${picked.lat}, ${picked.lon} (closest to last-resolved point)`,
        );
        lastResolved = picked;
        results.push({
          label,
          status: "ambiguous",
          candidates: resolution.candidates,
          picked,
        });
      } else {
        console.log(`  NONE      ${label}\n            no shared node found in the search box`);
        results.push({ label, status: "none" });
      }
    } catch (err) {
      console.log(`  FAIL      ${label}\n            ${err instanceof Error ? err.message : err}`);
      results.push({ label, status: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  writeFileSync(OUTPUT_PATH, JSON.stringify({ anchor, box, results }, null, 2) + "\n");
  const okCount = results.filter((r) => r.status === "ok").length;
  console.log(
    `\n${okCount}/${intersections.length} intersections resolved to exactly one node. ` +
      `Full results written to ${OUTPUT_PATH}.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
