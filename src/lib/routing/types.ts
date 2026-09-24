/** A single point along a route's geometry, GeoJSON order: [lon, lat] -
 * NOT [lat, lon]. Every routing provider returns/consumes geometry in
 * this order; this app's own WaypointCacheEntry/School fields use
 * [lat, lon] instead - see RouteMap.tsx's own conversion at the one
 * place a provider's geometry actually gets drawn. */
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
 * response format or to this app's own [lat, lon] convention (see
 * RouteCoordinate above). This is the one shape every routing provider
 * normalizes its own response down to. */
export interface RouteGeometry {
  type: "LineString";
  coordinates: RouteCoordinate[];
}

/** One real driving maneuver along a computed route - Autoroute's own
 * raw material (EditRouteScreen.tsx's compass button), turned into a
 * real RouteStep row once accepted rather than kept as a separate
 * overlay (see README's own Autoroute roadmap entry for why that
 * matters - it has to survive offline/no-ORS-key same as any
 * hand-typed direction). `type` is ORS's own maneuver code - see
 * providers/openrouteservice.ts's own doc comment for the exact
 * mapping this app reads it by; kept as the provider's raw number
 * here (not already translated to this app's own action vocabulary)
 * since that translation is specific to how *this app* wants to word
 * a maneuver, not something every RoutingResult consumer necessarily
 * wants done for it. `point` is this maneuver's own real-world
 * location (RouteCoordinate order, [lon, lat]) - the exact coordinate
 * Autoroute writes into the waypoint cache for the row it becomes, no
 * separate geocoding step needed since ORS already resolved it.
 * `name` is the street this maneuver leads onto, ORS's own "-"
 * placeholder normalized to "" for "no name available" (an unmarked
 * lot, an unnamed connector) rather than a literal hyphen ever
 * reaching a route step's own location text. */
export interface RoutingStep {
  type: number;
  instruction: string;
  name: string;
  point: RouteCoordinate;
}

/** What a successful routing call hands back - `distanceMeters`/
 * `durationSeconds` are optional since a caller may not need them (or
 * a provider may not report them), `provider` names which one actually
 * served this result, the same "show your work" reasoning
 * WaypointCacheEntry's own `provider` field already documents for
 * geocoding. `steps`, when a provider reports them (every real ORS
 * response does), is every maneuver along the way in trip order,
 * always including the boundary Depart (first) and Arrive (last)
 * steps ORS itself always reports for any two-point leg - a caller
 * that only wants the real turns in between (Autoroute) drops those
 * two itself rather than this shape guessing at that for every caller;
 * RouteMap.tsx's own map line, the only other consumer today, ignores
 * this field entirely. */
export interface RoutingResult {
  geometry: RouteGeometry;
  distanceMeters?: number;
  durationSeconds?: number;
  steps?: RoutingStep[];
  /** Every input waypoint's own exact distance-along-route (meters from
   * the route's start), aligned index-for-index with the `waypoints`
   * array `route()` was called with - waypointDistances[0] is always 0
   * (the route's own start), waypointDistances[waypointDistances.length
   * - 1] is the route's own total distance. Straight from the routing
   * engine's own real, per-leg distances (a provider that reports one
   * distance per leg between consecutive input coordinates, ORS
   * included, can always build this by walking a running sum), never a
   * nearest-point search after the fact - this is exact by
   * construction, since `waypoints` is exactly what the engine was
   * asked to route through, in this same order. A caller that used to
   * derive a waypoint's own distance-along-route by projecting its
   * coordinate back onto the returned geometry (routeProgress.ts's own
   * nearestSegmentBearings/projectOntoRoute) should prefer this instead
   * wherever it's available - a route that doubles back and re-crosses
   * the same real corner more than once can make that kind of after-
   * the-fact projection resolve to the wrong pass, since two different
   * waypoints can legitimately sit near the same physical spot; this
   * field carries no such ambiguity, because it was never a guess.
   * Undefined only for a provider that doesn't report per-leg
   * distances at all (not ORS, which always does). */
  waypointDistances?: number[];
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
