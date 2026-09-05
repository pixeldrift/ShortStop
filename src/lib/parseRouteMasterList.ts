import type { RouteMeta } from "./parseRouteCsv";
import type { SchoolLevel, TripType } from "./types";
import { durationBetween24HourTimes, format24HourAsAmPm } from "./time";

const SCHOOL_TYPE_TO_LEVEL: Record<string, SchoolLevel> = {
  EL: "elementary",
  MS: "middle",
  HS: "high",
};

// Same tripType -> display-label pairing as demoRoutes.ts's TRIP_LABELS,
// duplicated locally rather than shared - it's two fixed strings, not
// parsing logic, and this file otherwise has no reason to import from a
// module that's purely about fabricating demo filler.
const TRIP_TYPE_LABEL: Record<TripType, string> = {
  pickup: "Morning Pickup",
  dropoff: "Afternoon Drop Off",
};

/** Fields the master list actually provides - everything on RouteMeta
 * except driverName, schoolAddress, distance and isFavorite, which
 * still have no real-data source and stay merged in separately (see
 * placeholderMeta.ts) - with durationMinutes made optional, since a
 * route whose end_time the sheet hasn't recorded yet has no way to
 * compute one. */
export type MasterListRoute = Omit<
  RouteMeta,
  "driverName" | "schoolAddress" | "distance" | "isFavorite" | "durationMinutes"
> & { durationMinutes: number | undefined };

/**
 * Parses the tab-separated master route list (route_id, route_number,
 * bus_number, am_pm, school_type, school_name, start_time, end_time,
 * stop_count, rider_count, status - one header row plus one data row
 * per route) into route metadata, one entry per row.
 *
 * route_id is expected blank in practice (the sheet hasn't started
 * populating it) - falls back to the `${routeNumber}-${tripType}-
 * ${schoolLevel}` convention documented on Route.id (types.ts) whenever
 * it's empty, rather than requiring the sheet to supply it. `name` isn't
 * a column either, so it's built the same way demoRoutes.ts builds one
 * for its fabricated routes: `${schoolName} — ${tripLabel}`.
 *
 * stop_count/rider_count are columns here too, but aren't parsed into
 * anything - same reasoning as parseRouteMetaCsv.ts: the app already
 * derives both, live, from each route's own steps CSV (parseRouteCsv),
 * which stays correct if a stop is ever added or removed there -
 * re-deriving the same numbers from this sheet's own copy would just be
 * a second source that could drift out of sync with it.
 */
export function parseRouteMasterList(csvText: string): MasterListRoute[] {
  const [headerLine, ...dataLines] = csvText.trim().split(/\r?\n/);
  const headers = headerLine.split("\t").map((h) => h.trim());

  return dataLines
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const values = line.split("\t").map((v) => v.trim());
      const row = Object.fromEntries(headers.map((header, i) => [header, values[i] ?? ""]));

      const tripType: TripType = row.am_pm.toUpperCase() === "AM" ? "pickup" : "dropoff";
      const schoolLevel = SCHOOL_TYPE_TO_LEVEL[row.school_type.toUpperCase()];
      const id = row.route_id || `${row.route_number}-${tripType}-${schoolLevel}`;

      return {
        id,
        status: row.status.toLowerCase() as RouteMeta["status"],
        routeNumber: row.route_number,
        name: `${row.school_name} — ${TRIP_TYPE_LABEL[tripType]}`,
        busNumber: row.bus_number,
        schoolName: row.school_name,
        schoolLevel,
        tripType,
        departureTime: format24HourAsAmPm(row.start_time),
        durationMinutes: row.end_time
          ? durationBetween24HourTimes(row.start_time, row.end_time)
          : undefined,
      };
    });
}
