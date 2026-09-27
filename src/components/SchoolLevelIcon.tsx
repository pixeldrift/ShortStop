import {
  ElementarySchoolIcon,
  HighSchoolIcon,
  MapPinIcon,
  SchoolLevelMsIcon,
} from "./icons";
import type { SchoolLevel } from "@/lib/types";

/** Which glyph a given SchoolLevel shows, shared so adding a future
 * level only means updating this one lookup, not independently
 * re-deriving the same choice everywhere a level badge shows up
 * (RouteListScreen, SchoolListScreen). Null (a route not anchored on a
 * real school - see Route.schoolLevel's own doc comment, types.ts)
 * falls back to a plain map pin instead of guessing a level that
 * genuinely doesn't exist.
 *
 * Elementary/high are the alternate, more literal schoolhouse/campus
 * glyphs (elementary-school.svg/high-school.svg) as an experiment -
 * see their own doc comment in icons.tsx for why they don't tint blue/
 * gray the way the rest of this app's icons do. Middle still uses the
 * original three-student-figure SchoolLevelMsIcon - no literal
 * "middle school" glyph exists yet to swap it for. */
export function SchoolLevelIcon({
  level,
  className,
}: {
  level: SchoolLevel | null;
  className?: string;
}) {
  if (level === "elementary") return <ElementarySchoolIcon className={className} />;
  if (level === "middle") return <SchoolLevelMsIcon className={className} />;
  if (level === "high") return <HighSchoolIcon className={className} />;
  return <MapPinIcon className={className} />;
}
