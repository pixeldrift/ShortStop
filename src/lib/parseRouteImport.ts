import type { RawRouteRow } from "./parseRouteCsv";

/**
 * The route-import tool's column-resolution layer (see README, "Next
 * steps" - "A route import tool"): takes whatever a district actually
 * sends - a CSV/TSV paste, or a file's raw text - and tries to line its
 * header row up with the app's own schema
 * (time,action,from_at,onto_at,rider_count,side,notes, the same one
 * parseRouteCsvRows already reads) by header *name*, not position - so
 * a sheet with the columns in a different order, extra columns the app
 * doesn't use, or a differently-spelled/spaced header
 * ("From At" vs "from_at") still resolves, rather than requiring the
 * schema verbatim. Only `action` and `from_at` are ever required -
 * every other column (time, onto_at, rider_count, side, notes) is
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
  | "fromAt"
  | "ontoAt"
  | "location"
  | "riderCount"
  | "side"
  | "notes"
  | "skip";

// The app's own schema (parseRouteCsvRows) as the canonical header name
// for each field - what an import's own header is matched against
// after normalizing away case/spacing/punctuation differences.
//
// `location` is a second, newer shape for the same road-tracking data
// `fromAt`/`ontoAt` hold - one column per row ("action, location") that
// only ever names the single road that row's action or direction
// happens on, leaning on deriveWaypoints.ts's existing "derive from
// whatever road was already tracked" logic for everything else, rather
// than restating both sides of an intersection every row. Kept as an
// alternative to `fromAt`/`ontoAt`, not a replacement - see `valueFor`
// below - since a district sheet already written the older two-column
// way should keep importing exactly as it always has.
const CANONICAL_HEADER_NAMES: Record<ImportColumnField, string> = {
  time: "time",
  action: "action",
  fromAt: "from_at",
  ontoAt: "onto_at",
  location: "location",
  riderCount: "rider_count",
  side: "side",
  notes: "notes",
  skip: "skip",
};

// Every field's own canonical name, pre-normalized once - matched
// against an incoming header normalized the same way.
const CANONICAL_FIELDS = Object.keys(CANONICAL_HEADER_NAMES) as ImportColumnField[];

/** Reduces a header to just its letters and digits, lowercased - "From
 * At", "from_at", "From-At", and "FROMAT" all normalize identically, so
 * matching only cares whether the same words are present, not how a
 * given sheet chose to case or separate them. */
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
 * Ave") is already its own separate fromAt/ontoAt value (see
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
// bare location" (see parseHeaderlessLine).
const RECOGNIZED_ACTIONS = new Set([
  "stop",
  "left",
  "right",
  "proceed",
  "turn around",
  "pull over",
  "return",
  "depart",
  "arrive",
  "continue",
  "complete",
]);

/** Splits "Road A & Road B" (or "Road A and Road B") into its two road
 * names - the plain-English way a human would write a cross-street
 * pair with nothing else around it. Returns null for a line that isn't
 * that shape at all (a plain single address, say), so the caller can
 * fall back to treating the whole line as one literal address. */
function splitIntersectionText(text: string): { fromAt: string; ontoAt: string } | null {
  const ampersand = text.split(/\s+&\s+/);
  if (ampersand.length === 2) return { fromAt: ampersand[0].trim(), ontoAt: ampersand[1].trim() };
  const and = text.split(/\s+and\s+/i);
  if (and.length === 2) return { fromAt: and[0].trim(), ontoAt: and[1].trim() };
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
    return {
      action: cells[0],
      fromAt: normalizeStreetSuffix(cells[1] ?? ""),
      ontoAt: normalizeStreetSuffix(cells[2] ?? ""),
      riderCount: "",
      side: "",
      notes: "",
      skip: false,
    };
  }

  const intersection = splitIntersectionText(line.trim());
  return {
    action: "Stop",
    fromAt: normalizeStreetSuffix(intersection?.fromAt ?? line.trim()),
    ontoAt: normalizeStreetSuffix(intersection?.ontoAt ?? ""),
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
   * parseHeaderlessLine - lets a caller explain *why* onto_at/
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
      // action to "Stop" and fromAt to the whole line) - every other
      // field genuinely has no source in a header-less paste.
      resolved: field === "action" || field === "fromAt",
    }));
    return { delimiter, mapping, rows, unmatchedSourceHeaders: [], headerless: true };
  }

  const dataLines = lines.slice(1);
  const headers = firstLine.split(delimiter).map((h) => h.trim());
  const matchedIndices = new Set(
    headerMapping.map((m) => m.sourceIndex).filter((index): index is number => index !== null),
  );
  const unmatchedSourceHeaders = headers.filter((_, index) => !matchedIndices.has(index));

  const locationResolved = headerMapping.some((m) => m.field === "location" && m.resolved);

  const rows: RawRouteRow[] = dataLines.map((line) => {
    const values = line.split(delimiter).map((v) => v.trim());
    const valueFor = (field: ImportColumnField): string => {
      const match = headerMapping.find((m) => m.field === field);
      return match?.sourceIndex != null ? (values[match.sourceIndex] ?? "") : "";
    };
    // A sheet using the newer single-`location` shape (see
    // CANONICAL_HEADER_NAMES above) has no `onto_at` of its own at all
    // - deriveWaypoints.ts derives it from whichever road was already
    // tracked, the same way it already does for a lone-value turn.
    return {
      action: valueFor("action"),
      fromAt: normalizeStreetSuffix(locationResolved ? valueFor("location") : valueFor("fromAt")),
      ontoAt: locationResolved ? "" : normalizeStreetSuffix(valueFor("ontoAt")),
      riderCount: valueFor("riderCount"),
      side: valueFor("side"),
      notes: valueFor("notes"),
      skip: valueFor("skip") === "true",
    };
  });

  return { delimiter, mapping: headerMapping, rows, unmatchedSourceHeaders, headerless: false };
}

/** Which of the two columns every row genuinely needs (`action`,
 * `fromAt` - see parseRouteCsv.ts) didn't resolve at all. `time` and
 * `side` are optional even on the app's own real schemas (route-120
 * has no `side` column at all; route-125's `time` is always blank), and
 * `ontoAt`/`riderCount`/`notes` are only conditionally needed per-row,
 * not per-sheet - so only these two are worth flagging as a sheet-level
 * problem before a human even looks at individual rows. Always empty
 * for a header-less import - parseHeaderlessLine guarantees both by
 * construction (see `resolved` on ImportColumnMapping).
 *
 * A resolved `location` column (see CANONICAL_HEADER_NAMES) satisfies
 * `fromAt`'s own requirement too - it's the same road-tracking data
 * under the newer single-column shape (parseRouteImport feeds it into
 * every row's own `fromAt`), so a sheet using only `location` shouldn't
 * be flagged as missing `fromAt` just because it never had a column by
 * that literal name. */
export function unresolvedRequiredFields(mapping: ImportColumnMapping[]): ImportColumnField[] {
  const locationResolved = mapping.some((m) => m.field === "location" && m.resolved);
  const required: ImportColumnField[] = ["action", "fromAt"];
  return mapping
    .filter((m) => required.includes(m.field) && !m.resolved)
    .filter((m) => !(m.field === "fromAt" && locationResolved))
    .map((m) => m.field);
}
