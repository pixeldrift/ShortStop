import type { SchoolLevel } from "./types";

/** The plain-English form of a SchoolLevel - IconTooltip.tsx's own
 * label for SchoolLevelIcon, the same "the icon alone has no text"
 * problem tripTypeFullLabel (tripType.ts) already solves for
 * TripTypeIcon. Null (a route not anchored on a real school - see
 * Route.schoolLevel's own doc comment, types.ts) has nothing real to
 * name, so callers skip the tooltip entirely rather than showing one
 * for a level that doesn't exist. */
export function schoolLevelLabel(level: SchoolLevel): string {
  if (level === "elementary") return "Elementary";
  if (level === "middle") return "Middle School";
  return "High School";
}
