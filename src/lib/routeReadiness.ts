import type { Route } from "./types";
import { resolveRouteCoordinates } from "./waypointCache";
import type { WaypointCache } from "./waypointCache";

/**
 * Whether every one of a route's own geocodable steps already resolves
 * to a real coordinate - an admin's own override (RouteStep.overrideLat/
 * overrideLon), or an "ok" entry in `cache` (resolveRouteCoordinates,
 * walking the route in order the same way live navigation now does, so
 * a step near a known second road crossing is checked against whichever
 * candidate it's actually closest to, not always the pair's own shared
 * base entry). The same rule EditRouteScreen.tsx enforces before
 * letting a route go "published" (see its own canPublish), reused here
 * so RouteListScreen's quick per-row "Publish" action can't bypass it.
 * An "unresolvable" step (see waypointCacheKey's own doc comment for
 * the `unresolvable:` prefix convention) never needed a cache entry in
 * the first place, so it's skipped rather than treated as missing.
 */
export function isRouteFullyResolved(route: Route, cache: WaypointCache): boolean {
  if (route.steps.length === 0) return false;
  const resolved = resolveRouteCoordinates(
    route.steps,
    cache,
    route.schoolLat != null && route.schoolLon != null ? { lat: route.schoolLat, lon: route.schoolLon } : null,
  );
  return route.steps.every(
    (step, i) => step.waypointKey.startsWith("unresolvable:") || resolved[i] != null,
  );
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
