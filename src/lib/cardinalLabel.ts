/** One of a fixed, small vocabulary of labels for telling two real
 * candidate points apart when the same pair of road names legitimately
 * resolves to two different physical spots (a loop road crossing the
 * same other road twice, or two real roads that share enough of a
 * name to look like the same one - see waypointCache.ts's own
 * intersectionVariantKey). Deliberately just these four, not the full
 * compass (NE/NW/SE/SW) or anything open-ended - a driver-facing label
 * only needs to say "not the other one," and a bigger vocabulary would
 * just be more ways to guess wrong for no real gain here. */
export type CardinalLabel = "northern" | "southern" | "eastern" | "western";

/**
 * Labels two points by whichever axis actually separates them -
 * compares |Δlat| against |Δlon| and picks whichever is larger, so a
 * pair separated mostly north-south gets "northern"/"southern" and one
 * separated mostly east-west gets "eastern"/"western", rather than
 * always defaulting to one axis regardless of how the two points
 * actually sit relative to each other. Symmetric and deterministic -
 * the same two points always produce the same two labels, in whichever
 * order they're passed, since each label is derived only from that
 * point's own position relative to the other, not from call order.
 */
export function cardinalLabels(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): { a: CardinalLabel; b: CardinalLabel } {
  const dLat = a.lat - b.lat;
  const dLon = a.lon - b.lon;
  if (Math.abs(dLat) >= Math.abs(dLon)) {
    return dLat >= 0 ? { a: "northern", b: "southern" } : { a: "southern", b: "northern" };
  }
  return dLon >= 0 ? { a: "eastern", b: "western" } : { a: "western", b: "eastern" };
}

/** Plain squared Euclidean distance in degrees - never compared across
 * different pairs at wildly different latitudes (everywhere this is
 * used stays within one route's own small search box), so the usual
 * "longitude degrees are narrower than latitude ones" correction
 * doesn't matter here: only relative ordering within one small
 * comparison set is ever needed, never a real distance. */
export function squaredDistance(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  return (a.lat - b.lat) ** 2 + (a.lon - b.lon) ** 2;
}

/** Which of a small set of already-known candidate points a fresh
 * context point (`near`) actually belongs to - the read-time half of
 * disambiguation: pickNearest (overpassGeocode.ts) picks the right
 * candidate the *first* time a road pair is resolved, but a cache hit
 * never used to run that check again, which is exactly how two real
 * crossings collapsed into one shared point. Every later lookup - this
 * route or any other - runs this against whichever candidates are
 * already on file instead of trusting whichever one happens to be
 * cached under the base key. */
export function nearestLabeledCandidate<T extends { lat: number; lon: number; label: CardinalLabel | null }>(
  candidates: T[],
  near: { lat: number; lon: number },
): T {
  return candidates.reduce((closest, candidate) =>
    squaredDistance(candidate, near) < squaredDistance(closest, near) ? candidate : closest,
  );
}
