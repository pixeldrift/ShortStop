import type { TripType } from "./types";

/** "AM"/"PM"/"SP"/"Other" - the short label every trip-type badge
 * across the app (TopBar, StartScreen, RouteListScreen,
 * EditRouteScreen) shows next to its own icon (TripTypeIcon), kept in
 * one place so a future TripType doesn't need updating in every one of
 * those files' own ternaries by hand. "SP" (Special) matches AM/PM's
 * own two-letter brevity - RouteListScreen's filter toggle uses the
 * same abbreviation for the same trip type, see TRIP_TYPE_TOGGLES. */
export function tripTypeLabel(tripType: TripType): string {
  if (tripType === "pickup") return "AM";
  if (tripType === "dropoff") return "PM";
  if (tripType === "fieldtrip") return "SP";
  return "Other";
}

/** Sort/tab order every trip-type filter and comparator in the app
 * agrees on - morning runs first, afternoon next, one-off field trips
 * next, everything else last. */
export const TRIP_TYPE_ORDER: TripType[] = ["pickup", "dropoff", "fieldtrip", "other"];

/** The longer "Morning Pickup"/"Afternoon Drop Off"/"Special"/"Other"
 * form - used wherever a route's own name is built from its trip type
 * (EditRouteScreen's own buildMetaFields, parseRouteMasterList's real
 * master-list rows) rather than the short badge label above. "Special"
 * (not "Field Trip") covers any other one-off situation outside the
 * normal AM/PM schedule, not just an actual field trip. */
export function tripTypeFullLabel(tripType: TripType): string {
  if (tripType === "pickup") return "Morning Pickup";
  if (tripType === "dropoff") return "Afternoon Drop Off";
  if (tripType === "fieldtrip") return "Special";
  return "Other";
}
