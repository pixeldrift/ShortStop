"use client";

import { useMemo, useState } from "react";
import { Logo } from "./Logo";
import { SearchIcon } from "./icons";
import type { Route } from "@/lib/types";

/**
 * The app's home screen: a scrollable table of routes (# / Name /
 * Start), filterable by a search box above it. Tapping a row goes to
 * that route's trip-summary screen (StartScreen). Only one real route
 * exists (see ROUTE_META in page.tsx) - the rest are fabricated by
 * buildDemoRoutes purely so this screen has enough rows to actually
 * exercise scrolling and search, clearly flagged as fake in the
 * generator itself rather than pretending to be real district data.
 */
export function RouteListScreen({
  routes,
  onSelect,
}: {
  routes: Route[];
  onSelect: (route: Route) => void;
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return routes;
    return routes.filter(
      (route) => route.name.toLowerCase().includes(q) || route.routeNumber.includes(q),
    );
  }, [routes, query]);

  return (
    <div className="flex flex-1 flex-col items-center gap-4 overflow-y-auto px-6 pt-10 pb-6 text-center landscape:pt-6">
      <Logo size="large" />
      <h1 className="font-heading text-2xl font-black tracking-tight">Routes</h1>

      <div className="relative w-full max-w-md shrink-0">
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

      <div className="flex w-full max-w-md flex-1 flex-col overflow-hidden rounded-2xl border border-zinc-300 text-left">
        <div className="grid grid-cols-[2.25rem_1fr_4.25rem] gap-x-3 border-b border-zinc-300 bg-zinc-100 px-4 py-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
          <span>#</span>
          <span>Name</span>
          <span className="text-right">Start</span>
        </div>
        <div className="divide-y divide-zinc-200 overflow-y-auto">
          {filtered.map((route) => (
            <button
              key={route.routeNumber}
              type="button"
              onClick={() => onSelect(route)}
              className="grid w-full grid-cols-[2.25rem_1fr_4.25rem] items-center gap-x-3 px-4 py-3 text-left active:bg-zinc-100"
            >
              <span className="font-heading text-lg font-black">{route.routeNumber}</span>
              <span className="line-clamp-2 leading-snug text-zinc-700">{route.name}</span>
              <span className="text-right text-sm font-semibold text-zinc-500">
                {route.departureTime}
              </span>
            </button>
          ))}

          {filtered.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-zinc-500">
              No routes match &ldquo;{query}&rdquo;.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
