"use client";

import { useMemo, useState } from "react";
import { Logo } from "./Logo";
import { HeartIcon, SearchIcon, SortIcon, SunIcon, SunriseIcon, TriangleIcon } from "./icons";
import { parseTimeToMinutes } from "@/lib/time";
import type { Route } from "@/lib/types";

type SortField = "routeNumber" | "tripType" | "schoolName" | "departureTime";
type SortDir = "asc" | "desc";

// One comparator per sortable header - routeNumber compares numerically
// (route numbers sort as text otherwise: "120" would land after "20"),
// tripType ranks "pickup" (AM) before "dropoff" (PM) rather than
// relying on string comparison to happen to agree, departureTime goes
// through parseTimeToMinutes rather than comparing the displayed
// "3:30 PM" strings directly, since those don't sort into chronological
// order as text either.
const SORT_COMPARATORS: Record<SortField, (a: Route, b: Route) => number> = {
  routeNumber: (a, b) => Number(a.routeNumber) - Number(b.routeNumber),
  tripType: (a, b) => (a.tripType === b.tripType ? 0 : a.tripType === "pickup" ? -1 : 1),
  schoolName: (a, b) => a.schoolName.localeCompare(b.schoolName),
  departureTime: (a, b) => parseTimeToMinutes(a.departureTime) - parseTimeToMinutes(b.departureTime),
};

/** What the View dropdown filters to - "all"/"favorites" aren't
 * TripType/SchoolLevel values, so this is its own union rather than
 * reusing either type the way the old AM/PM toggle pair did. */
type ViewFilter = "all" | "pickup" | "dropoff" | "elementary" | "middle" | "high" | "favorites";

// Order here is the dropdown's own order - AM/PM, then school level,
// with Favorites deliberately last rather than grouped with the
// trip-type/level filters it otherwise reads like a peer of.
const VIEW_OPTIONS: { value: ViewFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "pickup", label: "Morning Pickup" },
  { value: "dropoff", label: "Afternoon Drop Off" },
  { value: "elementary", label: "Elementary" },
  { value: "middle", label: "Middle School" },
  { value: "high", label: "High School" },
  { value: "favorites", label: "Favorites" },
];

/**
 * The app's home screen: a scrollable table of routes (# / Name /
 * Start / favorite heart), filterable by a search box and a View
 * dropdown above it (All / Morning Pickup / Afternoon Drop Off /
 * Favorites). Tapping a row goes to that route's trip-summary screen
 * (StartScreen). Only one real route exists (see ROUTE_META in
 * page.tsx) - the rest are fabricated by buildDemoRoutes purely so this
 * screen has enough rows to actually exercise scrolling and search,
 * clearly flagged as fake in the generator itself rather than
 * pretending to be real district data.
 */
