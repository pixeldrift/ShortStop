import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deriveWaypoints } from "../src/lib/deriveWaypoints";
import type { WaypointQuery } from "../src/lib/deriveWaypoints";
import { extractCityState, geocodeQuery } from "../src/lib/geocode";
import { parseRouteCsvRows } from "../src/lib/parseRouteCsv";
import { parseSchoolsCsv } from "../src/lib/parseSchoolsCsv";
import { speakRoadNames } from "../src/lib/speech";

/**
 * PROTOTYPE - not wired into the app or scripts/geocodeRoute.ts. Tests
 * whether resolving a route's cross-street stops ("Bill Stewart Rd &
 * Hidden Forest Ln") against OpenStreetMap's actual road graph (via the
 * Overpass API) works better than treating them as free-text search
 * against a general geocoder (ORS/Nominatim's /geocode/search, which is
 * what geocode.ts's providers do today - fine for real addresses, but
 * "Road A and Road B, City, ST" is still just fuzzy text matching, not
 * a real intersection lookup).
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

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

// Same courtesy convention as geocode.ts's NOMINATIM_USER_AGENT - a
// live run against overpass-api.de came back 406 Not Acceptable on
// every single query until this was added, so it's not optional in
// practice either, whatever the HTTP spec says 406 is supposed to mean.
const OVERPASS_USER_AGENT = "ShortStop-prototype (https://github.com/pixeldrift/ShortStop/issues)";

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

interface BoundingBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

function boundingBoxAround(lat: number, lon: number, radiusDeg: number): BoundingBox {
  return {
    south: lat - radiusDeg,
    north: lat + radiusDeg,
    west: lon - radiusDeg * 1.25, // longitude degrees are narrower than latitude at this latitude
    east: lon + radiusDeg * 1.25,
  };
}

/** Overpass QL's own bbox filter is "(south,west,north,east)". */
function bboxFilter(box: BoundingBox): string {
  return `(${box.south},${box.west},${box.north},${box.east})`;
}

/** Escapes a road name for use inside an Overpass regex tag filter -
 * only characters that are actually regex-special in the handful of
 * real road names this route has (currently none need it, but a road
 * with a "." like "St. Something" would). */
function escapeForRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Builds the Overpass QL query for "find a node that's part of both
 * roadA's and roadB's ways, inside this box" - the standard
 * street-intersection recipe (node(w.a)(w.b) intersects two way sets by
 * shared membership). Road names are expanded the same way
 * speakRoadNames does for TTS ("Rd" -> "Road") since OSM's own `name`
 * tags are almost always spelled out in full, not abbreviated the way
 * the paper route sheet is - matching case-insensitively (the ",i"
 * flag) so capitalization differences don't matter either.
 */
export function buildIntersectionQuery(roadA: string, roadB: string, box: BoundingBox): string {
  const nameA = escapeForRegex(speakRoadNames(roadA));
  const nameB = escapeForRegex(speakRoadNames(roadB));
  const box_ = bboxFilter(box);

  return (
    `[out:json][timeout:25];\n` +
    `way["name"~"^${nameA}$",i]${box_}->.a;\n` +
    `way["name"~"^${nameB}$",i]${box_}->.b;\n` +
    `node(w.a)(w.b);\n` +
    `out body;`
  );
}

interface OverpassNode {
  type: "node";
  id: number;
  lat: number;
  lon: number;
}

interface OverpassResponse {
  elements: OverpassNode[];
}

export type IntersectionResolution =
  | { status: "ok"; lat: number; lon: number; candidateCount: 1 }
  | { status: "ambiguous"; candidates: { lat: number; lon: number }[] }
  | { status: "none" };

/** Picks the closest candidate to `near` when Overpass returns more
 * than one shared node (two roads can legitimately cross twice, or a
 * road can split into multiple OSM ways that each touch the other
 * road) - this is the one place "start from a known point and go
 * step by step" actually earns its keep: not for the initial lookup,
 * but as a tie-breaker using wherever the route was last resolved to. */
export function pickNearest(
  candidates: { lat: number; lon: number }[],
  near: { lat: number; lon: number },
): { lat: number; lon: number } {
  return candidates.reduce((closest, candidate) => {
    const d = (a: { lat: number; lon: number }) => (a.lat - near.lat) ** 2 + (a.lon - near.lon) ** 2;
    return d(candidate) < d(closest) ? candidate : closest;
  });
}

export function parseIntersectionResponse(body: OverpassResponse): IntersectionResolution {
  const nodes = body.elements.filter((el) => el.type === "node");
  if (nodes.length === 0) return { status: "none" };
  if (nodes.length === 1) {
    return { status: "ok", lat: nodes[0].lat, lon: nodes[0].lon, candidateCount: 1 };
  }
  return { status: "ambiguous", candidates: nodes.map((n) => ({ lat: n.lat, lon: n.lon })) };
}

async function resolveIntersection(
  roadA: string,
  roadB: string,
  box: BoundingBox,
  fetchImpl: typeof fetch,
): Promise<IntersectionResolution> {
  const query = buildIntersectionQuery(roadA, roadB, box);
  const res = await fetchImpl(OVERPASS_URL, {
    method: "POST",
    body: `data=${encodeURIComponent(query)}`,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": OVERPASS_USER_AGENT,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`Overpass returned ${res.status} ${res.statusText} for "${roadA}" & "${roadB}"`);
  }
  const body = (await res.json()) as OverpassResponse;
  return parseIntersectionResponse(body);
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
  const schoolAddress = schoolAddresses["Lavergne Lake Elementary"];
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

  const intersections = waypoints.filter(
    (w): w is WaypointQuery & { kind: "intersection" } => w.kind === "intersection",
  );

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
