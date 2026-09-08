import type { TripType } from "./types";

/** "AM"/"PM"/"Field Trip" - the short label every trip-type badge across
 * the app (TopBar, StartScreen, RouteListScreen, EditRouteScreen) shows
 * next to its own icon (TripTypeIcon), kept in one place so a future
 * TripType doesn't need updating in every one of those files' own
 * ternaries by hand. */
export function tripTypeLabel(tripType: TripType): string {
  if (tripType === "pickup") return "AM";
  if (tripType === "dropoff") return "PM";
  return "Field Trip";
}

/** Sort/tab order every trip-type filter and comparator in the app
 * agrees on - morning runs first, afternoon next, one-off field trips
 * last. */
export const TRIP_TYPE_ORDER: TripType[] = ["pickup", "dropoff", "fieldtrip"];

/** The longer "Morning Pickup"/"Afternoon Drop Off"/"Field Trip" form -
 * used wherever a route's own name is built from its trip type
 * (EditRouteScreen's own buildMetaFields, parseRouteMasterList's real
 * master-list rows) rather than the short badge label above. Not shared
 * with demoRoutes.ts's own near-identical TRIP_LABELS - that one picks
 * a *random* label to derive a fabricated route's tripType from (the
 * reverse direction), and deliberately never fabricates a "Field Trip"
 * demo row (see its own doc comment), so folding it into this
 * tripType-first helper would need unpicking more than it'd save. */
export function tripTypeFullLabel(tripType: TripType): string {
  if (tripType === "pickup") return "Morning Pickup";
  if (tripType === "dropoff") return "Afternoon Drop Off";
  return "Field Trip";
}
