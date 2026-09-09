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
 * a highway ramp/connector or a roundabout described the way a driver
 * would say it out loud ("Ramp toward Murfreesboro", "Roundabout, take
 * 3rd exit"), not anything with its own real name to look up. Caught
 * here, before ever reaching a geocoder, so it comes back
 * "unresolvable" (skipped entirely - see WaypointQuery above) instead
 * of spending a query only to land on "no match", indistinguishable
 * from a real miss (see README, "Maps, part nine" - this exact case is
 * what that prototype's one genuinely-expected empty result turned out
 * to be). Narrow on purpose - a false positive here silently drops a
 * real, resolvable stop, which is worse than an unresolvable one
 * occasionally still getting queried and failing loudly. Expand the
 * pattern only against another confirmed real case, not preemptively. */
function isUnresolvableDescription(road: string): boolean {
  return /\b(ramp|roundabout)\b/i.test(road);
}

/** Strips a leading house number off a literal street address, e.g.
 * "216 Lake Forest Dr" -> "Lake Forest Dr", so an address-form stop can
 * still hand later turns a road name to track "the current road" off
 * of. */
function roadNameFromAddress(address: string): string {
  return address.replace(/^\d+\s+/, "");
}

/** Recognizes a bare road name ("Riverwood Ln") by its own trailing
 * street-suffix word, the same signal a human reads a road name by -
 * "Cr" (this district's own real abbreviation for "Circle", not the
 * USPS-standard "Cir" - see normalizeStreetSuffix's own STREET_SUFFIX_
 * ABBREVIATIONS) included alongside "Cir" itself, so either spelling is
 * still recognized as a road even though only "Cr" is ever normalized
 * to. Deliberately doesn't touch anything else about telling a road
 * name apart from other one-value rows - a house-numbered address
 * ("216 Lake Forest Dr") ends in a suffix too, so that case is always
 * checked first (see isPlaceAction below); a place name with no suffix
 * at all ("LaVergne Lake Elementary School", "D&R Transportation
 * Headquarters") never matches here regardless. */
function looksLikeRoadName(text: string): boolean {
  return /\b(rd|road|ln|lane|dr|drive|st|street|ave|avenue|blvd|boulevard|ct|court|cir|cr|circle|way|trl|trail|pl|place|pkwy|parkway|hwy|highway|loop|ter|terrace|sq|square|xing|crossing|cres|crescent|cv|cove)\.?$/i.test(
    text.trim(),
  );
}

/** A row's own lone value, turned into a road worth tracking as
 * `currentRoad` going forward - a house-numbered address's road
 * ("216 Lake Forest Dr" -> "Lake Forest Dr"), or the text itself when
 * it already reads as a bare road name (see looksLikeRoadName above) -
 * or null for neither (a business/school/place name with no road of
 * its own to extract, "D&R Transportation Headquarters", "LaVergne
 * Lake Elementary School"), so a literal place like that is never
 * mistaken for a road a later turn could cross. Used only for
 * PLACE_ACTIONS rows (see below) - a turn's own destination is always
 * trusted as a road outright, precisely because naming one is the
 * whole point of a turn action, suffix or not ("Right, Bill Stewart" is
 * still a real road even with no "Rd"/"St" on the end). */
function trackableRoadFrom(text: string): string | null {
  if (/^\d/.test(text)) return roadNameFromAddress(text);
  if (looksLikeRoadName(text)) return text;
  return null;
}

/** Actions whose own lone value names a literal place - somewhere the
 * bus stops, starts, or ends, not a road it turns onto - so their
 * current-road tracking works the opposite way a turn's does (see
 * trackableRoadFrom above): trusted directly only when it actually
 * reads as a road or a house-numbered address, left untouched
 * otherwise, rather than corrupting `currentRoad` with a business or
 * school name a later turn would otherwise be crossed against. */
const PLACE_ACTIONS = new Set(["stop", "depart", "arrive", "complete"]);

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
 *    (`ontoAt` if given, otherwise `fromAt` per the same shorthand) -
 *    always trusted outright, since naming that road is the whole
 *    point of a turn action, real street suffix or not ("Right, Bill
 *    Stewart" is still a real road even with no "Rd"/"St" typed after
 *    it) - except when it's an unresolvable driver description (a
 *    ramp, a roundabout - see isUnresolvableDescription), which was
 *    never a real road name to track in the first place, so the
 *    previously-tracked road is left standing through it instead.
 *  - A PLACE_ACTIONS row's current road is the road it's *on* (`fromAt`)
 *    - the cross street (`ontoAt`) is just where along that road the
 *      row is, not a new heading - except a literal-address row with
 *      no cross street at all (e.g. "216 Lake Forest Dr"), where the
 *      road name is pulled out of the address itself, and a bare place
 *      name with no road of its own at all (a business or school name,
 *      "D&R Transportation Headquarters"), which leaves the tracked
 *      road untouched rather than corrupting it with non-road text a
 *      later turn would otherwise be wrongly crossed against. A row's
 *      own single bare road name with no cross street given at all
 *      (e.g. "Oak St") is read the other way around from either of
 *      those - it's *the* cross street, of whichever road is already
 *      tracked (the one the route last turned onto), not a new road of
 *      its own - so it derives the crossroads of the tracked road and
 *      that name, and leaves the tracked road itself untouched too. A
 *      route sheet's own row order always keeps a stop on the road
 *      it's already tracking before the turn that leaves it, never
 *      after - so this never has to guess which of two different roads
 *      a bare value like that means.
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
  return deriveWaypointsWithContext(rows, schoolAddress).waypoints;
}

