import { deriveWaypoints } from "./deriveWaypoints";
import { speakRoadNames } from "./speech";
import type {
  NavigationStep,
  Route,
  RouteStatus,
  SchoolLevel,
  TripType,
  TurnDirection,
} from "./types";
import { waypointCacheKey } from "./waypointCache";

export interface RouteMeta {
  id: string;
  status: RouteStatus;
  name: string;
  routeNumber: string;
  driverName: string;
  busNumber: string;
  departureTime: string;
  schoolName: string;
  schoolAddress: string;
  schoolLevel: SchoolLevel;
  schoolLat: number | null;
  schoolLon: number | null;
  tripType: TripType;
  distance: string;
  /** Undefined when there's no way to compute a trip length yet - no
   * end_time on the real master list's own row (see page.tsx), or an
   * admin-created route, which has no form field to set one at all.
   * Never faked as 0 or hidden behind skipping the route entirely -
   * see StartScreen's own "—" fallback. */
  durationMinutes: number | undefined;
  isFavorite: boolean;
  nextRouteId: string | null;
}

function splitRow(line: string, delimiter: string): string[] {
  // Neither dataset has quoted or delimiter-containing fields, so a
  // plain split is enough - swap for a real CSV parser if that changes.
  return line.split(delimiter).map((cell) => cell.trim());
}

/** One route steps-sheet data row, split into its named columns but not
 * yet turned into a NavigationStep - the shared starting point for both
 * parseRouteCsv (below) and deriveWaypoints.ts, which needs `location`/
 * `fromLocation` kept apart rather than already folded into a single
 * display string. `location` is always this row's own real position -
 * a turn's destination road, or a stop's own road/intersection/address
 * - and is the only one of the two ever required; `fromLocation` is an
 * optional, explicit "coming from" road, used to pair with `location`
 * as an intersection - blank means deriveWaypoints.ts should infer it
 * from whichever road the route was last known to be on (its own
 * "current road" tracking), the same as it always has, but now that's
 * a real default rather than the only option. `side` comes through ""
 * for a sheet whose schema has no such column at all (route-120's
 * steps sheets), same as it already does for a row that just leaves
 * the column blank. */
export interface RawRouteRow {
  action: string;
  location: string;
  fromLocation: string;
  riderCount: string;
  side: string;
  notes: string;
  /** Manually marked "instructions only, don't geocode this" from
   * EditRouteScreen.tsx's own Skip checkbox - honored by
   * deriveWaypoints.ts ahead of its own pattern-based "unresolvable"
   * detection. Absent from every real steps sheet today (defaults to
   * false via the `row.skip === "true"` read below), same as `side` is
   * already missing from route-120's own schema. */
  skip: boolean;
}

/** Splits a route steps sheet's data rows (header row dropped) into
 * their named columns, with no further interpretation. Column order and
 * delimiter are read from the header rather than assumed, so this
 * handles both route-125.csv's comma-separated schema
 * (time,action,location,from_location,rider_count,side,notes - time
 * always blank) and route-120's tab-separated one
 * (time,action,location,from_location,rider_count,notes - time
 * populated, no side column). `time` isn't parsed into anything on
 * either sheet - NavigationStep has no per-step time field (yet). */
export function parseRouteCsvRows(csvText: string): RawRouteRow[] {
  const [headerLine, ...rows] = csvText.trim().split(/\r?\n/);
  const delimiter = headerLine.includes("\t") ? "\t" : ",";
  const headers = splitRow(headerLine, delimiter);

  return rows
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const values = splitRow(line, delimiter);
      const row = Object.fromEntries(headers.map((header, i) => [header, values[i] ?? ""]));
      return {
        action: row.action ?? "",
        location: row.location ?? "",
        fromLocation: row.from_location ?? "",
        riderCount: row.rider_count ?? "",
        side: row.side ?? "",
        notes: row.notes ?? "",
        skip: row.skip === "true",
      };
    });
}

/** The exact reader-facing instruction a row's own action/location
 * values produce - "Left onto Main Street", "Proceed onto Elm Street",
 * "Turn Around", "Stop 5 at 123 Elm Street", "Arrive at LaVergne High
 * School" - not the screen's own ALL-CAPS heading (stepHeading below)
 * or spoken announcement (buildRouteFromRows), which both phrase the
 * same row differently for their own contexts. Shared by
 * StepRowEditor's own live preview (this exact row, mid-edit) and
 * anywhere else that wants to show what a row actually says without
 * duplicating this phrasing. Works the same for every PLACE_ACTIONS
 * action (deriveWaypoints.ts's own "stop, depart, arrive, complete"
 * set) rather than hardcoding "Stop" as the only one with its own
 * label, and the same for every turn action (Left/Right aside) rather
 * than special-casing which of the dropdown's own options genuinely
 * have a destination - "Turn Around"/"Pull Over" simply never get one
 * typed in, so the fallback to the bare action label already covers
 * them without a name-by-name list that'd need updating for any future
 * action added to that dropdown. `stopNumber` null omits the number
 * rather than printing "Stop null" - the same graceful fallback every
 * other stop-number display in this app already uses for a row not
 * actually numbered yet. `effectiveFrom` defaults to the row's own
 * `fromLocation`, but a caller tracking "current road" context (see
 * deriveWaypointsWithContext's own `previousRoad`) can pass the
 * inferred value instead, so a row with no explicit fromLocation of
 * its own still previews as the real intersection it'll actually
 * resolve to, not just its bare location. */
