import type { RawRouteRow } from "./parseRouteCsv";
import type { SchoolInfo } from "./parseSchoolsCsv";

/**
 * The route-import tool's column-resolution layer: takes whatever a
 * district actually sends - a CSV/TSV paste, or a file's raw text -
 * and tries to line its header row up with the app's own schema
 * (time,action,location,from_location,rider_count,side,notes, the same
 * one parseRouteCsvRows already reads) by header *name*, not position -
 * so a sheet with the columns in a different order, extra columns the
 * app doesn't use, or a differently-spelled/spaced header ("From
 * Location" vs "from_location") still resolves, rather than requiring
 * the schema verbatim. Only `action` and `location` are ever required -
 * every other column (time, from_location, rider_count, side, notes) is
 * happily left blank, same as the app's own real steps sheets already
 * leave some of these blank (see parseRouteCsvRows) - so a sheet that's
 * just a plain list of stops, or stops and turns with nothing else,
 * still produces a real route.
 *
 * Also handles a header-less paste - literally one stop per line, or
 * one `action, location[, cross street]` per line, no column names at
 * all - via parseHeaderlessLine below, since "just a plain list, no
 * header row" is a real, simple way for someone to hand this over.
 *
 * A column this can't find becomes a gap for whatever UI sits on top
 * of this to either leave blank or ask a human to map by hand - see
 * `unresolvedRequiredFields` below.
 *
 * Deliberately CSV/TSV text only for now, not an Excel file directly -
 * parsing .xlsx in the browser needs its own library decision (e.g.
 * SheetJS), which is a separate piece of scope from column-matching
 * itself; a spreadsheet app's own "export as CSV" covers the same
 * ground until that's built.
 */

export type ImportColumnField =
  | "time"
  | "action"
  | "location"
  | "fromLocation"
  | "riderCount"
  | "side"
  | "notes"
  | "skip";

// The app's own schema (parseRouteCsvRows) as the canonical header name
// for each field - what an import's own header is matched against
// after normalizing away case/spacing/punctuation differences. The
// older two-column from_at/onto_at shape (and location as merely an
// alternative to it) is gone - `location` (this row's own real
// position, always required) and `from_location` (optional context,
// blank means "infer it") are the only names an import's header row is
// ever matched against now.
const CANONICAL_HEADER_NAMES: Record<ImportColumnField, string> = {
  time: "time",
  action: "action",
  location: "location",
  fromLocation: "from_location",
  riderCount: "rider_count",
  side: "side",
  notes: "notes",
  skip: "skip",
};

// Every field's own canonical name, pre-normalized once - matched
// against an incoming header normalized the same way.
const CANONICAL_FIELDS = Object.keys(CANONICAL_HEADER_NAMES) as ImportColumnField[];

/** Reduces a header to just its letters and digits, lowercased - "From
 * Location", "from_location", "From-Location", and "FROMLOCATION" all
 * normalize identically, so matching only cares whether the same words
 * are present, not how a given sheet chose to case or separate them. */
