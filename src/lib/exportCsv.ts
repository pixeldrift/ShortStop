import type { NavigationStep, Route } from "./types";
import type { WaypointCache } from "./waypointCache";

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

const STEP_HEADER = [
  "sequence",
  "kind",
  "direction",
  "location",
  "side_of_road",
  "rider_count",
  "notes",
  "status",
  "lat",
  "lon",
  "resolved_address",
];

/** One row per step (stop or turn), in route order, joined against
 * whatever this session's own waypoint cache already knows for it (see
 * step.waypointKey) - the same lookup routeReadiness.ts/StepScreen.tsx
 * already do to place a pin, just written out as a CSV row instead of
 * used for a live map/lookup. Never triggers a new geocode of its own -
 * only ever reports whatever's already in memory. */
function stepRow(step: NavigationStep, index: number, cache: WaypointCache): (string | number)[] {
  const entry = cache[step.waypointKey];
  const resolved = entry?.status === "ok" ? entry : undefined;
  return [
    index + 1,
    step.kind,
    step.direction ?? "",
    step.subheading ?? "",
    step.sideOfRoad ?? "",
    step.studentCount ?? "",
    step.specialInstruction ?? "",
    resolved ? "resolved" : entry?.status === "error" ? "unresolved" : "not yet geocoded",
    resolved ? resolved.lat : "",
    resolved ? resolved.lon : "",
    resolved ? resolved.displayName : "",
  ];
}

/** A route's own stops and turns, plus whatever coordinates are
 * already known for each, as CSV - everything the app already has in
 * memory, nothing this export triggers itself. */
export function routeStepsToCsv(route: Route, cache: WaypointCache): string {
  const rows = route.steps.map((step, index) => csvRow(stepRow(step, index, cache)));
  return [csvRow(STEP_HEADER), ...rows].join("\n") + "\n";
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
    route.schoolLevel,
    route.departureTime,
    route.status,
    totalStops,
    totalRiders,
    route.distance,
    route.durationMinutes ?? "",
  ];
}

/** The route list itself as CSV, one row per route - fabricated demo
 * routes (see demoRoutes.ts) are filtered out, so an export never
 * hands someone filler rows mixed in with the district's real ones. */
export function routeListToCsv(routes: Route[]): string {
  const realRoutes = routes.filter((r) => r.status !== "demo");
  const rows = realRoutes.map((route) => csvRow(routeRow(route)));
  return [csvRow(ROUTE_HEADER), ...rows].join("\n") + "\n";
}
