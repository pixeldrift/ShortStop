import type { SchoolLevel } from "./types";

/** One schools.csv row's own data - its real address, and which
 * SchoolLevel it is, both looked up by name rather than typed by an
 * admin creating/editing a route (see EditRouteScreen.tsx's school
 * dropdown). lat/lon are Postgres-only additions (schools.csv itself
 * has no such columns, so a row parsed straight from that file - see
 * scripts/geocodeRoute.ts/prototypeOverpassGeocode.ts - always gets
 * null here) - the school's own geocoded location (see
 * scripts/geocodeSchools.ts), null until that's been run for it. */
export interface SchoolInfo {
  address: string;
  schoolLevel: SchoolLevel;
  lat: number | null;
  lon: number | null;
}

const VALID_SCHOOL_LEVELS = new Set<SchoolLevel>(["elementary", "middle", "high"]);

/**
 * Parses the tab-separated schools sheet (school_name, address,
 * school_level - one header row plus one row per school) into the same
 * by-name lookup src/app/api/schools builds straight from Postgres for
 * the running app itself - this reader's own callers now are
 * prisma/seed.ts (populating that table from the real district file at
 * import time) and the geocoding scripts (scripts/geocodeRoute.ts,
 * scripts/prototypeOverpassGeocode.ts), which still work against the
 * real file directly.
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
    const lat = row.lat ? Number(row.lat) : NaN;
    const lon = row.lon ? Number(row.lon) : NaN;
    schools[row.school_name] = {
      address: row.address,
      schoolLevel: row.school_level as SchoolLevel,
      lat: Number.isFinite(lat) ? lat : null,
      lon: Number.isFinite(lon) ? lon : null,
    };
  }
  return schools;
}
