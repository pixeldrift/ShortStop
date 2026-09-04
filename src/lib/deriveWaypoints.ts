import type { RawRouteRow } from "./parseRouteCsv";

/** A geocodable location for one route-125.csv row: either a literal
 * street address ("216 Lake Forest Dr"), or a crossroads pair of two
 * road names to resolve as an intersection. `stepId` matches the
 * NavigationStep `id` parseRouteCsv assigns the same row (its index),
 * so a later geocoding pass can write results back onto the right
 * step. */
export type WaypointQuery =
  | { stepId: number; kind: "address"; text: string }
  | { stepId: number; kind: "intersection"; roadA: string; roadB: string };

/** Generic placeholder road names from the paper route sheet that
 * aren't a real, geocodable public road - "School Driveway" is the
 * only one currently in use, standing in for wherever the bus meets
 * the road right at the school. Resolved to the school's own street
 * address instead of a bogus intersection. */
function isGenericPlaceholder(road: string): boolean {
  return /\bdriveway\b/i.test(road);
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
      return { stepId, kind: "address", text: row.fromAt };
    }

    if (row.ontoAt) {
      currentRoad = row.ontoAt;
      return locationFor(row.fromAt, row.ontoAt, schoolAddress, stepId);
    }

    const destination = row.fromAt;
    const waypoint: WaypointQuery = currentRoad
      ? locationFor(currentRoad, destination, schoolAddress, stepId)
      : { stepId, kind: "address", text: destination };
    currentRoad = destination;
    return waypoint;
  });
}
