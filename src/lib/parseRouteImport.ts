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

export type ImportColumnField = "time" | "action" | "fromAt" | "ontoAt" | "riderCount" | "side" | "notes";

// The app's own schema (parseRouteCsvRows) as the canonical header name
// for each field - what an import's own header is matched against
// after normalizing away case/spacing/punctuation differences.
const CANONICAL_HEADER_NAMES: Record<ImportColumnField, string> = {
  time: "time",
  action: "action",
  fromAt: "from_at",
  ontoAt: "onto_at",
  riderCount: "rider_count",
  side: "side",
  notes: "notes",
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
// location - "Stop", or a turn's own direction. Matched case-
// insensitively against a header-less line's first cell to tell "this
// line names its own action" apart from "this line is just a bare
// location" (see parseHeaderlessLine).
const RECOGNIZED_ACTIONS = new Set(["stop", "left", "right"]);

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
      fromAt: cells[1] ?? "",
      ontoAt: cells[2] ?? "",
      riderCount: "",
      side: "",
      notes: "",
    };
  }

  const intersection = splitIntersectionText(line.trim());
  return {
    action: "Stop",
    fromAt: intersection?.fromAt ?? line.trim(),
    ontoAt: intersection?.ontoAt ?? "",
    riderCount: "",
    side: "",
    notes: "",
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

  const rows: RawRouteRow[] = dataLines.map((line) => {
    const values = line.split(delimiter).map((v) => v.trim());
    const valueFor = (field: ImportColumnField): string => {
      const match = headerMapping.find((m) => m.field === field);
      return match?.sourceIndex != null ? (values[match.sourceIndex] ?? "") : "";
    };
    return {
      action: valueFor("action"),
      fromAt: valueFor("fromAt"),
      ontoAt: valueFor("ontoAt"),
      riderCount: valueFor("riderCount"),
      side: valueFor("side"),
      notes: valueFor("notes"),
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
 * construction (see `resolved` on ImportColumnMapping). */
export function unresolvedRequiredFields(mapping: ImportColumnMapping[]): ImportColumnField[] {
  const required: ImportColumnField[] = ["action", "fromAt"];
  return mapping.filter((m) => required.includes(m.field) && !m.resolved).map((m) => m.field);
}

/**
 * The inverse of parsing - turns RawRouteRow[] back into the app's own
 * comma-separated schema, header row included. Used by
 * EditRouteScreen.tsx to persist its structured, editable stop list
 * (added/removed/edited rows, not raw text) through the same
 * text-shaped storage page.tsx already uses for every route's steps -
 * round-tripping through this rather than changing that storage shape
 * itself. Re-parsing this output (parseRouteImport) always finds a
 * real header (every one of these column names matches exactly), so
 * it never takes the header-less path back.
 */
export function rowsToCsvText(rows: RawRouteRow[]): string {
  const header = "action,from_at,onto_at,rider_count,side,notes";
  const lines = rows.map((row) =>
    [row.action, row.fromAt, row.ontoAt, row.riderCount, row.side, row.notes].join(","),
  );
  return [header, ...lines].join("\n");
}
