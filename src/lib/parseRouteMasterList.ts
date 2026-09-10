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

// "FT"/"OT" are unreachable in practice - the real master list's own
// am_pm column below only ever parses as "AM"/"PM" (a route ever needs
// this derived the other way, route -> file-naming convention, only
// for a route this same parse already produced) - filled in purely so
// this Record<TripType, string> stays exhaustive now that TripType has
// more than two values.
const TRIP_TYPE_TO_AM_PM: Record<TripType, string> = {
  pickup: "AM",
  dropoff: "PM",
  fieldtrip: "FT",
  other: "OT",
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
 * steps (buildRouteFromRows), which stays correct if a stop is ever
 * added or removed there - re-deriving the same numbers from this
 * sheet's own copy would just be a second source that could drift out
 * of sync with it.
 *
 * Only prisma/seed.ts and the geocoding scripts read the real
 * district file through this anymore - src/app/api/route-master-list
 * builds the exact same MasterListRoute shape straight from Postgres
 * for the running app itself, with no CSV text in between.
 */
export function parseRouteMasterList(csvText: string): MasterListRoute[] {
  const [headerLine, ...dataLines] = csvText.trim().split(/\r?\n/);
  const headers = headerLine.split("\t").map((h) => h.trim());

  return dataLines
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const values = line.split("\t").map((v) => v.trim());
      const row = Object.fromEntries(headers.map((header, i) => [header, values[i] ?? ""]));

      // "FT"/"OT" are TRIP_TYPE_TO_AM_PM's own inverse - unreachable
      // against the real district file this function actually reads
      // now (prisma/seed.ts, the geocoding scripts), which only ever
      // has "AM"/"PM" here, but kept for the same completeness reason
      // that Record stays exhaustive.
      const amPm = row.am_pm.toUpperCase();
      const tripType: TripType =
        amPm === "AM" ? "pickup" : amPm === "FT" ? "fieldtrip" : amPm === "OT" ? "other" : "dropoff";
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

const AM_PM_TO_TRIP_TYPE: Record<string, TripType> = {
  AM: "pickup",
  PM: "dropoff",
  FT: "fieldtrip",
  OT: "other",
};

// SCHOOL_TYPE_TO_LEVEL above is the master list's own real column
// convention ("EL"), but an admin uploading a route file by hand is
// just as likely to write it "ES" - matching how this app's own UI
// abbreviates elementary everywhere else (RouteListScreen's own
// school-level toggle). Both are accepted here without changing what
// the master list itself produces.
const SCHOOL_TYPE_ALIASES: Record<string, SchoolLevel> = {
  ...SCHOOL_TYPE_TO_LEVEL,
  ES: "elementary",
};

export interface ParsedRouteFilename {
  routeNumber: string | null;
  tripType: TripType | null;
  schoolLevel: SchoolLevel | null;
}

/**
 * The reverse of stepsCsvBaseName above - a district file named the
 * way this app's own steps sheets are ("130-PM-ES.csv", "120-AM-MS.tsv")
 * already carries its own route number, trip, and school level right
 * in the name, so EditRouteScreen's "Add New Route" upload
 * (handleFileChosen) can prefill those fields from it instead of
 * asking an admin to retype what's already right there in the file
 * they just picked.
 *
 * Each field parses independently and comes back null on its own if
 * that segment isn't recognized - a filename close to but not exactly
 * this convention (or one that doesn't follow it at all) still yields
 * whatever pieces genuinely did parse, rather than discarding a
 * perfectly good route number just because the trailing segment was
 * spelled unexpectedly or missing.
 */
export function parseRouteFilename(filename: string): ParsedRouteFilename {
  const base = filename.replace(/\.[^./]+$/, "");
  const match = base.match(/^(\d+)\s*-\s*([A-Za-z]+)\s*-\s*([A-Za-z]+)/);
  if (!match) {
    const numberOnly = base.match(/^(\d+)/);
    return { routeNumber: numberOnly?.[1] ?? null, tripType: null, schoolLevel: null };
  }
  const [, routeNumber, amPm, schoolType] = match;
  return {
    routeNumber,
    tripType: AM_PM_TO_TRIP_TYPE[amPm.toUpperCase()] ?? null,
    schoolLevel: SCHOOL_TYPE_ALIASES[schoolType.toUpperCase()] ?? null,
  };
}
