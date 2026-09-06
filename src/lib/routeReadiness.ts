import type { Route } from "./types";
import type { WaypointCache } from "./waypointCache";

/**
 * Whether every one of a route's own geocodable steps already has an
 * "ok" entry in `cache` - the same rule EditRouteScreen.tsx enforces
 * before letting a route go "published" (see its own canPublish),
 * reused here so RouteListScreen's quick per-row "Publish" action can't
 * bypass it. Reads each step's own precomputed `waypointKey`
 * (parseRouteCsv.ts) directly rather than re-deriving waypoints from
 * scratch - an "unresolvable" key (see waypointCacheKey's own doc
 * comment for the `unresolvable:` prefix convention) never needed a
 * cache entry in the first place, so it's skipped rather than treated
 * as missing.
 */
export function isRouteFullyResolved(route: Route, cache: WaypointCache): boolean {
  if (route.steps.length === 0) return false;
  return route.steps.every((step) => {
    if (step.waypointKey.startsWith("unresolvable:")) return true;
    return cache[step.waypointKey]?.status === "ok";
  });
}

/** Fetches the geocode cache from Postgres (see src/app/api/waypoints)
 * - a fetch failure resolves to an empty cache, same convention
 * RouteMap.tsx and EditRouteScreen.tsx already use for this. No longer
 * takes a `route` - the cache is shared across every route now rather
 * than split into a sidecar file per route, so there's no per-route
 * identity left to fetch by. */
export async function fetchCommittedWaypointCache(): Promise<WaypointCache> {
  return fetch("/api/waypoints")
    .then((res): Promise<WaypointCache> | WaypointCache => (res.ok ? res.json() : {}))
    .catch(() => ({}) as WaypointCache);
}