export function RouteListScreen({
  routes,
  onSelect,
}: {
  routes: Route[];
  onSelect: (route: Route) => void;
}) {
  const [query, setQuery] = useState("");
  const [view, setView] = useState<ViewFilter>("all");
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  // departureTime/asc as the default matches the order routes already
  // arrive in (page.tsx sorts real+demo routes by departure time before
  // handing them to this screen), so picking this as the initial sort
  // doesn't change anything a user would notice until they tap a header.
  const [sortField, setSortField] = useState<SortField>("departureTime");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const toggleSort = (field: SortField) => {
    if (field === sortField) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matching = routes.filter((route) => {
      const matchesQuery =
        !q || route.name.toLowerCase().includes(q) || route.routeNumber.includes(q);
      const matchesView =
        view === "all"
          ? true
          : view === "favorites"
            ? route.isFavorite
            : view === "pickup" || view === "dropoff"
              ? route.tripType === view
              : route.schoolLevel === view;
      return matchesQuery && matchesView;
    });

    const compare = SORT_COMPARATORS[sortField];
    return [...matching].sort((a, b) => {
      // Real routes (status !== "demo") always read first here, purely
      // for demo legibility - every fabricated filler route (see
      // demoRoutes.ts) sorts after them, regardless of the chosen
      // column sort, which only decides order *within* each group.
      if (view === "favorites") {
        const aReal = a.status !== "demo";
        const bReal = b.status !== "demo";
        if (aReal !== bReal) return aReal ? -1 : 1;
      }
      const result = compare(a, b);
      return sortDir === "asc" ? result : -result;
    });
  }, [routes, query, view, sortField, sortDir]);

  return (
    <div className="flex flex-1 flex-col items-center gap-4 overflow-y-auto px-6 pt-10 pb-6 text-center landscape:pt-6">
      <Logo size="large" />
      <h1 className="font-heading text-2xl font-black tracking-tight">Routes</h1>

      <div className="flex w-full max-w-md shrink-0 items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search routes"
            aria-label="Search routes"
            className="w-full rounded-xl border border-zinc-300 bg-white py-2.5 pr-3 pl-9 text-base focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
          />
        </div>
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setViewMenuOpen((open) => !open)}
            aria-haspopup="listbox"
            aria-expanded={viewMenuOpen}
            className="flex shrink-0 items-center gap-1.5 rounded-xl border border-zinc-300 bg-white px-3.5 py-2.5 text-base text-zinc-700 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
          >
            View
            {/* TriangleIcon rather than a dedicated chevron - the
                existing ChevronDownIcon is a fixed yellow/black warning
                caret (unused elsewhere, kept as leftover from an
                earlier design), not a neutral currentColor-based one
                that'd fit here. */}
            <TriangleIcon direction="right" className="h-3 w-3 rotate-90" />
          </button>

          {viewMenuOpen && (
            <>
              {/* Full-screen, invisible - just here to close the menu on
                  an otherwise-unhandled tap anywhere else on the screen. */}
              <div className="fixed inset-0 z-10" onClick={() => setViewMenuOpen(false)} />
              <div
                role="listbox"
                className="absolute top-full right-0 z-20 mt-1 w-44 overflow-hidden rounded-xl border border-zinc-300 bg-white py-1 shadow-lg"
              >
                {VIEW_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    aria-selected={view === option.value}
                    onClick={() => {
                      setView(option.value);
                      setViewMenuOpen(false);
                    }}
                    className={`block w-full px-4 py-2.5 text-left text-sm font-semibold ${
                      view === option.value
                        ? "bg-blue-50 text-blue-600"
                        : "text-zinc-700 active:bg-zinc-100"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="flex w-full max-w-md flex-1 flex-col overflow-hidden rounded-2xl border border-zinc-300 text-left">
        <div className="grid grid-cols-[3rem_3.25rem_1fr_4.25rem_1.25rem] items-stretch gap-x-3 divide-x divide-zinc-200 border-b border-zinc-300 bg-zinc-100 px-4 py-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
          <SortableHeader
            label="#"
            field="routeNumber"
            align="center"
            sortField={sortField}
            sortDir={sortDir}
            onSort={toggleSort}
          />
          <SortableHeader
            label="AM/PM"
            field="tripType"
            align="center"
            sortField={sortField}
            sortDir={sortDir}
            onSort={toggleSort}
          />
          <SortableHeader
            label="School"
            field="schoolName"
            sortField={sortField}
            sortDir={sortDir}
            onSort={toggleSort}
          />
          <SortableHeader
            label="Start"
            field="departureTime"
            align="right"
            sortField={sortField}
            sortDir={sortDir}
            onSort={toggleSort}
          />
          <span />
        </div>
        <div className="divide-y divide-zinc-200 overflow-y-auto">
          {filtered.map((route) => (
            <button
              key={route.id}
              type="button"
              onClick={() => onSelect(route)}
              className="grid w-full grid-cols-[3rem_3.25rem_1fr_4.25rem_1.25rem] items-center gap-x-3 px-4 py-3 text-left active:bg-zinc-100"
            >
              <span className="text-center font-heading text-lg leading-none font-black">
                #{route.routeNumber}
              </span>
              <div className="flex items-center justify-center gap-0.5 text-blue-500">
                <span className="font-heading text-lg leading-none font-black">
                  {route.tripType === "pickup" ? "AM" : "PM"}
                </span>
                {route.tripType === "pickup" ? (
                  <SunriseIcon className="h-3.5 w-3.5" />
                ) : (
                  <SunIcon className="h-3.5 w-3.5" />
                )}
              </div>
              <span className="line-clamp-2 leading-snug text-zinc-700">{route.schoolName}</span>
              <span className="text-right text-sm font-semibold text-zinc-500">
                {route.departureTime}
              </span>
              <HeartIcon
                filled={route.isFavorite}
                className={`h-4 w-4 justify-self-end ${
                  route.isFavorite ? "text-blue-600" : "text-zinc-300"
                }`}
              />
            </button>
          ))}

          {filtered.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-zinc-500">
              {query ? <>No routes match &ldquo;{query}&rdquo;.</> : "No routes match the selected filters."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/** One clickable, sortable column header - label plus the traditional
 * stacked up/down carets (SortIcon), which always render but only show
 * the active direction solid once this is the column being sorted by.
 * `align="right"` (the Start column, matching its right-aligned data
 * below) and `align="center"` (the #/AM-PM columns, matching their
 * centered data below) both keep label-then-icon order, just moving
 * where that pair sits within the column rather than mirroring the
 * icon in front of the label. */
function SortableHeader({
  label,
  field,
  align = "left",
  sortField,
  sortDir,
  onSort,
}: {
  label: string;
  field: SortField;
  align?: "left" | "center" | "right";
  sortField: SortField;
  sortDir: SortDir;
  onSort: (field: SortField) => void;
}) {
  const active = sortField === field;
  const justify = align === "right" ? "justify-end" : align === "center" ? "justify-center" : "";
  return (
    <button
      type="button"
      onClick={() => onSort(field)}
      className={`flex items-center gap-1 bg-transparent pl-3 first:pl-0 ${justify} ${
        active ? "text-zinc-700" : ""
      }`}
    >
      <span>{label}</span>
      <SortIcon direction={active ? sortDir : "none"} className="h-2.5 w-2.5 shrink-0" />
    </button>
  );
}
