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
 * schema verbatim. A column this can't find becomes a gap for whatever
 * UI sits on top of this (not built yet) to either leave blank or ask a
 * human to map by hand - see `unresolvedRequiredFields` below.
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
   * null if nothing in the sheet matched it - a gap the app's own
   * data for that field will come through empty for, same as a real
   * steps sheet leaving a column blank. */
  sourceHeader: string | null;
  sourceIndex: number | null;
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
    };
  });
}

export interface ImportParseResult {
  delimiter: string;
  mapping: ImportColumnMapping[];
  rows: RawRouteRow[];
  /** Source columns that didn't resolve to any of the app's fields -
   * not an error, just data this import doesn't have a home for yet
   * (kept so a future column-mapping UI could still show it and let a
   * human assign it by hand). */
  unmatchedSourceHeaders: string[];
}

/**
 * Parses a pasted or uploaded CSV/TSV's raw text into the same
 * RawRouteRow shape parseRouteCsvRows produces from the app's own
 * steps sheets, so everything downstream (deriveWaypoints,
 * parseRouteCsv) can consume an import exactly like a native file -
 * one column-matching layer in front, not a second parallel pipeline.
 */
export function parseRouteImport(text: string): ImportParseResult {
  const [headerLine, ...dataLines] = text.trim().split(/\r?\n/);
  const delimiter = detectDelimiter(headerLine);
  const mapping = matchColumns(headerLine, delimiter);

  const headers = headerLine.split(delimiter).map((h) => h.trim());
  const matchedIndices = new Set(
    mapping.map((m) => m.sourceIndex).filter((index): index is number => index !== null),
  );
  const unmatchedSourceHeaders = headers.filter((_, index) => !matchedIndices.has(index));

  const rows: RawRouteRow[] = dataLines
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const values = line.split(delimiter).map((v) => v.trim());
      const valueFor = (field: ImportColumnField): string => {
        const match = mapping.find((m) => m.field === field);
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

  return { delimiter, mapping, rows, unmatchedSourceHeaders };
}

/** Which of the two columns every row genuinely needs (`action`,
 * `fromAt` - see parseRouteCsv.ts) didn't resolve at all. `time` and
 * `side` are optional even on the app's own real schemas (route-120
 * has no `side` column at all; route-125's `time` is always blank), and
 * `ontoAt`/`riderCount`/`notes` are only conditionally needed per-row,
 * not per-sheet - so only these two are worth flagging as a sheet-level
 * problem before a human even looks at individual rows. */
export function unresolvedRequiredFields(mapping: ImportColumnMapping[]): ImportColumnField[] {
  const required: ImportColumnField[] = ["action", "fromAt"];
  return mapping
    .filter((m) => required.includes(m.field) && m.sourceIndex === null)
    .map((m) => m.field);
}
