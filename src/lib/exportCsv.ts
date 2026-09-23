import type { Route } from "./types";
import type { RawRouteRow } from "./parseRouteCsv";
import type { RowResolutionStatus } from "./routeResolutionStatus";

/** Wraps a single CSV field in quotes only when it actually needs it
 * (a comma, quote, or newline in the value), doubling any embedded
 * quotes - the minimum RFC 4180 escaping a real spreadsheet app
 * expects. */
function csvField(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvRow(values: (string | number)[]): string {
  return values.map(csvField).join(",");
}

/** Triggers a browser download of `text` as `filename` - Blob + a
 * throwaway `<a download>` click, no server round trip. Shared by
 * every CSV export button in the app. */
export function downloadCsv(filename: string, text: string): void {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

// row_number through skip mirror RawRouteRow verbatim - the same
// canonical names parseRouteImport/parseRouteBulkUpdate already match
// an uploaded header against (row_number is the one addition neither
// of those two field names describe on their own: see
// BulkUpdateRow's own doc comment, parseRouteImport.ts) - so this
// export is never just a report to look at, it's also exactly the
// shape re-uploading through EditRouteScreen's own "Upload / Update"
// expects back. status/lat/lon at the end are informational only
// (this session's own already-resolved coordinate, if it has one) -
// neither is a column parseRouteBulkUpdate recognizes, so editing or
// deleting them before a re-upload changes nothing.
const STEP_HEADER = [
  "row_number",
  "action",
  "location",
  "from_location",
  "rider_count",
  "side",
  "notes",
  "skip",
  "status",
  "lat",
  "lon",
];

function stepRow(
  row: RawRouteRow,
  index: number,
  status: RowResolutionStatus | undefined,
): (string | number)[] {
  return [
    index + 1,
    row.action,
    row.location,
    row.fromLocation,
    row.riderCount,
    row.side,
    row.notes,
    row.skip ? "true" : "false",
    status?.status ?? "",
    status?.status === "resolved" ? status.lat : "",
    status?.status === "resolved" ? status.lon : "",
  ];
}

/** A route's own stops and turns, exactly as EditRouteScreen's own
 * `rows`/`resolutionRows` already have them in memory - nothing this
 * export triggers itself, and the same authoring fields (not a
 * separately-shaped report) an admin would type by hand, so the file
 * this produces can be edited and handed straight back to "Upload /
 * Update" rather than needing its own different format to prepare
 * one. `resolutionRows` is optional and may be shorter than `rows`
 * (EditRouteScreen's own guard conditions - see hasIncompleteRow's
 * doc comment there) - a row past its end just reports a blank
 * status/lat/lon, same as one that was never geocoded at all. */
export function routeStepsToCsv(
  rows: RawRouteRow[],
  resolutionRows: (RowResolutionStatus | undefined)[] = [],
): string {
  const dataRows = rows.map((row, index) => csvRow(stepRow(row, index, resolutionRows[index])));
  return [csvRow(STEP_HEADER), ...dataRows].join("\n") + "\n";
}

const ROUTE_HEADER = [
  "route_id",
  "route_number",
  "bus_number",
  "trip_type",
  "school_name",
  "school_level",
  "departure_time",
  "status",
  "total_stops",
  "total_riders",
  "distance",
  "duration_minutes",
];

function routeRow(route: Route): (string | number)[] {
  const totalStops = route.steps.filter((s) => s.kind === "stop").length;
  const totalRiders = route.steps.reduce((sum, s) => sum + (s.studentCount ?? 0), 0);
  return [
    route.id,
    route.routeNumber,
    route.busNumber,
    route.tripType,
    route.schoolName,
    // Blank rather than the literal string "null" for a route with no
    // real school level (see Route.schoolLevel's own doc comment,
    // types.ts) - same "just leave it out" treatment durationMinutes
    // already gets right below.
    route.schoolLevel ?? "",
    route.departureTime,
    route.status,
    totalStops,
    totalRiders,
    route.distance,
    route.durationMinutes ?? "",
  ];
}

/** The route list itself as CSV, one row per route - a fabricated demo
 * route is filtered out (should one ever exist again), so an export
 * never hands someone filler rows mixed in with the district's real
 * ones. */
export function routeListToCsv(routes: Route[]): string {
  const realRoutes = routes.filter((r) => r.status !== "demo");
  const rows = realRoutes.map((route) => csvRow(routeRow(route)));
  return [csvRow(ROUTE_HEADER), ...rows].join("\n") + "\n";
}
