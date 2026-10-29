import { MapPinIcon, SchoolLevelEsIcon, SchoolLevelHsIcon, SchoolLevelMsIcon } from "./icons";
import type { SchoolLevel } from "@/lib/types";

/** Which glyph a given SchoolLevel shows, shared so adding a future
 * level only means updating this one lookup, not independently
 * re-deriving the same choice everywhere a level badge shows up
 * (RouteListScreen, SchoolListScreen). Null (a route not anchored on a
 * real school - see Route.schoolLevel's own doc comment, types.ts)
 * falls back to a plain map pin instead of guessing a level that
 * genuinely doesn't exist.
 *
 * All three are the same three-student-figure glyph with the matching
 * level's figure emphasized (see icons.tsx) - a literal schoolhouse
 * per level was tried and read as too detailed/inconsistent at badge
 * size. */
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