function normalizeHeaderName(header: string): string {
  return header.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Tab if the header row itself contains one, comma otherwise - same
 * heuristic parseRouteCsvRows already uses for the app's own two real
 * schemas (route-125's comma-separated sheet, route-120's
 * tab-separated one), reused here since an import is expected to be
 * one or the other. */
export function detectDelimiter(headerLine: string): string {
  return headerLine.includes("\t") ? "\t" : ",";
}

// USPS Publication 28's own street-suffix abbreviations, spelled-out
// name -> standard form - just the handful actually likely to show up
// in a district's own steps sheet, not the full USPS list of a few
// hundred. No period on the abbreviated side, matching this app's
// existing house style (every real address already in schools.csv and
// each route's own steps sheet is already written this way - see the
// README/project doc's own conformity note). `circle` is the one
// deliberate deviation from the USPS standard ("Cir") - every real
// steps sheet already committed abbreviates it "Cr" instead (see
// public/data/120-*.csv's own "Rocky Ridge Cr"), so this matches that
// existing real data over the style guide, same conformity note.
const STREET_SUFFIX_ABBREVIATIONS: Record<string, string> = {
  avenue: "Ave",
  boulevard: "Blvd",
  circle: "Cr",
  cove: "Cv",
  court: "Ct",
  crescent: "Cres",
  crossing: "Xing",
  drive: "Dr",
  highway: "Hwy",
  lane: "Ln",
  loop: "Loop",
  parkway: "Pkwy",
  place: "Pl",
  road: "Rd",
  square: "Sq",
  street: "St",
  terrace: "Ter",
  trail: "Trl",
  way: "Way",
};

// Every spelled-out form above maps to its own canonical abbreviation,
// and every already-abbreviated form maps to that same canonical
// spelling too (so "Rd.", "RD", and "rd" all settle on "Rd" the same
// as "Road" does) - one lookup covers both directions, casing and
// stray punctuation included.
const STREET_SUFFIX_CANONICAL: Record<string, string> = Object.fromEntries(
  Object.entries(STREET_SUFFIX_ABBREVIATIONS).flatMap(([full, abbr]) => [
    [full, abbr],
    [abbr.toLowerCase(), abbr],
  ]),
);

/** Normalizes a road name's own trailing suffix ("Road"/"Rd."/"RD" all
 * become "Rd") to this app's existing address style. Only ever touches
 * the very last word - an intersection's second road ("Main St & Oak
 * Ave") is already its own separate location/fromLocation value (see
 * RawRouteRow), so each call here only ever sees one road name - which
 * leaves the house number, the road's own name, and anything else
 * about the string untouched. A last word this doesn't recognize as a
 * suffix at all (a numbered highway's own trailing route number, a
 * road genuinely named "Broadway") passes straight through unchanged
 * rather than guessing. */
export function normalizeStreetSuffix(text: string): string {
  const match = text.match(/^(.*\s)([A-Za-z]+)\.?\s*$/);
  if (!match) return text;
  const [, prefix, lastWord] = match;
  const canonical = STREET_SUFFIX_CANONICAL[lastWord.toLowerCase()];
  return canonical ? `${prefix}${canonical}` : text;
}

export interface ImportColumnMapping {
  field: ImportColumnField;
  /** The imported sheet's own header text this field resolved to, or
   * null if there was no real header to resolve against at all
   * (header-less input) or nothing in a real header matched. */
  sourceHeader: string | null;
  sourceIndex: number | null;
  /** True once this field is actually populated in the parsed rows -
   * via a matched header column, or (header-less input, see
   * parseHeaderlessLine) via its own always-fills-in fallback, which
   * has no real "source column" to point to but still isn't a gap.
   * `unresolvedRequiredFields` reads this, not sourceIndex, so a
   * header-less import that worked doesn't get flagged as if it
   * hadn't. */
  resolved: boolean;
}

/** Matches each of the app's canonical fields against the imported
 * header row by normalized name - column order and how many columns
 * the source sheet has don't matter, only whether some header
 * normalizes to the same thing a canonical one does. A field with no
 * match at all (not present under any spelling) comes back with a null
 * `sourceHeader`/`sourceIndex` rather than guessing. */
export function matchColumns(headerLine: string, delimiter: string): ImportColumnMapping[] {
  const headers = headerLine.split(delimiter).map((h) => h.trim());
  const normalizedHeaders = headers.map(normalizeHeaderName);

  return CANONICAL_FIELDS.map((field) => {
    const target = normalizeHeaderName(CANONICAL_HEADER_NAMES[field]);
    const index = normalizedHeaders.findIndex((h) => h === target);
    return {
      field,
      sourceHeader: index === -1 ? null : headers[index],
      sourceIndex: index === -1 ? null : index,
      resolved: index !== -1,
    };
  });
}

// A line the doc's own schema already recognizes as an action, not a
// location - "Stop", a turn's own direction, or one of the dropdown's
// other waypoint types (StepRowEditor's own Type select). Matched
// case-insensitively against a header-less line's first cell to tell
// "this line names its own action" apart from "this line is just a
// bare location" (see parseHeaderlessLine). Exported so
// EditRouteScreen.tsx's own row-level validity check (a row's
// `action` genuinely being one of these, not just non-blank) reads off
// this same list rather than a second copy of it that could drift out
// of sync - "complete" included here even though StepRowEditor's own
// Type select doesn't offer it as a pick (see deriveWaypoints.ts's
// PLACE_ACTIONS), so a route that already has one isn't wrongly
// flagged as invalid.
export const RECOGNIZED_ACTIONS = new Set([
  "stop",
  "left",
  "right",
  "continue",
  "u-turn",
  "turn around",
  "proceed",
  "pull over",
  "return",
  "depart",
  "arrive",
  "complete",
]);

/** Splits "Road A & Road B" (or "Road A and Road B") into its two road
 * names - the plain-English way a human would write a cross-street
 * pair with nothing else around it. Returns null for a line that isn't
 * that shape at all (a plain single address, say), so the caller can
 * fall back to treating the whole line as one literal address. */
function splitIntersectionText(text: string): { from: string; location: string } | null {
  const ampersand = text.split(/\s+&\s+/);
  if (ampersand.length === 2) return { from: ampersand[0].trim(), location: ampersand[1].trim() };
  const and = text.split(/\s+and\s+/i);
  if (and.length === 2) return { from: and[0].trim(), location: and[1].trim() };
  return null;
}

/**
 * Parses one line of a header-less plain-text import - there's no
 * column-name row to match against at all, so each line is read on its
 * own: `action, location[, cross street]` if it starts with a
 * recognized action word (the "list of stops and turns" case), or -
 * the plainer "just a list of stops, nothing more" case - the whole
 * line as one Stop's own location, split into a cross-street pair
 * first if it reads as "Road A & Road B" (so it still resolves as a
 * real intersection lookup via Overpass rather than free-text search
 * on the whole string - see overpassGeocode.ts) and otherwise kept as
 * one literal address.
 */
function parseHeaderlessLine(line: string, delimiter: string): RawRouteRow {
  const cells = line.split(delimiter).map((c) => c.trim());
  const firstWord = cells[0]?.toLowerCase();

  if (cells.length >= 2 && RECOGNIZED_ACTIONS.has(firstWord)) {
    // A second value (a cross street/context road) makes the *first*
    // one the from-context and the second the row's own real location
    // ("Left, Main St, Oak Ave" reads as "from Main St, onto Oak Ave")
    // - with only one value given, that lone value is this row's own
    // location outright (the destination-only shorthand), and
    // fromLocation is left blank for deriveWaypoints.ts to infer.
    const hasCrossStreet = Boolean(cells[2]);
    return {
      action: cells[0],
      location: normalizeStreetSuffix(hasCrossStreet ? (cells[2] ?? "") : (cells[1] ?? "")),
      fromLocation: hasCrossStreet ? normalizeStreetSuffix(cells[1] ?? "") : "",
      riderCount: "",
      side: "",
      notes: "",
      skip: false,
    };
  }

  const intersection = splitIntersectionText(line.trim());
  return {
    action: "Stop",
    location: normalizeStreetSuffix(intersection?.location ?? line.trim()),
    fromLocation: normalizeStreetSuffix(intersection?.from ?? ""),
    riderCount: "",
    side: "",
    notes: "",
    skip: false,
  };
}

export interface ImportParseResult {
  delimiter: string;
  mapping: ImportColumnMapping[];
  rows: RawRouteRow[];
  /** Source columns that didn't resolve to any of the app's fields -
   * not an error, just data this import doesn't have a home for yet
   * (kept so a future column-mapping UI could still show it and let a
   * human assign it by hand). Always empty for a header-less import -
   * there's no header row to have leftover columns from. */
  unmatchedSourceHeaders: string[];
  /** True if no real header row was found and every line (including
   * what would otherwise be line one) was parsed as data via
   * parseHeaderlessLine - lets a caller explain *why* from_location/
   * rider_count/side/notes came through blank, rather than that just
   * looking like a failed import. */
  headerless: boolean;
}

/**
 * Parses a pasted or uploaded CSV/TSV's raw text into the same
 * RawRouteRow shape parseRouteCsvRows produces from the app's own
 * steps sheets, so everything downstream (deriveWaypoints,
 * parseRouteCsv) can consume an import exactly like a native file -
 * one column-matching layer in front, not a second parallel pipeline.
 * Falls back to parseHeaderlessLine (see above) when the first line
 * doesn't resolve to any recognized column name at all - the one real
 * ambiguity that leaves: a genuine header row using only unrecognized
 * synonyms for every column reads as "no header" too, and becomes one
 * bogus Stop row (its own header text, misread as a location) rather
 * than a mapping error - a narrow, accepted edge case given how much
 * more useful a real header-less paste supporting this makes the
 * import.
 */
export function parseRouteImport(text: string): ImportParseResult {
  const lines = text
    .trim()
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  const [firstLine] = lines;
  const delimiter = detectDelimiter(firstLine ?? "");
  const headerMapping = matchColumns(firstLine ?? "", delimiter);
  const hasRecognizedHeader = headerMapping.some((m) => m.resolved);

  if (!hasRecognizedHeader) {
    const rows = lines.map((line) => parseHeaderlessLine(line, delimiter));
    const mapping: ImportColumnMapping[] = CANONICAL_FIELDS.map((field) => ({
      field,
      sourceHeader: null,
      sourceIndex: null,
      // parseHeaderlessLine always fills these two in (defaulting
      // action to "Stop" and location to the whole line) - every other
      // field genuinely has no source in a header-less paste.
      resolved: field === "action" || field === "location",
    }));
    return { delimiter, mapping, rows, unmatchedSourceHeaders: [], headerless: true };
  }

  const dataLines = lines.slice(1);
  const headers = firstLine.split(delimiter).map((h) => h.trim());
  const matchedIndices = new Set(
    headerMapping.map((m) => m.sourceIndex).filter((index): index is number => index !== null),
  );
  const unmatchedSourceHeaders = headers.filter((_, index) => !matchedIndices.has(index));

  const rows: RawRouteRow[] = dataLines.map((line) => {
    const values = line.split(delimiter).map((v) => v.trim());
    const valueFor = (field: ImportColumnField): string => {
      const match = headerMapping.find((m) => m.field === field);
      return match?.sourceIndex != null ? (values[match.sourceIndex] ?? "") : "";
    };
    return {
      action: valueFor("action"),
      location: normalizeStreetSuffix(valueFor("location")),
      fromLocation: normalizeStreetSuffix(valueFor("fromLocation")),
      riderCount: valueFor("riderCount"),
      side: valueFor("side"),
      notes: valueFor("notes"),
      skip: valueFor("skip") === "true",
    };
  });

  return { delimiter, mapping: headerMapping, rows, unmatchedSourceHeaders, headerless: false };
}

/** Which of the two columns every row genuinely needs (`action`,
 * `location` - see parseRouteCsv.ts) didn't resolve at all. `time` and
 * `side` are optional even on the app's own real schemas (route-120
 * has no `side` column at all; route-125's `time` is always blank), and
 * `fromLocation`/`riderCount`/`notes` are only conditionally needed
 * per-row, not per-sheet - so only these two are worth flagging as a
 * sheet-level problem before a human even looks at individual rows.
 * Always empty for a header-less import - parseHeaderlessLine
 * guarantees both by construction (see `resolved` on
 * ImportColumnMapping). */
export function unresolvedRequiredFields(mapping: ImportColumnMapping[]): ImportColumnField[] {
  const required: ImportColumnField[] = ["action", "location"];
  return mapping.filter((m) => required.includes(m.field) && !m.resolved).map((m) => m.field);
}

/** Down to just letters/digits/spaces, lowercased and collapsed - a
 * school's own name and address, and whatever text a Depart/Arrive row
 * carries for either, all normalize the same way regardless of
 * punctuation or casing differences between the district's sheet and
 * this app's own schools table. */
function normalizeForSchoolMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Guesses which of this app's known schools an imported sheet's own
 * Depart/Arrive rows describe - deriveWaypoints.ts already treats
 * those two actions as "a literal place, not a road" (PLACE_ACTIONS),
 * and a district's real sheet backs that up: their lone value is
 * either the school's street address or its plain name ("LaVergne Lake
 * Elementary School"), never a road. Matched against both the name and
 * address this app already has on file for every school (`schools`,
 * from Postgres) - whichever the sheet happens to use - so
 * EditRouteScreen's "Add New Route" upload can prefill the School
 * dropdown instead of leaving an admin to notice and pick it by hand
 * from data that's already sitting right there in the file.
 *
 * Deliberately conservative: only ever returns a name when every
 * matching Depart/Arrive row agrees on exactly one school - a sheet
 * with no recognizable place text, or text that's ambiguous enough to
 * match more than one school, comes back null rather than guessing
 * wrong and silently mis-tagging a route's own school.
 */
export function matchSchoolFromRows(
  rows: RawRouteRow[],
  schools: Record<string, SchoolInfo>,
): string | null {
  const candidates = rows
    .filter((r) => ["depart", "arrive"].includes(r.action.trim().toLowerCase()))
    .map((r) => normalizeForSchoolMatch(r.location))
    .filter((text) => text.length >= 4);
  if (candidates.length === 0) return null;

  const schoolEntries = Object.entries(schools).map(([name, info]) => ({
    name,
    normalizedName: normalizeForSchoolMatch(name),
    normalizedAddress: normalizeForSchoolMatch(info.address),
  }));

  const matchedNames = new Set<string>();
  for (const candidate of candidates) {
    for (const school of schoolEntries) {
      const nameMatch =
        school.normalizedName.length >= 4 &&
        (candidate === school.normalizedName ||
          candidate.includes(school.normalizedName) ||
          school.normalizedName.includes(candidate));
      const addressMatch =
        school.normalizedAddress.length >= 4 &&
        (candidate === school.normalizedAddress ||
          candidate.includes(school.normalizedAddress) ||
          school.normalizedAddress.includes(candidate));
      if (nameMatch || addressMatch) matchedNames.add(school.name);
    }
  }
  return matchedNames.size === 1 ? [...matchedNames][0] : null;
}
