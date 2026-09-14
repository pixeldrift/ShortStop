import { SchoolLevelEsIcon, SchoolLevelHsIcon, SchoolLevelMsIcon } from "./icons";
import type { SchoolLevel } from "@/lib/types";

/** Which of the three-student-figure glyphs a given SchoolLevel shows
 * (short/medium/tall standing for elementary/middle/high, the matching
 * one drawn solid and the other two faded) - shared so adding a future
 * level only means updating this one lookup, not independently
 * re-deriving the same choice everywhere a level badge shows up
 * (RouteListScreen, SchoolListScreen). */
export function SchoolLevelIcon({
  level,
  className,
}: {
  level: SchoolLevel;
  className?: string;
}) {
  if (level === "elementary") return <SchoolLevelEsIcon className={className} />;
  if (level === "middle") return <SchoolLevelMsIcon className={className} />;
  return <SchoolLevelHsIcon className={className} />;
}
