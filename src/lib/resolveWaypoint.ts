import { geocodeQuery } from "./geocode";
import type { GeocodableQuery } from "./geocode";
import { boundingBoxAround, pickNearest, resolveIntersection } from "./overpassGeocode";
import type { BoundingBox } from "./overpassGeocode";
import type { WaypointCacheEntry } from "./waypointCache";

/**
 * The "resolve one waypoint for real" logic shared between
 * scripts/geocodeRoute.ts (the batch CLI/CI pipeline) and
 * src/app/api/geocode/route.ts (the Add/Edit Route screen's on-demand
 * "Fetch Location"/"Fetch All Locations" buttons) - split out so it
 * only exists, and can only have the same bug, in one place. Both
 * callers still own their own pacing (a sleep between real network
 * calls) and their own decision about *when* to spend a call at all
 * (a cache hit, an already-known anchor) - this module only knows how
 * to turn one query into one WaypointCacheEntry.
 */

/** Geocodes the school's own address, for anchoring Overpass's search
 * box - reuses `cachedEntry` (an "ok" WaypointCacheEntry keyed to this
 * exact address, if the caller already has one) instead of spending a
 * fresh call, since re-querying ORS with the exact literal text it was
 * just asked came back a real 403 in production (see geocodeRoute.ts's
 * own history) - not a hypothetical optimization. */
export async function resolveSchoolAnchor(
  schoolAddress: string,
  locationContext: string,
  apiKey: string,
  cachedEntry?: WaypointCacheEntry,
): Promise<{ entry: WaypointCacheEntry; point: { lat: number; lon: number } | null }> {
  if (cachedEntry?.status === "ok") {
    return { entry: cachedEntry, point: { lat: cachedEntry.lat, lon: cachedEntry.lon } };
  }
  const entry = await geocodeQuery({ stepId: -1, kind: "address", text: schoolAddress }, locationContext, apiKey);
  return { entry, point: entry.status === "ok" ? { lat: entry.lat, lon: entry.lon } : null };
}

/**
 * Resolves one intersection-kind query against Overpass within `box`,
 * tie-breaking an ambiguous (multi-node) result via pickNearest against
 * `near`, and packages the result as a WaypointCacheEntry.
 */
export async function resolveIntersectionToEntry(
  query: Extract<GeocodableQuery, { kind: "intersection" }>,
  box: BoundingBox,
  near: { lat: number; lon: number },
  locationContext: string,
): Promise<{ entry: WaypointCacheEntry; resolvedPoint: { lat: number; lon: number } | null }> {
  const label = `${query.roadA} & ${query.roadB}`;
  const source = `${query.roadA} and ${query.roadB}, ${locationContext}`;

  try {
    const resolution = await resolveIntersection(query.roadA, query.roadB, box);

    if (resolution.status === "ok") {
      return {
        entry: { status: "ok", lat: resolution.lat, lon: resolution.lon, displayName: label, source, provider: "overpass" },
        resolvedPoint: { lat: resolution.lat, lon: resolution.lon },
      };
    }
    if (resolution.status === "ambiguous") {
      const picked = pickNearest(resolution.candidates, near);
      return {
        entry: { status: "ok", lat: picked.lat, lon: picked.lon, displayName: label, source, provider: "overpass" },
        resolvedPoint: picked,
      };
    }
    return {
      entry: { status: "error", message: "No shared node found in the search box", source, provider: "overpass" },
      resolvedPoint: null,
    };
  } catch (err) {
    return {
      entry: {
        status: "error",
        message: err instanceof Error ? err.message : String(err),
        source,
        provider: "overpass",
      },
      resolvedPoint: null,
    };
  }
}

/** Resolves any one geocodable (address or intersection) query,
 * dispatching to ORS or the Overpass helper above as appropriate - the
 * single entry point both callers actually loop over. `anchor`/`near`
 * are only used (and only need to be non-null) for an intersection
 * query; pass whatever the caller already has for `near` (falls back
 * to `anchor` itself, e.g. on the very first intersection resolved). */
export async function resolveGeocodableQuery(
  query: GeocodableQuery,
  ctx: {
    locationContext: string;
    apiKey: string;
    anchor: { lat: number; lon: number } | null;
    near: { lat: number; lon: number } | null;
    searchRadiusDeg: number;
  },
): Promise<{ entry: WaypointCacheEntry; resolvedPoint: { lat: number; lon: number } | null }> {
  if (query.kind === "address") {
    const entry = await geocodeQuery(query, ctx.locationContext, ctx.apiKey);
    return { entry, resolvedPoint: entry.status === "ok" ? { lat: entry.lat, lon: entry.lon } : null };
  }

  if (!ctx.anchor) {
    throw new Error("resolveGeocodableQuery: an intersection query needs a non-null anchor");
  }
  const box = boundingBoxAround(ctx.anchor.lat, ctx.anchor.lon, ctx.searchRadiusDeg);
  return resolveIntersectionToEntry(query, box, ctx.near ?? ctx.anchor, ctx.locationContext);
}
