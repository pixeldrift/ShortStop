import type { RouteMeta } from "./parseRouteCsv";
import { tripTypeFullLabel } from "./tripType";
import type { SchoolLevel, TripType } from "./types";
import { durationBetween24HourTimes, format24HourAsAmPm } from "./time";

const SCHOOL_TYPE_TO_LEVEL: Record<string, SchoolLevel> = {
  EL: "elementary",
  MS: "middle",
  HS: "high",
};

// Exact inverses of the maps above - used by stepsCsvBaseName below to
// go from a parsed route back to the district's own file-naming
// convention, rather than the app's own tripType/schoolLevel spelling.
const LEVEL_TO_SCHOOL_TYPE: Record<SchoolLevel, string> = {
  elementary: "EL",
  middle: "MS",
  high: "HS",
};

// "FT" is unreachable in practice - the real master list's own am_pm
// column below only ever parses as "AM"/"PM" (a route ever needs this
// derived the other way, route -> file-naming convention, only for a
// route this same parse already produced) - filled in purely so this
// Record<TripType, string> stays exhaustive once TripType has a third
// value.
const TRIP_TYPE_TO_AM_PM: Record<TripType, string> = {
  pickup: "AM",
  dropoff: "PM",
  fieldtrip: "FT",
};

/** Fields the master list actually provides - everything on RouteMeta
 * except driverName, schoolAddress, schoolLat, schoolLon, distance and
 * isFavorite, which still have no real-data source and stay merged in
 * separately (see placeholderMeta.ts) - with durationMinutes made
 * optional, since a route whose end_time the sheet hasn't recorded yet
 * has no way to compute one. */
export type MasterListRoute = Omit<
  RouteMeta,
  "driverName" | "schoolAddress" | "schoolLat" | "schoolLon" | "distance" | "isFavorite" | "durationMinutes"
> & { durationMinutes: number | undefined };

/**
 * Parses the tab-separated master route list (route_id, route_number,
 * bus_number, am_pm, school_type, school_name, start_time, end_time,
 * stop_count, rider_count, status, next_route_id - one header row plus
 * one data row per route) into route metadata, one entry per row.
 * next_route_id is /api/route-master-list's own addition (see that
 * route's own doc comment) - the district's real sheet has no such
 * column, so a header-less or otherwise-shaped source just reads every
 * row's own nextRouteId as null, same as any other missing column here.
 *
 * route_id is expected blank in practice (the sheet hasn't started
 * populating it) - falls back to the `${routeNumber}-${tripType}-
 * ${schoolLevel}` convention documented on Route.id (types.ts) whenever
 * it's empty, rather than requiring the sheet to supply it. `name` isn't
 * a column either, so it's built the same way demoRoutes.ts builds one
 * for its fabricated routes: `${schoolName} — ${tripLabel}`.
 *
 * stop_count/rider_count are columns here too, but aren't parsed into
 * anything - the app already derives both, live, from each route's own
 * steps CSV (parseRouteCsv), which stays correct if a stop is ever
 * added or removed there - re-deriving the same numbers from this
 * sheet's own copy would just be a second source that could drift out
 * of sync with it.
 */
export function parseRouteMasterList(csvText: string): MasterListRoute[] {
  const [headerLine, ...dataLines] = csvText.trim().split(/\r?\n/);
  const headers = headerLine.split("\t").map((h) => h.trim());

  return dataLines
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const values = line.split("\t").map((v) => v.trim());
      const row = Object.fromEntries(headers.map((header, i) => [header, values[i] ?? ""]));

      // "FT" round-trips a field-trip route back out of
      // /api/route-master-list's own am_pm column (see that route's
      // own TRIP_TYPE_TO_AM_PM) - the district's real sheet only ever
      // has "AM"/"PM" here today, but a real admin-created field-trip
      // route now can too, once it's gone through Postgres.
      const amPm = row.am_pm.toUpperCase();
      const tripType: TripType = amPm === "AM" ? "pickup" : amPm === "FT" ? "fieldtrip" : "dropoff";
      const schoolLevel = SCHOOL_TYPE_TO_LEVEL[row.school_type.toUpperCase()];
      const id = row.route_id || `${row.route_number}-${tripType}-${schoolLevel}`;

      return {
        id,
        status: row.status.toLowerCase() as RouteMeta["status"],
        routeNumber: row.route_number,
        name: `${row.school_name} — ${tripTypeFullLabel(tripType)}`,
        busNumber: row.bus_number,
        schoolName: row.school_name,
        schoolLevel,
        tripType,
        departureTime: format24HourAsAmPm(row.start_time),
        durationMinutes: row.end_time
          ? durationBetween24HourTimes(row.start_time, row.end_time)
          : undefined,
        // A missing column (the district's own real sheet has no such
        // field) and an empty one (nothing links from this route yet)
        // both read as undefined/"" here, so `|| null` covers either
        // case the same way without its own presence check.
        nextRouteId: row.next_route_id || null,
      };
    });
}

/**
 * Computes a route's steps-CSV basename (no extension, no directory) -
 * "125-PM-EL", "120-AM-MS" - from the district's own file-naming
 * convention: route number, AM/PM, school type. The exact inverse of
 * how this file derives tripType/schoolLevel from the master list's own
 * am_pm/school_type columns above, so it's computed rather than kept in
 * a separate hardcoded per-route table - used by the geocoding pipeline
 * (scripts/geocodeRoute.ts) to find each active route's own steps sheet
 * and sidecar waypoint cache.
 */
export function stepsCsvBaseName(
  route: Pick<MasterListRoute, "routeNumber" | "tripType" | "schoolLevel">,
): string {
  return `${route.routeNumber}-${TRIP_TYPE_TO_AM_PM[route.tripType]}-${LEVEL_TO_SCHOOL_TYPE[route.schoolLevel]}`;
}
