import { MapPinIcon, SchoolLevelEsIcon, SchoolLevelHsIcon, SchoolLevelMsIcon } from "./icons";
import type { SchoolLevel } from "@/lib/types";

/** Which of the three-student-figure glyphs a given SchoolLevel shows
 * (elementary/middle/high, each its own file under ./icons/, matching
 * figure solid and the other two faded to .4 opacity - baked into the
 * SVG itself, see icons.tsx's own doc comment) - shared so adding a
 * future level only means updating this one lookup, not independently
 * re-deriving the same choice everywhere a level badge shows up
 * (RouteListScreen, SchoolListScreen). Null (a route not anchored on a
 * real school - see Route.schoolLevel's own doc comment, types.ts)
 * falls back to a plain map pin instead of guessing a level that
 * genuinely doesn't exist. */
export function SchoolLevelIcon({
  level,
  className,
}: {
  level: SchoolLevel | null;
  className?: string;
}) {
  if (level === "elementary") return <SchoolLevelEsIcon className={className} />;
  if (level === "middle") return <SchoolLevelMsIcon className={className} />;
  if (level === "high") return <SchoolLevelHsIcon className={className} />;
  return <MapPinIcon className={className} />;
}
