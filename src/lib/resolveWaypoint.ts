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
 *
 * `lookupCoordinates` at the bottom is the plain version of the same
 * thing - one address or intersection in, one lat/lon out, no batch
 * bookkeeping - for a caller that just wants a coordinate and doesn't
 * care (and shouldn't need to know) whether that meant a free-text
 * geocoder or an Overpass road-graph query under the hood. Reach for
 * `resolveGeocodableQuery`/`resolveSchoolAnchor` directly instead when
 * resolving a whole route's worth of queries in one pass - they carry
 * an `anchor`/`near` point across many calls, which this one-off
 * wrapper deliberately doesn't bother with.
 */

/** The bounding-box half-width (in degrees) `lookupCoordinates` and
 * src/app/api/geocode/route.ts both search an intersection query
 * within - shared so the two don't drift to different values. Wide
 * enough to comfortably contain a school's attendance zone, narrow
 * enough that two same-named roads in different towns don't collide
 * inside it (see overpassGeocode.ts's own boundingBoxAround). */
export const DEFAULT_SEARCH_RADIUS_DEG = 0.06;

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

/** A single coordinate a caller can plot, log, or otherwise use -
 * `lookupCoordinates`'s own success shape, deliberately smaller than a
 * full `WaypointCacheEntry` (no `source`/cache bookkeeping - this isn't
 * going in a cache file). `provider` is kept, not hidden - which
 * service actually answered ("openrouteservice" or "overpass") is
 * worth surfacing even when the caller doesn't care which one it was,
 * same reasoning as WaypointCacheEntry's own `provider` field. */
export interface LookupResult {
  lat: number;
  lon: number;
  displayName: string;
  provider: string;
}

/** The one address-or-intersection query a standalone caller actually
 * has in hand - everything `resolveGeocodableQuery` needs beyond this
 * (a `stepId` for cache/CSV bookkeeping this caller has no CSV row for
 * at all) is filled in below rather than pushed onto the caller. */
export type CoordinateQuery = { kind: "address"; text: string } | { kind: "intersection"; roadA: string; roadB: string };

/**
 * The plain version of "look this up": one address or cross-street
 * intersection in, one lat/lon out - the caller never sees ORS,
 * Overpass, an API key, a bounding box, or any of the batch-pipeline
 * plumbing (`anchor`/`near`/pacing) resolveGeocodableQuery's own
 * callers have to track. Swapping which service actually answers
 * either kind of query (see geocode.ts/overpassGeocode.ts) never
 * changes this function's signature or what it returns.
 *
 * Server-side only - reads `ORS_API_KEY` straight from the
 * environment, the same secret every other geocoding call in this app
 * relies on staying off the client (see src/app/api/geocode/route.ts's
 * own doc on why).
 *
 * An intersection query still needs a rough point to search near (the
 * same requirement resolveGeocodableQuery has - Overpass searches a
 * bounding box, not the whole planet) - pass one in `anchor` if the
 * caller already has one (e.g. a school's own coordinates, more
 * precise), or leave it out to have this resolve a rough one itself by
 * geocoding `locationContext` (e.g. "La Vergne, TN") as a plain
 * address first. That auto-anchor costs a second geocode call the
 * very first time (none at all for a plain address query, and none on
 * a later call that passes the same anchor back in).
 */
export async function lookupCoordinates(
  query: CoordinateQuery,
  locationContext: string,
  anchor?: { lat: number; lon: number },
): Promise<LookupResult | { error: string }> {
  const apiKey = process.env.ORS_API_KEY;
  if (!apiKey) {
    return { error: "ORS_API_KEY isn't configured on the server - see .env.local.example." };
  }

  if (query.kind === "address") {
    const entry = await geocodeQuery({ stepId: -1, ...query }, locationContext, apiKey);
    return entry.status === "ok"
      ? { lat: entry.lat, lon: entry.lon, displayName: entry.displayName, provider: entry.provider }
      : { error: entry.message };
  }

  let searchAnchor = anchor ?? null;
  if (!searchAnchor) {
    const roughAnchor = await geocodeQuery(
      { stepId: -1, kind: "address", text: locationContext },
      locationContext,
      apiKey,
    );
    if (roughAnchor.status !== "ok") {
      return { error: `Couldn't resolve a search anchor for "${locationContext}": ${roughAnchor.message}` };
    }
    searchAnchor = { lat: roughAnchor.lat, lon: roughAnchor.lon };
  }

  const { entry } = await resolveGeocodableQuery(
    { stepId: -1, ...query },
    { locationContext, apiKey, anchor: searchAnchor, near: searchAnchor, searchRadiusDeg: DEFAULT_SEARCH_RADIUS_DEG },
  );
  return entry.status === "ok"
    ? { lat: entry.lat, lon: entry.lon, displayName: entry.displayName, provider: entry.provider }
    : { error: entry.message };
}
