import { speakRoadNames } from "./speech";

/**
 * Resolving a route's cross-street stops ("Bill Stewart Blvd & Hidden
 * Forest Ln") against OpenStreetMap's actual road graph via the
 * Overpass API - a structured graph query for a node shared by both
 * named roads' ways, rather than free-text search against a general
 * geocoder (which is what geocode.ts's providers do for plain
 * addresses - fine there, but "Road A and Road B, City, ST" sent to a
 * geocoder is still just fuzzy text matching, not a real intersection
 * lookup). Validated in scripts/prototypeOverpassGeocode.ts against
 * route 125's real crossroads (see README, "Maps, part nine") before
 * being promoted here for scripts/geocodeRoute.ts to use in production.
 */

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

// Same courtesy convention as geocode.ts's NOMINATIM_USER_AGENT - a
// live run against overpass-api.de came back 406 Not Acceptable on
// every single query until this was added, so it's not optional in
// practice either, whatever the HTTP spec says 406 is supposed to mean.
const OVERPASS_USER_AGENT = "ShortStop (https://github.com/pixeldrift/ShortStop/issues)";

// Overpass's own public instance rate-limits and occasionally sheds
// load with 429/504 rather than queuing - both worth one retry after a
// pause rather than failing the whole route over a transient blip.
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 5000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface BoundingBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

export function boundingBoxAround(lat: number, lon: number, radiusDeg: number): BoundingBox {
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

/** True for the transient failures worth one retry - a rate-limit
 * (429) or the gateway timing out waiting on an overloaded Overpass
 * instance (504) - as opposed to e.g. a 400 for a malformed query,
 * which would just fail identically again. */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 504;
}

/**
 * Resolves one intersection against Overpass, retrying up to
 * MAX_RETRIES times (with a fixed pause between attempts) on a 429/504,
 * and otherwise throwing immediately - a caller pacing multiple calls
 * (see scripts/geocodeRoute.ts) should still wait its own interval
 * between *successful* calls; this retry is only for a single call
 * that itself came back rate-limited or overloaded.
 */
export async function resolveIntersection(
  roadA: string,
  roadB: string,
  box: BoundingBox,
  fetchImpl: typeof fetch = fetch,
): Promise<IntersectionResolution> {
  const query = buildIntersectionQuery(roadA, roadB, box);

  for (let attempt = 0; ; attempt++) {
    const res = await fetchImpl(OVERPASS_URL, {
      method: "POST",
      body: `data=${encodeURIComponent(query)}`,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": OVERPASS_USER_AGENT,
        Accept: "application/json",
      },
    });

    if (res.ok) {
      const body = (await res.json()) as OverpassResponse;
      return parseIntersectionResponse(body);
    }

    if (isRetryableStatus(res.status) && attempt < MAX_RETRIES) {
      await sleep(RETRY_DELAY_MS);
      continue;
    }

    throw new Error(`Overpass returned ${res.status} ${res.statusText} for "${roadA}" & "${roadB}"`);
  }
}
