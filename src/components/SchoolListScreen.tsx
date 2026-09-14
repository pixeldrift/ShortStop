"use client";

import { useMemo, useState } from "react";
import {
  BackArrowIcon,
  CloseIcon,
  MailIcon,
  MapPinIcon,
  RouteIcon,
  SchoolIcon,
  SearchIcon,
} from "./icons";
import { SchoolLevelIcon } from "./SchoolLevelIcon";
import { SortableHeader } from "./SortableHeader";
import type { SortDir } from "./SortableHeader";
import { cityFromAddress, streetFromAddress } from "@/lib/address";
import type { SchoolInfo } from "@/lib/parseSchoolsCsv";
import type { Route, SchoolLevel } from "@/lib/types";

/** Same three school levels RouteListScreen's own SCHOOL_LEVEL_TOGGLES
 * filters by, here as icon buttons instead of ES/MS/HS text - shown
 * beside the search bar rather than stacked above/below it, so the
 * bar has room to stay full height next to them. */
const SCHOOL_LEVELS: SchoolLevel[] = ["elementary", "middle", "high"];

type SchoolSortField = "name" | "city" | "routes";

/**
 * Companion screen to RouteListScreen, reached via its "Schools" link -
 * every real district school (schools.csv/Postgres' `School` table, via
 * the same `schools` lookup page.tsx already loads for EditRouteScreen's
 * own school picker), searchable by name or city, sorted by name
 * alphabetically by default - same sortable-header convention as the
 * route list's own table (SortableHeader, shared between both). Tapping
 * a row hands its name up to `onSelectSchool`, which page.tsx uses to
 * open a school-scoped RouteListScreen (see its own `school-routes`
 * screen kind) - this screen itself only ever shows school details,
 * never route data beyond each one's own route count.
 *
 * Every real school here is a Rutherford County one today (see the
 * small district label above the heading).
 */
