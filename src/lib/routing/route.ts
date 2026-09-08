import { openRouteServiceProvider } from "./providers/openrouteservice";
import type { RouteWaypoint, RoutingProvider, RoutingResult } from "./types";

export type { RouteCoordinate, RouteGeometry, RouteWaypoint, RoutingProvider, RoutingResult } from "./types";

/** The active routing provider - every caller in the app goes through
 * `computeRouteGeometry` below, never a specific provider's own module
 * directly. Swapping which service actually computes route geometry
 * (Valhalla, OSRM, a future one) means adding its own file under
 * ./providers/ and changing this one function - same pattern
 * src/lib/geocode.ts already uses for geocoding providers (see its own
 * `geocodeQuery` assignment). Reads ORS_API_KEY itself rather than
 * taking it as a parameter, same as geocode.ts's route handler already
 * does - there's only ever one real caller (src/app/api/route-geometry/
 * route.ts), so there's no other call site this would need to be
 * threaded through. */
function activeProvider(): RoutingProvider {
  const apiKey = process.env.ORS_API_KEY;
  if (!apiKey) {
    throw new Error("ORS_API_KEY is not configured - road-following route geometry needs it.");
  }
  return openRouteServiceProvider(apiKey);
}

/** Road-following geometry for an ordered list of waypoints, via
 * whichever provider is currently active (see activeProvider above) -
 * the one function src/app/api/route-geometry/route.ts actually calls,
 * so that route handler doesn't need to know a specific provider
 * exists at all. */
export function computeRouteGeometry(waypoints: RouteWaypoint[]): Promise<RoutingResult> {
  return activeProvider().route(waypoints);
}
