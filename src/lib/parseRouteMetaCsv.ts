import type { RouteMeta } from "./parseRouteCsv";

/** Fields this file's schema actually covers - driverName,
 * schoolAddress, distance, isFavorite, id, status, and schoolLevel
 * aren't columns here, so callers merge those in separately (see
 * PLACEHOLDER_META in page.tsx). id/status/schoolLevel in particular
 * aren't placeholders so much as data this sheet's schema simply
 * hasn't grown yet - once more real routes exist, they likely belong
 * here instead (a route_id, status, and school_level column), not in
 * a hardcoded constant shared by every route. stop_count/rider_count
 * are in the schema too, but aren't parsed into anything: the app
 * already derives both, live, from the real steps CSV (parseRouteCsv),
 * which stays correct if a stop is ever added or removed there -
 * re-deriving the same numbers from this file's own copy would just
 * be a second source that could drift out of sync with it. */
export type RouteMetaCsvFields = Omit<
  RouteMeta,
  "driverName" | "schoolAddress" | "distance" | "isFavorite" | "id" | "status" | "schoolLevel"
>;

function to12HourClock(hhmm: string): string {
  const [hourStr, minuteStr] = hhmm.split(":");
  const hour24 = parseInt(hourStr, 10);
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const period = hour24 >= 12 ? "PM" : "AM";
  return `${hour12}:${minuteStr.padStart(2, "0")} ${period}`;
}

function toMinutesSinceMidnight(hhmm: string): number {
  const [hourStr, minuteStr] = hhmm.split(":");
  return parseInt(hourStr, 10) * 60 + parseInt(minuteStr, 10);
}

/**
 * Parses the tab-separated route-metadata sheet (route_number,
 * route_name, bus_number, school_name, pickup_dropoff, start_time,
 * end_time, stop_count, rider_count - one header row plus one data row
 * per route) into the subset of RouteMeta this schema actually
 * provides. durationMinutes is computed from start_time/end_time rather
 * than being its own column, wrapping across midnight the same way
 * addMinutesToTimeString does elsewhere.
 */
export function parseRouteMetaCsv(csvText: string): RouteMetaCsvFields {
  const [headerLine, dataLine] = csvText.trim().split(/\r?\n/);
  const headers = headerLine.split("\t").map((h) => h.trim());
  const values = dataLine.split("\t").map((v) => v.trim());
  const row = Object.fromEntries(headers.map((header, i) => [header, values[i]]));

  const startMinutes = toMinutesSinceMidnight(row.start_time);
  const endMinutes = toMinutesSinceMidnight(row.end_time);
  const durationMinutes = ((endMinutes - startMinutes) % 1440 + 1440) % 1440;

  return {
    routeNumber: row.route_number,
    name: row.route_name,
    busNumber: row.bus_number,
    schoolName: row.school_name,
    tripType: row.pickup_dropoff.toLowerCase() === "pickup" ? "pickup" : "dropoff",
    departureTime: to12HourClock(row.start_time),
    durationMinutes,
  };
}
