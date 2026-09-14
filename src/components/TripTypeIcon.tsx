import { AmIcon, PmIcon, StarIcon } from "./icons";
import type { TripType } from "@/lib/types";

/** Which icon a trip-type badge shows - shared so adding a future
 * TripType only means updating this one component, not independently
 * re-deriving the same icon choice in every place (TopBar,
 * StartScreen, RouteListScreen, EditRouteScreen) that already shows
 * one of these badges. AmIcon/PmIcon now point at what used to be the
 * alternate am-alt.svg/pm-alt.svg pair (a sunrise/full-sun pictograph,
 * swapped in app-wide) - unlike the original am.svg/pm.svg, neither
 * carries literal "AM"/"PM" lettering baked into the glyph, so a
 * pickup/dropoff badge now leans on the sunrise-vs-full-sun shape
 * alone wherever it isn't already sitting next to its own text (a
 * table header's own "AM"/"PM" column label, say). StarIcon has no
 * lettering of its own either, so a "fieldtrip"/"other" badge is
 * still the one case that needs its caller to show a text label
 * alongside it. */
export function TripTypeIcon({
  tripType,
  className,
}: {
  tripType: TripType;
  className?: string;
}) {
  if (tripType === "pickup") return <AmIcon className={className} />;
  if (tripType === "dropoff") return <PmIcon className={className} />;
  return <StarIcon className={className} />;
}
