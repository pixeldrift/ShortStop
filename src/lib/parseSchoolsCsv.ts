import type { SchoolLevel } from "./types";

/** One schools.csv row's own data - its real address, and which
 * SchoolLevel it is, both looked up by name rather than typed by an
 * admin creating/editing a route (see EditRouteScreen.tsx's school
 * dropdown). */
export interface SchoolInfo {
  address: string;
  schoolLevel: SchoolLevel;
}

const VALID_SCHOOL_LEVELS = new Set<SchoolLevel>(["elementary", "middle", "high"]);

/**
 * Parses the tab-separated schools sheet (school_name, address,
 * school_level - one header row plus one row per school) into a
 * lookup by school name, for merging into route metadata alongside
 * whatever the master list and each route's own steps CSV provide
 * (see page.tsx and scripts/geocodeRoute.ts), and for populating
 * EditRouteScreen's own school picker directly - a route's school is
 * chosen from this table, not typed freehand, so its address and
 * level always come from here rather than an admin's own guess.
 *
 * A row whose school_level isn't one of SchoolLevel's own three real
 * values is dropped (logged, not silently miscategorized) rather than
 * guessed at - the same "surface it, don't fake it" approach this
 * project already takes for a route row with no computable duration
 * (see page.tsx).
 */
export function parseSchoolsCsv(csvText: string): Record<string, SchoolInfo> {
  const [headerLine, ...dataLines] = csvText.trim().split(/\r?\n/);
  const headers = headerLine.split("\t").map((h) => h.trim());

  const schools: Record<string, SchoolInfo> = {};
  for (const line of dataLines) {
    if (!line.trim()) continue;
    const values = line.split("\t").map((v) => v.trim());
    const row = Object.fromEntries(headers.map((header, i) => [header, values[i] ?? ""]));
    if (!VALID_SCHOOL_LEVELS.has(row.school_level as SchoolLevel)) {
      console.warn(`Schools sheet row "${row.school_name}" has no recognized school_level - skipped`);
      continue;
    }
    schools[row.school_name] = { address: row.address, schoolLevel: row.school_level as SchoolLevel };
  }
  return schools;
}
