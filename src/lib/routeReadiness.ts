import { stepsCsvBaseName } from "./parseRouteMasterList";
import type { Route } from "./types";
import type { WaypointCache } from "./waypointCache";

/**
 * Whether every one of a route's own geocodable steps already has an
 * "ok" entry in `cache` - the same rule EditRouteScreen.tsx enforces
 * before letting a route go "active" (see its own canActivate), reused
 * here so RouteListScreen's quick per-row "Activate" action can't
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

/** Fetches a route's own committed sidecar waypoint cache (the one
 * scripts/geocodeRoute.ts writes for real) - a 404 (nothing geocoded
 * yet) resolves to an empty cache, same convention RouteMap.tsx and
 * EditRouteScreen.tsx already use for this exact fetch. */
export async function fetchCommittedWaypointCache(route: Route): Promise<WaypointCache> {
  const baseName = stepsCsvBaseName(route);
  return fetch(`/data/${baseName}-waypoints.json`)
    .then((res): Promise<WaypointCache> | WaypointCache => (res.ok ? res.json() : {}))
    .catch(() => ({}) as WaypointCache);
}
