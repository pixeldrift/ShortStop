import type { RawRouteRow } from "./parseRouteCsv";

/** A geocodable location for one route-125.csv row: either a literal
 * street address ("216 Lake Forest Dr"), a crossroads pair of two road
 * names to resolve as an intersection, or - when a row's "road" is
 * really a driver instruction rather than a name - "unresolvable",
 * carrying no lookup at all. `stepId` matches the NavigationStep `id`
 * parseRouteCsv assigns the same row (its index), so a later geocoding
 * pass can write results back onto the right step. */
export type WaypointQuery =
  | { stepId: number; kind: "address"; text: string }
  | { stepId: number; kind: "intersection"; roadA: string; roadB: string }
  | { stepId: number; kind: "unresolvable"; description: string };

/** Generic placeholder road names from the paper route sheet that
 * aren't a real, geocodable public road - "School Parking Lot" is the
 * only one currently in use, standing in for wherever the bus meets
 * the road right at the school ("School Driveway" until the school's
 * bus loop turned out to be a parking lot, not a driveway - kept as a
 * synonym here rather than swapped out, in case the sheet uses either
 * wording again later). Resolved to the school's own street address
 * instead of a bogus intersection or a "parking lot" that will never
 * geocode as a named road either. */
function isGenericPlaceholder(road: string): boolean {
  return /\b(driveway|parking lot)\b/i.test(road);
}

/** Route-sheet road descriptions that read like a name but never are -
 * a highway ramp/connector described the way a driver would say it out
 * loud ("Ramp toward Murfreesboro"), not anything with its own real
 * name to look up. Caught here, before ever reaching a geocoder, so it
 * comes back "unresolvable" (skipped entirely - see WaypointQuery
 * above) instead of spending a query only to land on "no match",
 * indistinguishable from a real miss (see README, "Maps, part nine" -
 * this exact case is what that prototype's one genuinely-expected
 * empty result turned out to be). Narrow on purpose - a false positive
 * here silently drops a real, resolvable stop, which is worse than an
 * unresolvable one occasionally still getting queried and failing
 * loudly. Expand the pattern only against another confirmed real
 * case, not preemptively. */
function isUnresolvableDescription(road: string): boolean {
  return /\bramp\b/i.test(road);
}

/** Strips a leading house number off a literal street address, e.g.
 * "216 Lake Forest Dr" -> "Lake Forest Dr", so an address-form stop can
 * still hand later turns a road name to track "the current road" off
 * of. */
function roadNameFromAddress(address: string): string {
  return address.replace(/^\d+\s+/, "");
}

function locationFor(
  roadA: string,
  roadB: string,
  schoolAddress: string,
  stepId: number,
): WaypointQuery {
  if (isUnresolvableDescription(roadA) || isUnresolvableDescription(roadB)) {
    return {
      stepId,
      kind: "unresolvable",
      description: isUnresolvableDescription(roadA) ? roadA : roadB,
    };
  }
  if (isGenericPlaceholder(roadA) || isGenericPlaceholder(roadB)) {
    return { stepId, kind: "address", text: schoolAddress };
  }
  return { stepId, kind: "intersection", roadA, roadB };
}

/**
 * Derives a geocodable location for every turn/stop row - even the
 * ones that only ever named one road on the paper route sheet ("Left,
 * Riverwood Ln", no cross street given, `parseRouteCsv.ts`'s "lone
 * value is the turn's destination" shorthand). A plain turn like that
 * doesn't have a location of its own in isolation - "turn left onto
 * Riverwood Ln" only means something at the specific point the bus was
 * already traveling on some other road and reached Riverwood Ln - so
 * it's derived as the crossroads of *that* road and the turn's own
 * destination.
 *
 * "Current road" tracking rule, applied while walking the rows in
 * order:
 *  - A turn row's current road becomes whichever road it turns onto
 *    (`ontoAt` if given, otherwise `fromAt` per the same shorthand).
 *  - A stop row's current road is the road it's stopped *on* (`fromAt`)
 *    - the cross street (`ontoAt`) is just where along that road the
 *      stop is, not a new heading - except a literal-address stop with
 *      no cross street at all (e.g. "216 Lake Forest Dr"), where the
 *      road name is pulled out of the address itself.
 *
 * Any row that states its own road(s) explicitly always wins over the
 * tracked value (used directly, and also resets it), which also covers
 * a road renaming along its own length with no turn of its own -
 * route-125.csv's "Fergus Rd" turns into "Bill Stewart Rd" (noted on
 * that turn row) a little further down the same physical road, with no
 * turn in between. The tracked road goes stale for those few rows in
 * between (still "Fergus Rd" through the gap), but that's harmless -
 * nothing in that gap needs it - and the very next row that names its
 * own road explicitly (the first Bill Stewart Rd stop) overwrites it
 * immediately rather than ever propagating the stale name forward.
 */
export function deriveWaypoints(rows: RawRouteRow[], schoolAddress: string): WaypointQuery[] {
  let currentRoad: string | null = null;

  return rows.map((row, stepId) => {
    const isStop = row.action.toLowerCase() === "stop";

    if (isStop) {
      if (row.ontoAt) {
        currentRoad = row.fromAt;
        return locationFor(row.fromAt, row.ontoAt, schoolAddress, stepId);
      }
      currentRoad = roadNameFromAddress(row.fromAt);
      if (isUnresolvableDescription(row.fromAt)) {
        return { stepId, kind: "unresolvable", description: row.fromAt };
      }
      return { stepId, kind: "address", text: row.fromAt };
    }

    if (row.ontoAt) {
      currentRoad = row.ontoAt;
      return locationFor(row.fromAt, row.ontoAt, schoolAddress, stepId);
    }

    const destination = row.fromAt;
    let waypoint: WaypointQuery;
    if (isUnresolvableDescription(destination)) {
      waypoint = { stepId, kind: "unresolvable", description: destination };
    } else {
      waypoint = currentRoad
        ? locationFor(currentRoad, destination, schoolAddress, stepId)
        : { stepId, kind: "address", text: destination };
    }
    currentRoad = destination;
    return waypoint;
  });
}
