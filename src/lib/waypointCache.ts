import type { WaypointQuery } from "./deriveWaypoints";

/** What one geocode attempt returns - a hit, or a miss with a reason.
 * `source` is the exact text sent to the geocoder, `provider` is which
 * one resolved it (e.g. "openrouteservice") - kept on both so a human
 * can see why, and via what service, a lookup did or didn't resolve.
 * That matters now that the active provider is swappable (see
 * geocode.ts) - a cache built under one provider stays clearly labeled
 * as such even after the active one changes. Only "ok" entries actually
 * get persisted to the cache file (see geocodeRoute.ts) - a failure
 * almost always means the query wording needs fixing, so leaving it out
 * of the cache means it's retried on the very next run rather than
 * staying silently failed forever. */
export type WaypointCacheEntry =
  | { status: "ok"; lat: number; lon: number; displayName: string; source: string; provider: string }
  | { status: "error"; message: string; source: string; provider: string };

/** public/data/route-125-waypoints.json's shape: every entry keyed by
 * waypointCacheKey(query) below. In practice only ever holds "ok"
 * entries - see WaypointCacheEntry above. */
export type WaypointCache = Record<string, WaypointCacheEntry>;

/**
 * The cache key for a WaypointQuery - content-addressed, not tied to a
 * row index, which is what makes "edit the CSV, then refresh" work
 * without any separate staleness bookkeeping: a changed row derives a
 * different query, which hashes to a different key, so it's simply a
 * cache miss (geocoded fresh) rather than something that has to be
 * explicitly invalidated. An unchanged row still derives the exact
 * same query it always did, so it keeps hitting the same cache entry
 * indefinitely, however many times the route is re-derived. An
 * intersection's two roads are sorted before joining, so "A & B" and
 * "B & A" - the same real intersection, however the CSV happens to
 * state it on a given row - always resolve to one shared entry rather
 * than two redundant lookups.
 */
export function waypointCacheKey(query: WaypointQuery): string {
  if (query.kind === "address") return `address:${query.text}`;
  const [a, b] = [query.roadA, query.roadB].sort((x, y) => x.localeCompare(y));
  return `intersection:${a} & ${b}`;
}
