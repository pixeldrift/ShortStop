"use client";

import { useMemo, useState } from "react";
import { Logo } from "./Logo";
import { HeartIcon, SearchIcon, SunIcon, SunriseIcon, TriangleIcon } from "./icons";
import type { Route } from "@/lib/types";

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

    if (view !== "favorites") return matching;

    // Real routes (status !== "demo") always read first here, purely
    // for demo legibility - every fabricated filler route (see
    // demoRoutes.ts) sorts after them. A stable sort
    // (Array.prototype.sort is stable in every modern engine) means
    // everything else keeps its existing (departure-time) order.
    return [...matching].sort((a, b) => {
      const aReal = a.status !== "demo";
      const bReal = b.status !== "demo";
      return aReal === bReal ? 0 : aReal ? -1 : 1;
    });
  }, [routes, query, view]);

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
        <div className="grid grid-cols-[3rem_1fr_4.25rem_1.25rem] gap-x-3 border-b border-zinc-300 bg-zinc-100 px-4 py-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
          <span>#</span>
          <span>School</span>
          <span className="text-right">Start</span>
          <span />
        </div>
        <div className="divide-y divide-zinc-200 overflow-y-auto">
          {filtered.map((route) => (
            <button
              key={route.id}
              type="button"
              onClick={() => onSelect(route)}
              className="grid w-full grid-cols-[3rem_1fr_4.25rem_1.25rem] items-center gap-x-3 px-4 py-3 text-left active:bg-zinc-100"
            >
              <div className="flex flex-col items-center gap-0">
                <span className="font-heading text-lg leading-none font-black">
                  #{route.routeNumber}
                </span>
                <div className="flex items-center gap-0.5 text-blue-500">
                  <span className="font-heading text-lg leading-none font-black">
                    {route.tripType === "pickup" ? "AM" : "PM"}
                  </span>
                  {route.tripType === "pickup" ? (
                    <SunriseIcon className="h-3.5 w-3.5" />
                  ) : (
                    <SunIcon className="h-3.5 w-3.5" />
                  )}
                </div>
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
