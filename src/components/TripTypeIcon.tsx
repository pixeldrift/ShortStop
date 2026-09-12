import { AmIcon, FlagIcon, PmIcon } from "./icons";
import type { TripType } from "@/lib/types";

/** Which icon a trip-type badge shows - shared so adding a future
 * TripType only means updating this one component, not independently
 * re-deriving the same icon choice in every place (TopBar,
 * StartScreen, RouteListScreen, EditRouteScreen) that already shows
 * one of these badges. AmIcon/PmIcon (am.svg/pm.svg) carry their own
 * "AM"/"PM" lettering baked right into the glyph, so a pickup/dropoff
 * badge is just this icon alone now, sized to match whatever it sits
 * beside - no separate tripTypeLabel (lib/tripType.ts) text next to
 * it anymore. FlagIcon has no such lettering of its own, so a
 * "fieldtrip"/"other" badge is the one case that still needs its
 * caller to show that text label alongside it. */
export function TripTypeIcon({
  tripType,
  className,
}: {
  tripType: TripType;
  className?: string;
}) {
  if (tripType === "pickup") return <AmIcon className={className} />;
  if (tripType === "dropoff") return <PmIcon className={className} />;
  return <FlagIcon className={className} />;
}