export function SchoolListScreen({
  schools,
  routes,
  onSelectSchool,
  onBack,
}: {
  schools: Record<string, SchoolInfo>;
  /** Every route (real and demo) - only used to count how many serve
   * each school (a demo route's own fabricated school name never
   * matches a real one, so it never inflates a real school's count). */
  routes: Route[];
  onSelectSchool: (schoolName: string) => void;
  onBack: () => void;
}) {
  const [query, setQuery] = useState("");
  const [sortField, setSortField] = useState<SchoolSortField>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  // Empty set shows every level - same convention RouteListScreen's own
  // trip-type/school-level toggles already use, rather than picking one
  // exclusive view.
  const [activeLevels, setActiveLevels] = useState<ReadonlySet<SchoolLevel>>(
    () => new Set(),
  );

  const toggleSort = (field: SchoolSortField) => {
    if (field === sortField) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  function toggleLevel(level: SchoolLevel) {
    setActiveLevels((prev) => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
  }

  const routeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const route of routes) {
      counts[route.schoolName] = (counts[route.schoolName] ?? 0) + 1;
    }
    return counts;
  }, [routes]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matching = Object.entries(schools).filter(
      ([name, info]) =>
        (activeLevels.size === 0 || activeLevels.has(info.schoolLevel)) &&
        (!q ||
          name.toLowerCase().includes(q) ||
          cityFromAddress(info.address).toLowerCase().includes(q)),
    );

    const compare = (
      a: [string, SchoolInfo],
      b: [string, SchoolInfo],
    ): number => {
      if (sortField === "city") {
        return cityFromAddress(a[1].address).localeCompare(
          cityFromAddress(b[1].address),
        );
      }
      if (sortField === "routes") {
        return (routeCounts[a[0]] ?? 0) - (routeCounts[b[0]] ?? 0);
      }
      return a[0].localeCompare(b[0]);
    };

    return [...matching].sort((a, b) =>
      sortDir === "asc" ? compare(a, b) : -compare(a, b),
    );
  }, [schools, query, sortField, sortDir, routeCounts, activeLevels]);

  return (
    <div className="flex flex-1 flex-col items-center gap-4 overflow-hidden px-6 pb-2 text-center">
      {/* Everything that can genuinely grow past the viewport (the
          school table especially) lives in this inner, scrollable
          region - the "Routes" link and copyright below stay outside
          it, pinned to the bottom of the screen instead of scrolling
          away with a long/filtered list. */}
      <div className="flex min-h-0 w-full flex-1 flex-col items-center gap-4">
        <div className="flex w-full max-w-md items-center justify-between">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to routes"
            className="btn-glossy-light flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-300 text-zinc-900"
          >
            <BackArrowIcon className="h-5 w-5" />
          </button>
          <div>
            {/* Hardcoded for now - every real school here is a Rutherford
                County one. Its own small line above "Schools" rather than
                folded into the heading itself so a future multi-district
                version has an obvious place to swap in whichever
                district is actually selected, without restyling the
                heading around it. */}
            <span className="block text-xs font-semibold tracking-wide text-zinc-400 uppercase">
              Rutherford County
            </span>
            {/* -mt-1/leading-none - a bigger title (now sized to match
                the route name title, see RouteListScreen's own heading)
                also has a taller default line box, which otherwise
                drifts it further from the small county label above
                than the two actually need to sit. */}
            {/* relative/absolute rather than a flex row - the icon
                floats off the text's own left edge (right-full) so it
                never shifts the text itself off-center from the county
                label above, the way sharing a centered flex row with it
                used to. */}
            <h1 className="font-heading relative -mt-1 text-4xl leading-none font-black tracking-tight">
              <SchoolIcon className="absolute top-1/2 right-full mr-1 h-6 w-6 -translate-y-1/2 text-zinc-400" />
              Schools
            </h1>
          </div>
          <span className="h-10 w-10 shrink-0" aria-hidden="true" />
        </div>

        <div className="flex w-full max-w-md shrink-0 items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search schools"
              aria-label="Search schools"
              className="w-full rounded-xl border border-zinc-300 bg-white py-2.5 pr-9 pl-9 text-base focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute top-1/2 right-2 -translate-y-1/2 p-1 text-zinc-400 active:text-zinc-600"
              >
                <CloseIcon className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {/* Same empty-set-shows-everything toggle convention as
              RouteListScreen's own trip-type/school-level group, just
              icons instead of ES/MS/HS text - the search bar shrinks
              (min-w-0 flex-1 above) to make room beside it. */}
          <div className="flex shrink-0 items-center gap-1.5">
            {SCHOOL_LEVELS.map((level) => {
              const active = activeLevels.has(level);
              return (
                <button
                  key={level}
                  type="button"
                  onClick={() => toggleLevel(level)}
                  aria-pressed={active}
                  aria-label={`Filter to ${level} schools`}
                  className={active ? "text-blue-600" : "text-zinc-300"}
                >
                  <SchoolLevelIcon level={level} className="h-6 w-6" />
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex min-h-0 w-full max-w-md flex-1 flex-col overflow-hidden rounded-2xl border border-zinc-300 text-left">
          <div className="grid grid-cols-[1fr_7rem_3.5rem] items-stretch gap-x-1 divide-x divide-zinc-200 border-b border-zinc-300 bg-zinc-100 px-2 py-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
            <SortableHeader
              label="School"
              field="name"
              padded={false}
              sortField={sortField}
              sortDir={sortDir}
              onSort={toggleSort}
            />
            <SortableHeader
              label="City"
              field="city"
              align="center"
              padded={false}
              sortField={sortField}
              sortDir={sortDir}
              onSort={toggleSort}
            />
            <SortableHeader
              label="Routes"
              field="routes"
              align="center"
              padded={false}
              sortField={sortField}
              sortDir={sortDir}
              onSort={toggleSort}
            />
          </div>
          <div className="min-h-0 flex-1 divide-y divide-zinc-200 overflow-y-auto">
            {filtered.map(([name, info]) => (
              <button
                key={name}
                type="button"
                onClick={() => onSelectSchool(name)}
                className="grid w-full grid-cols-[1fr_7rem_3.5rem] items-center gap-x-1 gap-y-0.5 px-2 py-3 text-left active:bg-zinc-100"
              >
                {/* Spans into the City column's own width (not the
                    row's full width - Routes keeps its narrow column to
                    the right) so a normal-length school name reads on
                    one line instead of wrapping the way it did when
                    squeezed into just the School column. */}
                <span className="col-span-2 flex min-w-0 items-center gap-1 text-base font-semibold text-zinc-900">
                  <SchoolLevelIcon
                    level={info.schoolLevel}
                    className="h-4 w-4 shrink-0 text-zinc-400"
                  />
                  {name}
                </span>
                <span className="row-span-2 self-center pl-2 text-center text-sm font-semibold text-zinc-700">
                  {routeCounts[name] ?? 0}
                </span>
                <span className="flex min-w-0 items-center gap-1 text-xs text-zinc-500">
                  <MapPinIcon className="h-3 w-3 shrink-0 text-blue-500" />
                  <span className="truncate">
                    {streetFromAddress(info.address)}
                  </span>
                </span>
                {/* The real per-row value for the City column above,
                    not a placeholder - genuinely sortable now. */}
                <span className="truncate pl-2 text-center text-xs text-zinc-500">
                  {cityFromAddress(info.address)}
                </span>
              </button>
            ))}

            {filtered.length === 0 && (
              <p className="px-2 py-6 text-center text-sm text-zinc-500">
                {query ? (
                  <>No schools match &ldquo;{query}&rdquo;.</>
                ) : (
                  "No schools found."
                )}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Same "Schools" link RouteListScreen puts under its own table
          (icon + blue text, left-aligned) - here it just goes back to
          the route list, same as the back arrow above, rather than
          opening anything new. */}
      <div className="flex w-full max-w-md shrink-0 items-center">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm font-semibold text-blue-600 active:text-blue-800"
        >
          <RouteIcon className="h-4 w-4" />
          Routes
        </button>
      </div>

      <a
        href="mailto:nathan@pizar.net"
        className="flex shrink-0 items-center gap-1 text-xs text-zinc-400 active:text-zinc-600"
      >
        © 2026 Nathan D. B. Pizar
        <MailIcon className="h-3 w-3" />
      </a>
    </div>
  );
}
