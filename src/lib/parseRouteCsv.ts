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
  tripType: TripType;
  distance: string;
  durationMinutes: number;
  isFavorite: boolean;
}

function splitRow(line: string, delimiter: string): string[] {
  // Neither dataset has quoted or delimiter-containing fields, so a
  // plain split is enough - swap for a real CSV parser if that changes.
  return line.split(delimiter).map((cell) => cell.trim());
}

/** One route steps-sheet data row, split into its named columns but not
 * yet turned into a NavigationStep - the shared starting point for both
 * parseRouteCsv (below) and deriveWaypoints.ts, which needs fromAt/
 * ontoAt kept apart rather than already folded into a single display
 * string. `side` comes through "" for a sheet whose schema has no such
 * column at all (route-120's steps sheets), same as it already does for
 * a row that just leaves the column blank. */
export interface RawRouteRow {
  action: string;
  fromAt: string;
  ontoAt: string;
  riderCount: string;
  side: string;
  notes: string;
}

/** Splits a route steps sheet's data rows (header row dropped) into
 * their named columns, with no further interpretation. Column order and
 * delimiter are read from the header rather than assumed, so this
 * handles both route-125.csv's comma-separated schema
 * (time,action,from_at,onto_at,rider_count,side,notes - time always
 * blank) and route-120's tab-separated one
 * (time,action,from_at,onto_at,rider_count,notes - time populated, no
 * side column). `time` isn't parsed into anything on either sheet -
 * NavigationStep has no per-step time field (yet). */
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
        fromAt: row.from_at ?? "",
        ontoAt: row.onto_at ?? "",
        riderCount: row.rider_count ?? "",
        side: row.side ?? "",
        notes: row.notes ?? "",
      };
    });
}

/**
 * Turns the doc's proposed CSV schema
 * (time,action,from_at,onto_at,rider_count,side,notes) into route steps.
 * Built for the real Bus 125 route sheet, which only records
 * turn-by-turn directions and stop locations - no times or special
 * instructions yet, so those fields come through empty. The sheet's own
 * leading sequence-number column was dropped entirely (unneeded - each
 * row's position in the file already gives it an order). A thin
 * wrapper over buildRouteFromRows below - the real work, split out so
 * a caller that already has RawRouteRow[] from somewhere other than a
 * strict CSV file (see parseRouteImport.ts's graceful column/header
 * matching, used by the route-import/edit UI) can build a Route
 * without round-tripping back through CSV text first.
 */
export function parseRouteCsv(csvText: string, meta: RouteMeta): Route {
  return buildRouteFromRows(parseRouteCsvRows(csvText), meta);
}

export function buildRouteFromRows(rows: RawRouteRow[], meta: RouteMeta): Route {
  let stopCounter = 0;

  const waypoints = deriveWaypoints(rows, meta.schoolAddress);

  const steps: NavigationStep[] = rows.map((row, index) => {
    const { action, fromAt, ontoAt, riderCount, side, notes } = row;
    const studentCount = riderCount ? Number(riderCount) : undefined;
    const sideOfRoad = side || undefined;
    const specialInstruction = notes || undefined;
    const waypointKey = waypointCacheKey(waypoints[index]);

    if (action.toLowerCase() === "stop") {
      stopCounter += 1;
      const subheading = ontoAt ? `${fromAt} & ${ontoAt}` : fromAt;

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

    // A handful of rows only give one road name (e.g. "Left,
    // Riverwood Ln", onto_at blank) - shorthand from the source route
    // sheet for "turn onto this road" rather than a from/onto pair.
    // Treat a lone value as the turn's destination either way.
    const destination = ontoAt || fromAt;
    const spokenAnnouncement =
      ontoAt && fromAt
        ? `Turn ${action.toLowerCase()} from ${speakRoadNames(fromAt)} onto ${speakRoadNames(ontoAt)}.`
        : `Turn ${action.toLowerCase()} onto ${speakRoadNames(destination)}.`;
    const direction: TurnDirection | undefined =
      action.toLowerCase() === "left"
        ? "left"
        : action.toLowerCase() === "right"
          ? "right"
          : undefined;

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
      heading: `TURN ${action.toUpperCase()}`,
      subheading: destination,
      specialInstruction,
      waypointKey,
      announcement,
    };
  });

  return { ...meta, steps };
}
