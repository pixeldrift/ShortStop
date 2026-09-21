/**
 * Pure geometry helpers for tracking a live GPS fix's progress along a
 * route's own road-following line - the shared foundation both GPS
 * auto-advance and time-based navigation prompting build on (see
 * useLiveRouteProgress.ts, the React hook that wraps these around a
 * real watchPosition feed). Framework-agnostic on purpose: nothing
 * here touches React, MapLibre, or the DOM, so it's trivial to sanity-
 * check by hand or from a plain script, unlike a hook.
 *
 * Distinct from RouteMap.tsx's own nearestCoordIndex, which this isn't
 * a replacement for - that one only ever ranks a route line's own
 * points against each other in plain degree-space (good enough to
 * split a drawn line into traveled/remaining), never reports a real
 * distance. Everything below reports real meters, because time-to-
 * maneuver = distance / speed is meaningless in degrees.
 */

export interface LatLon {
  lat: number;
  lon: number;
}

const EARTH_RADIUS_METERS = 6371000;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Real-world great-circle distance between two points, in meters. */
export function haversineMeters(a: LatLon, b: LatLon): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Cumulative distance (meters), walking a route line from its very
 * first point up through each of its own points in turn -
 * cumulative[i] is how far coords[i] itself sits into the route.
 * Computed once per route geometry fetch (routeLine rarely changes
 * once loaded), not per GPS fix - projectOntoRoute below reuses it
 * rather than re-walking the whole line on every single fix. */
export function cumulativeDistances(coords: LatLon[]): number[] {
  const result: number[] = coords.length > 0 ? [0] : [];
  for (let i = 1; i < coords.length; i++) {
    result.push(result[i - 1] + haversineMeters(coords[i - 1], coords[i]));
  }
  return result;
}

/** Projects `point` onto one line segment (segStart -> segEnd) using a
 * local flat-earth (equirectangular) approximation - accurate enough
 * at the scale one route geometry segment ever spans (rarely more
 * than a couple hundred meters between consecutive points from the
 * routing provider), and far simpler than exact great-circle segment
 * projection. `t` is how far along the segment the projection falls,
 * clamped to [0, 1] (0 = segStart, 1 = segEnd) - a point that
 * projects beyond either end of this one segment belongs to a
 * neighboring segment instead, which projectOntoRoute's own loop
 * over every segment already accounts for. */
function projectOntoSegment(
  point: LatLon,
  segStart: LatLon,
  segEnd: LatLon,
): { point: LatLon; t: number } {
  const metersPerDegreeLat = 111320;
  const metersPerDegreeLon = 111320 * Math.cos(toRadians(segStart.lat));

  const toLocalXY = (p: LatLon) => ({
    x: (p.lon - segStart.lon) * metersPerDegreeLon,
    y: (p.lat - segStart.lat) * metersPerDegreeLat,
  });

  const p = toLocalXY(point);
  const end = toLocalXY(segEnd);

  const segLengthSq = end.x * end.x + end.y * end.y;
  const t =
    segLengthSq === 0 ? 0 : Math.max(0, Math.min(1, (p.x * end.x + p.y * end.y) / segLengthSq));

  return {
    point: {
      lat: segStart.lat + (segEnd.lat - segStart.lat) * t,
      lon: segStart.lon + (segEnd.lon - segStart.lon) * t,
    },
    t,
  };
}

export interface RouteProjection {
  /** How far along the route line this point's nearest spot falls, in
   * meters from the route's very first point - the value auto-advance
   * and the prompt scheduler both actually care about. */
  distanceAlongRoute: number;
  /** Real-world distance from `point` itself to that nearest spot on
   * the line - how far off the road this point actually is. Used to
   * decide whether a fix is close enough to the route to trust at all
   * (see useLiveRouteProgress's own onRoute). */
  distanceFromRoute: number;
}

/** Projects `point` onto the route line as a whole - true nearest-
 * point-on-nearest-segment projection, not nearest-vertex-only
 * (RouteMap.tsx's own nearestCoordIndex): a live GPS fix essentially
 * never lands exactly on one of the route geometry's own vertices, and
 * snapping to whichever vertex happens to be closest instead of the
 * nearest point on the nearest segment can misstate progress by
 * however far apart that route's own vertices happen to be spaced -
 * meaningful error for a "is this bus within 50 feet of the turn"
 * decision, not just a cosmetic one. `cumulative` is
 * cumulativeDistances(coords) - passed in rather than recomputed here
 * so a caller checking many fixes against the same route line (every
 * watchPosition callback, for the whole drive) only ever walks the
 * line once, at load time. Returns null only for an empty route line -
 * a single-point line still projects onto that one point. */
export function projectOntoRoute(
  coords: LatLon[],
  cumulative: number[],
  point: LatLon,
): RouteProjection | null {
  if (coords.length === 0) return null;
  if (coords.length === 1) {
    return { distanceAlongRoute: 0, distanceFromRoute: haversineMeters(point, coords[0]) };
  }

  let best: RouteProjection | null = null;
  for (let i = 0; i < coords.length - 1; i++) {
    const { point: onSegment, t } = projectOntoSegment(point, coords[i], coords[i + 1]);
    const distanceFromRoute = haversineMeters(point, onSegment);
    if (best && distanceFromRoute >= best.distanceFromRoute) continue;
    const segmentLength = cumulative[i + 1] - cumulative[i];
    best = {
      distanceAlongRoute: cumulative[i] + t * segmentLength,
      distanceFromRoute,
    };
  }
  return best;
}

export interface WaypointProgress {
  key: string;
  /** This waypoint's own distance-along-route, meters from the
   * route's start - the same units/origin projectOntoRoute reports a
   * live fix's own position in, so the two are directly comparable
   * (subtracting one from the other is "how far until this waypoint,"
   * along the road, not as the crow flies). */
  distanceAlongRoute: number;
}

/** Projects every tracked waypoint onto the route line once, up
 * front - a waypoint's own position along the route never changes for
 * as long as that route's geometry doesn't, so this only needs
 * recomputing when routeLine or the waypoint list itself changes, not
 * on every GPS fix. A waypoint whose own coordinate happens to sit
 * exactly on the line (the overwhelmingly common case - waypoints are
 * usually among the very points the routing provider's own line
 * passes through) projects with distanceFromRoute ~0; one that
 * doesn't (a manually placed pin slightly off the snapped road) still
 * projects to its nearest point on the line, same as a live GPS fix
 * would. */
export function projectWaypoints(
  coords: LatLon[],
  cumulative: number[],
  waypoints: (LatLon & { key: string })[],
): WaypointProgress[] {
  return waypoints.map((waypoint) => {
    const projection = projectOntoRoute(coords, cumulative, waypoint);
    return { key: waypoint.key, distanceAlongRoute: projection?.distanceAlongRoute ?? 0 };
  });
}
