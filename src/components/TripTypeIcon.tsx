import { FlagIcon, SunIcon, SunriseIcon } from "./icons";
import type { TripType } from "@/lib/types";

/** Which icon a trip-type badge shows next to its own "AM"/"PM"/"Field
 * Trip" label (tripTypeLabel, lib/tripType.ts) - shared so adding a
 * future TripType only means updating this one component, not
 * independently re-deriving the same icon choice in every place
 * (TopBar, StartScreen, RouteListScreen, EditRouteScreen, StepScreen)
 * that already shows one of these badges. */
export function TripTypeIcon({ tripType, className }: { tripType: TripType; className?: string }) {
  if (tripType === "pickup") return <SunriseIcon className={className} />;
  if (tripType === "dropoff") return <SunIcon className={className} />;
  return <FlagIcon className={className} />;
}