/**
 * Same derivation as deriveWaypoints above, plus the "current road"
 * tracked value as it stood *before* each row was processed -
 * EditRouteScreen's single-box row editor shows that as the row's own
 * derived "from" context (see its own doc comment), so a human never
 * has to type the road they're already on again. Kept as one shared
 * pass rather than a second copy of this same tracking loop, so the
 * two can never drift out of sync with each other.
 *
 * `previousRoads` has one *more* entry than `rows` - a trailing one for
 * the road tracked after the very last row, so EditRouteScreen's own
 * `addRow` can pre-fill a brand-new row appended past the end
 * (`index === rows.length`) with real context too, not just one
 * inserted before an existing row.
 */
export function deriveWaypointsWithContext(
  rows: RawRouteRow[],
  schoolAddress: string,
): { waypoints: WaypointQuery[]; previousRoads: (string | null)[] } {
  let currentRoad: string | null = null;
  const previousRoads: (string | null)[] = [];

  const waypoints = rows.map((row, stepId): WaypointQuery => {
    previousRoads.push(currentRoad);
    const isPlaceAction = PLACE_ACTIONS.has(row.action.toLowerCase());

    // A bare road name with no cross street (a PLACE_ACTIONS row's own
    // "lone value" shorthand, see above) names the cross street of the
    // road already tracked, not a new road of its own - so, unlike
    // every other case here, it leaves `currentRoad` exactly as it
    // found it. Non-null only when that applies, so it also doubles as
    // the tracked road itself (TypeScript can't narrow `currentRoad`
    // from a separate boolean, so this carries the narrowed value
    // directly instead).
    const trackedCrossStreet =
      isPlaceAction && !row.ontoAt && !/^\d/.test(row.fromAt) && currentRoad && looksLikeRoadName(row.fromAt)
        ? currentRoad
        : null;

    // A manually-skipped row (EditRouteScreen's own Skip checkbox) is
    // never queried at all, same as a pattern-detected "unresolvable"
    // one - but it still has to update `currentRoad` the same way an
    // ordinary row would have, so a later row that leans on "the road
    // we're already on" (a lone-value turn, an intersection-based
    // PLACE_ACTIONS row) isn't left tracking whatever road was current
    // before this skipped row instead.
    if (row.skip) {
      currentRoad = isPlaceAction
        ? row.ontoAt
          ? row.fromAt
          : (trackedCrossStreet ?? trackableRoadFrom(row.fromAt) ?? currentRoad)
        : isUnresolvableDescription(row.ontoAt || row.fromAt)
          ? currentRoad
          : row.ontoAt || row.fromAt || currentRoad;
      return { stepId, kind: "unresolvable", description: "Marked as instructions only" };
    }

    if (isPlaceAction) {
      if (row.ontoAt) {
        currentRoad = row.fromAt;
        return locationFor(row.fromAt, row.ontoAt, schoolAddress, stepId);
      }
      if (trackedCrossStreet) {
        return locationFor(trackedCrossStreet, row.fromAt, schoolAddress, stepId);
      }
      currentRoad = trackableRoadFrom(row.fromAt) ?? currentRoad;
      if (isUnresolvableDescription(row.fromAt)) {
        return { stepId, kind: "unresolvable", description: row.fromAt };
      }
      return { stepId, kind: "address", text: row.fromAt };
    }

    if (row.ontoAt) {
      currentRoad = isUnresolvableDescription(row.ontoAt) ? currentRoad : row.ontoAt;
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
      currentRoad = destination;
    }
    return waypoint;
  });

  previousRoads.push(currentRoad);
  return { waypoints, previousRoads };
}
