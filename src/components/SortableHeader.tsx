"use client";

import { SortIcon } from "./icons";

export type SortDir = "asc" | "desc";

/** One clickable, sortable column header - label plus the traditional
 * stacked up/down carets (SortIcon), which always render but only show
 * the active direction solid once this is the column being sorted by.
 * Generic over `F` (the caller's own field-name union) so both
 * RouteListScreen and SchoolListScreen's tables share this one
 * component instead of each keeping its own copy. */
export function SortableHeader<F extends string>({
  label,
  field,
  align = "left",
  padded = true,
  fill = false,
  sortField,
  sortDir,
  onSort,
}: {
  /** Usually a plain string - a `ReactNode` is only for a header that
   * needs its own internal layout (RouteListScreen's stacked "AM"/"PM"
   * label, say), not a general escape hatch. */
  label: React.ReactNode;
  field: F;
  align?: "left" | "center" | "right";
  /** This header's own leading gutter (pl-3, none if it's the first in
   * its row) - on by default, off for a header row that gets its
   * spacing from the shared grid's own gap and centered text instead
   * of a per-button padding. */
  padded?: boolean;
  /** Fills its whole grid cell instead of shrinking to its own label+
   * icon width - used for a narrow first column (e.g. "#"), whose tiny
   * label alone would otherwise be a cramped tap target hugging the
   * row's left edge. */
  fill?: boolean;
  sortField: F;
  sortDir: SortDir;
  onSort: (field: F) => void;
}) {
  const active = sortField === field;
  const justify = align === "right" ? "justify-end" : align === "center" ? "justify-center" : "";
  return (
    <button
      type="button"
      onClick={() => onSort(field)}
      className={`flex items-center gap-1 bg-transparent ${fill ? "h-full w-full" : ""} ${
        padded ? "pl-3 first:pl-0" : ""
      } ${justify} ${active ? "text-zinc-700" : ""}`}
    >
      <span>{label}</span>
      <SortIcon direction={active ? sortDir : "none"} className="h-2.5 w-2.5 shrink-0" />
    </button>
  );
}
