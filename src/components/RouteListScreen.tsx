"use client";

import { Logo } from "./Logo";
import type { Route } from "@/lib/types";

/**
 * The app's home screen: a scrollable table of routes (Number / Name /
 * Start Time). Tapping a row goes to that route's trip-summary screen
 * (StartScreen). Only one real route exists right now (see ROUTE_META in
 * page.tsx) - the table is still built to genuinely scroll for however
 * many rows are passed in, rather than fabricating placeholder routes
 * just to make the list look longer.
 */
export function RouteListScreen({
  routes,
  onSelect,
}: {
  routes: Route[];
  onSelect: (route: Route) => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center gap-6 overflow-y-auto px-6 pt-10 pb-6 text-center landscape:pt-6">
      <Logo size="large" />
      <h1 className="font-heading text-2xl font-black tracking-tight">Routes</h1>

      <div className="flex w-full max-w-md flex-1 flex-col overflow-hidden rounded-2xl border border-zinc-300 text-left">
        <div className="grid grid-cols-[3.5rem_1fr_5.5rem] gap-x-3 border-b border-zinc-300 bg-zinc-100 px-4 py-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
          <span>Number</span>
          <span>Name</span>
          <span>Start Time</span>
        </div>
        <div className="divide-y divide-zinc-200 overflow-y-auto">
          {routes.map((route) => (
            <button
              key={route.routeNumber}
              type="button"
              onClick={() => onSelect(route)}
              className="grid w-full grid-cols-[3.5rem_1fr_5.5rem] items-center gap-x-3 px-4 py-3 text-left active:bg-zinc-100"
            >
              <span className="font-heading text-lg font-black">{route.routeNumber}</span>
              <span className="truncate text-zinc-700">{route.name}</span>
              <span className="text-sm font-semibold text-zinc-500">{route.departureTime}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
