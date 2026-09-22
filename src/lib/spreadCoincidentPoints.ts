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
// A deliberately small, fixed real-world radius - just enough that two
// (or more) markers sitting at the exact same physical spot (a route
// that genuinely stops twice at one intersection, from two different
// directions - see WaypointPreviewMap.tsx's own StopPin doc comment)
// read as visibly separate, tappable dots instead of one hiding the
// other entirely. Not meant to represent anything real about where
// each stop is - it's a legibility nudge, not a corrected coordinate.
const SPREAD_RADIUS_METERS = 7;

/**
 * Nudges every point that lands within SAME_LOCATION_THRESHOLD_DEG of
 * at least one other point in `points` outward into a small circle
 * around wherever they all originally sat, instead of leaving them
 * stacked with only whichever one a caller happens to draw last still
 * visible. Groups first (simple greedy clustering - a point joins the
 * first existing group it's within threshold of one member of, or
 * starts a new group of its own), then spreads only groups of 2+
 * evenly around SPREAD_RADIUS_METERS, starting due north and going
 * clockwise - two coincident points end up directly opposite each
 * other (north/south), which reads as cleanly "two things here" at a
 * glance. A point with nothing else nearby comes back at its own real
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
    const anchor = points[group[0]];
    const latCorrection = Math.cos((anchor.lat * Math.PI) / 180);
    group.forEach((index, position) => {
      const angle = (2 * Math.PI * position) / group.length;
      const dLat = (SPREAD_RADIUS_METERS * Math.cos(angle)) / METERS_PER_DEGREE_LAT;
      const dLon =
        (SPREAD_RADIUS_METERS * Math.sin(angle)) / (METERS_PER_DEGREE_LAT * latCorrection);
      result[index].lat = anchor.lat + dLat;
      result[index].lon = anchor.lon + dLon;
    });
  }
  return result;
}
