/** ~0.0003 degrees of latitude is roughly 30m - comfortably smaller
 * than the gap between two genuinely different intersections on a
 * normal street grid, but bigger than the kind of noise two separate
 * geocodes of "the same corner" tend to produce. Shared by every
 * caller that needs a "basically the same spot or not" check - a plain
 * box comparison, not a real haversine distance, since none of them
 * need more than that. */
export const SAME_LOCATION_THRESHOLD_DEG = 0.0003;

export function isSameLocation(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): boolean {
  return (
    Math.abs(a.lat - b.lat) < SAME_LOCATION_THRESHOLD_DEG &&
    Math.abs(a.lon - b.lon) < SAME_LOCATION_THRESHOLD_DEG
  );
}

const METERS_PER_DEGREE_LAT = 111_320;
// A deliberately small, fixed real-world distance - just enough that
// two (or more) markers sitting at the exact same physical spot (a
// route that genuinely stops twice at one intersection, from two
// different directions - see WaypointPreviewMap.tsx's own StopPin doc
// comment) read as visibly separate, tappable dots instead of one
// hiding the other entirely. Not meant to represent anything real
// about where each stop is - it's a legibility nudge, not a corrected
// coordinate.
const ROUTE_SIDE_OFFSET_METERS = 6;

function destinationPoint(
  from: { lat: number; lon: number },
  bearingDeg: number,
  distanceMeters: number,
): { lat: number; lon: number } {
  const latCorrection = Math.cos((from.lat * Math.PI) / 180);
  const rad = (bearingDeg * Math.PI) / 180;
  const dLat = (distanceMeters * Math.cos(rad)) / METERS_PER_DEGREE_LAT;
  const dLon = (distanceMeters * Math.sin(rad)) / (METERS_PER_DEGREE_LAT * latCorrection);
  return { lat: from.lat + dLat, lon: from.lon + dLon };
}

/** Spreads a single coincident group around its own anchor point in a
 * small circle, starting due north and going clockwise - the one
 * fallback this still needs for a group with no real bearing to match
 * against (see spreadCoincidentPoints below), which is otherwise
 * unreachable in this app (every caller only ever has a group of
 * coincident *resolved* stops once a route line exists to draw
 * between them). Two coincident points end up directly opposite each
 * other (north/south), which reads as cleanly "two things here" at a
 * glance even with no direction to go on. */
function spreadInCircle<T extends { lat: number; lon: number }>(
  points: readonly T[],
  group: number[],
  result: T[],
): void {
  const anchor = points[group[0]];
  group.forEach((index, position) => {
    const angle = (360 * position) / group.length;
    result[index] = { ...points[index], ...destinationPoint(anchor, angle, ROUTE_SIDE_OFFSET_METERS) };
  });
}

/**
 * Nudges every point that lands within SAME_LOCATION_THRESHOLD_DEG of
 * at least one other point in `points` off the road's own centerline
 * and onto whichever side of it `bearings[i]` (that point's own real
 * direction of travel along the route, from
 * routeProgress.ts's own nearestSegmentBearings - see that function's
 * doc comment for why it has to be computed over the *full* ordered
 * trip, not just this caller's own coincident candidates, and why
 * that's what actually tells two visits to the same real corner
 * apart) says the route line itself draws that stop's own pass on -
 * the same side RouteMap.tsx/WaypointPreviewMap.tsx's own
 * ROUTE_LINE_OFFSET rendering already shifts the line itself onto
 * (mapEngine.ts's own doc comment on that constant). A route that
 * doubles back and stops twice at one real intersection, once from
 * each direction, lands each stop on the opposite real side of the
 * road this way - reading as "two separate stops on two separate
 * passes," the same story the route line's own offset already tells,
 * instead of an arbitrary clock position with no relation to the road
 * a driver actually sees. Two coincident stops that share (nearly) the
 * same direction of travel - the same pass, not a double-back - can't
 * be told apart by side alone, so each successive point sharing a
 * bearing bucket gets pushed further out than the last, still visibly
 * apart rather than stacked.
 *
 * Groups first (simple greedy clustering - a point joins the first
 * existing group it's within threshold of one member of, or starts a
 * new group of its own), then offsets only groups of 2+; a group whose
 * members don't all have a real bearing (bearings[i] null or missing -
 * either a route with no line to speak of yet, or a caller that hasn't
 * threaded one through for that point) falls back to spreadInCircle
 * instead. A point with nothing else nearby comes back at its own real
 * coordinate, unchanged.
 *
 * Order-preserving and shape-preserving - result[i] is always a shallow
 * copy of points[i] with only lat/lon possibly adjusted, so a caller
 * can zip the result straight back against whatever per-point metadata
 * (a row index, a stop number...) it already tracks alongside the same
 * array, the same way WaypointPreviewMap.tsx's own StopPin or
 * RouteMap.tsx's own ordered-waypoint entries already carry that
 * outside of lat/lon.
 */
export function spreadCoincidentPoints<T extends { lat: number; lon: number }>(
  points: readonly T[],
  bearings: readonly (number | null)[] = [],
): T[] {
  const groupOf = new Array<number>(points.length).fill(-1);
  const groups: number[][] = [];
  for (let i = 0; i < points.length; i++) {
    if (groupOf[i] !== -1) continue;
    const group = [i];
    groupOf[i] = groups.length;
    for (let j = i + 1; j < points.length; j++) {
      if (groupOf[j] === -1 && isSameLocation(points[i], points[j])) {
        group.push(j);
        groupOf[j] = groups.length;
      }
    }
    groups.push(group);
  }

  const result = points.map((p) => ({ ...p }));
  for (const group of groups) {
    if (group.length < 2) continue;

    if (group.some((index) => bearings[index] == null)) {
      spreadInCircle(points, group, result);
      continue;
    }

    // Rounded to the nearest 30 degrees - two stops on the same pass
    // (bearings a few degrees apart from independent geocodes of "the
    // same corner") share a bucket and stack outward; two stops on
    // opposite passes of a double-back (roughly 180 degrees apart)
    // never do, so they simply land on their own two real sides with
    // no stacking needed.
    const bucketCounts = new Map<number, number>();
    group.forEach((index) => {
      const bearing = bearings[index] as number;
      const bucket = Math.round(bearing / 30);
      const stackPosition = bucketCounts.get(bucket) ?? 0;
      bucketCounts.set(bucket, stackPosition + 1);
      const rightOfTravel = (bearing + 90) % 360;
      const distance = ROUTE_SIDE_OFFSET_METERS * (stackPosition + 1);
      result[index] = { ...points[index], ...destinationPoint(points[index], rightOfTravel, distance) };
    });
  }
  return result;
}
