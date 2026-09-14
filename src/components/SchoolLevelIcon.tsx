import { ElementarySchoolIcon, HighSchoolIcon, MiddleSchoolIcon } from "./icons";
import type { SchoolLevel } from "@/lib/types";

/** Which schoolhouse glyph a given SchoolLevel shows - shared so
 * adding a future level only means updating this one lookup, not
 * independently re-deriving the same choice everywhere a level badge
 * shows up (RouteListScreen, SchoolListScreen). */
export function SchoolLevelIcon({
  level,
  className,
}: {
  level: SchoolLevel;
  className?: string;
}) {
  if (level === "elementary") return <ElementarySchoolIcon className={className} />;
  if (level === "middle") return <MiddleSchoolIcon className={className} />;
  return <HighSchoolIcon className={className} />;
}
