/** A single point along a route's geometry, GeoJSON order: [lon, lat] -
 * NOT [lat, lon]. Every routing provider returns/consumes geometry in
 * this order; only Leaflet (and this app's own WaypointCacheEntry/
 * School fields) use [lat, lon] - see RouteMap.tsx's own conversion at
 * the one place a provider's geometry actually gets drawn. */
export type RouteCoordinate = [lon: number, lat: number];

/** One stop along the route to be routed through, in this app's own
 * [lat, lon] convention (matching WaypointCacheEntry/School) rather
 * than GeoJSON's [lon, lat] - a provider's own implementation is
 * responsible for flipping this to whatever order its real API
 * actually expects (see providers/openrouteservice.ts). */
export interface RouteWaypoint {
  lat: number;
  lon: number;
}

/** The provider-agnostic shape of a route's road geometry - a plain
 * GeoJSON LineString, not tied to any particular provider's own
 * response format or to Leaflet's own [lat, lon] convention (see
 * RouteCoordinate above). This is the one shape every routing provider
 * normalizes its own response down to. */
export interface RouteGeometry {
  type: "LineString";
  coordinates: RouteCoordinate[];
}

/** What a successful routing call hands back - `distanceMeters`/
 * `durationSeconds` are optional since a caller may not need them (or
 * a provider may not report them), `provider` names which one actually
 * served this result, the same "show your work" reasoning
 * WaypointCacheEntry's own `provider` field already documents for
 * geocoding. */
export interface RoutingResult {
  geometry: RouteGeometry;
  distanceMeters?: number;
  durationSeconds?: number;
  provider: string;
}

/**
 * What every routing provider looks like from the outside - callers
 * (src/app/api/route-geometry/route.ts) only ever talk to this shape,
 * never to a specific provider's own request/response format. Swapping
 * which service actually computes route geometry is adding its own
 * file under ./providers/ plus a one-line change in route.ts's own
 * active-provider function, not a change anywhere a route is actually
 * requested - same pattern src/lib/geocode.ts already uses for
 * geocoding providers.
 */
export interface RoutingProvider {
  /** `waypoints` must already be in the route's real travel order
   * (stops/turns/school, however the caller decided to place the
   * school - see RouteMap.tsx) and have at least two entries; a
   * provider rejects rather than silently no-op-ing on anything
   * shorter, since there's no meaningful route to compute from a
   * single point. */
  route(waypoints: RouteWaypoint[]): Promise<RoutingResult>;
}