export function formatWaypointInstruction(
  row: RawRouteRow,
  stopNumber: number | null,
  effectiveFrom: string = row.fromLocation,
): string {
  const { action, location } = row;
  const a = action.toLowerCase();
  if (a === "stop" || a === "depart" || a === "arrive" || a === "complete") {
    const fullLocation = effectiveFrom ? `${effectiveFrom} & ${location}` : location;
    const label = a === "stop" ? (stopNumber ? `Stop ${stopNumber}` : "Stop") : action || "Stop";
    return fullLocation ? `${label} at ${fullLocation}` : label;
  }
  const actionLabel = action || "Turn";
  return location ? `${actionLabel} onto ${location}` : actionLabel;
}

/** The big on-screen line for a turn-kind step (StepContent's own `h1`
 * once `direction` is unset) - "TURN LEFT" keeps its existing "TURN "
 * prefix (the action word alone, "LEFT", would read as a place name
 * rather than a maneuver), every other action is distinctive enough
 * baldly capitalized on its own ("PROCEED", "TURN AROUND", "PULL
 * OVER", "RETURN"). */
function stepHeading(action: string): string {
  const a = action.toLowerCase();
  return a === "left" || a === "right" ? `TURN ${action.toUpperCase()}` : action.toUpperCase();
}

/** Turns a route's own RawRouteRow[] - straight from Postgres
 * (page.tsx), a saved edit (EditRouteScreen.tsx), or a parsed import
 * (parseRouteImport.ts) - into real NavigationSteps, spoken
 * announcements included. The one place any of those three sources
 * ever needs to become a Route. */
export function buildRouteFromRows(rows: RawRouteRow[], meta: RouteMeta): Route {
  let stopCounter = 0;

  const waypoints = deriveWaypoints(rows, meta.schoolAddress);

  const steps: NavigationStep[] = rows.map((row, index) => {
    const { action, location, fromLocation, riderCount, side, notes } = row;
    const studentCount = riderCount ? Number(riderCount) : undefined;
    const sideOfRoad = side || undefined;
    const specialInstruction = notes || undefined;
    const waypointKey = waypointCacheKey(waypoints[index]);

    if (action.toLowerCase() === "stop") {
      stopCounter += 1;
      const subheading = fromLocation ? `${fromLocation} & ${location}` : location;

      // Spoken as separate parts - stop number, then location, then
      // side of the road, then rider count, then any note - so there's
      // a clear pause between each rather than one long sentence.
      const announcement = [`Stop ${stopCounter}.`, `${speakRoadNames(subheading)}.`];
      if (sideOfRoad) {
        announcement.push(`On the ${sideOfRoad.toLowerCase()}.`);
      }
      if (studentCount != null) {
        announcement.push(`${studentCount} rider${studentCount === 1 ? "" : "s"} expected.`);
      }
      if (specialInstruction) {
        announcement.push(`${speakRoadNames(specialInstruction)}.`);
      }

      return {
        id: index,
        kind: "stop",
        subheading,
        studentCount,
        sideOfRoad,
        specialInstruction,
        waypointKey,
        announcement,
      };
    }

    const isPlaceAction = action.toLowerCase() === "depart" || action.toLowerCase() === "arrive";
    const direction: TurnDirection | undefined =
      action.toLowerCase() === "left"
        ? "left"
        : action.toLowerCase() === "right"
          ? "right"
          : undefined;

    // "Left"/"Right" keep their exact original "Turn left/right (from
    // X) onto Y" phrasing. Depart/Arrive read as arriving *at* a place
    // (almost always the route's own school - see StepRowEditor.tsx's
    // school-linking), not turning onto a road, so they get "at"
    // instead of "onto." Every other action (Proceed, Turn Around,
    // Pull Over, Return) speaks as its own verb instead of a hardcoded
    // "Turn" - "Proceed onto Elm Street," not "Turn proceed onto Elm
    // Street" - and falls back to the bare action ("Turn Around.")
    // once there's no location typed in for it to name, the same
    // "no name-by-name list" reasoning formatWaypointInstruction above
    // uses for its own, differently-phrased preview of this same row.
    const spokenAnnouncement =
      action.toLowerCase() === "left" || action.toLowerCase() === "right"
        ? fromLocation && location
          ? `Turn ${action.toLowerCase()} from ${speakRoadNames(fromLocation)} onto ${speakRoadNames(location)}.`
          : `Turn ${action.toLowerCase()} onto ${speakRoadNames(location)}.`
        : isPlaceAction
          ? location
            ? `${action} at ${speakRoadNames(location)}.`
            : `${action}.`
          : location
            ? `${action} onto ${speakRoadNames(location)}.`
            : `${action}.`;

    // A turn's note is spoken too, same as a stop's - e.g. a road
    // renaming partway along with no turn of its own ("Fergus Rd
    // becomes Bill Stewart Rd") still matters to a driver even though
    // nothing here calls it out as its own row.
    const announcement = [spokenAnnouncement];
    if (specialInstruction) {
      announcement.push(`${speakRoadNames(specialInstruction)}.`);
    }

    return {
      id: index,
      kind: "turn",
      direction,
      heading: stepHeading(action),
      subheading: location || undefined,
      specialInstruction,
      waypointKey,
      announcement,
    };
  });

  return { ...meta, steps };
}
