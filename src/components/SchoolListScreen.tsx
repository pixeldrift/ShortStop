"use client";

import { useMemo, useState } from "react";
import { Logo } from "./Logo";
import { BackArrowIcon, CloseIcon, MapPinIcon, SchoolIcon, SearchIcon } from "./icons";
import type { SchoolInfo } from "@/lib/parseSchoolsCsv";
import type { Route } from "@/lib/types";

/** The city out of a school's own "<street>, <city>, TN <zip>" address
 * (schools.csv/Postgres' `School` table - every real school's address
 * follows this exact three-part shape today) - its own table column,
 * rather than making a reader parse it back out of the full address
 * line under the school's name. */
function cityFromAddress(address: string): string {
  return address.split(",")[1]?.trim() ?? "";
}

/**
 * Companion screen to RouteListScreen, reached via its "Schools" link -
 * every real district school (schools.csv/Postgres' `School` table, via
 * the same `schools` lookup page.tsx already loads for EditRouteScreen's
 * own school picker), searchable by name or city, sorted alphabetically
 * by name. Tapping a row hands its name up to `onSelectSchool`, which
 * page.tsx uses to open a school-scoped RouteListScreen (see its own
 * `school-routes` screen kind) - this screen itself only ever shows
 * school details, never route data beyond each one's own route count.
 *
 * Every real school here is a Rutherford County one today (see the
 * small district label above the heading) - schoolLevel isn't shown
 * anymore (an admin picking a school by name/city doesn't need it
 * repeated here too, and it's still enforced everywhere it actually
 * matters - EditRouteScreen's own school picker, routing logic), but
 * stays on `SchoolInfo` itself for that.
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

  const routeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const route of routes) {
      counts[route.schoolName] = (counts[route.schoolName] ?? 0) + 1;
    }
    return counts;
  }, [routes]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return Object.entries(schools)
      .filter(
        ([name, info]) =>
          !q || name.toLowerCase().includes(q) || cityFromAddress(info.address).toLowerCase().includes(q),
      )
      .sort(([a], [b]) => a.localeCompare(b));
  }, [schools, query]);

  return (
    <div className="flex flex-1 flex-col items-center gap-4 overflow-y-auto px-6 pt-10 pb-6 text-center landscape:pt-6">
      <Logo size="large" />

      <div className="flex w-full max-w-md items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to routes"
          className="btn-glossy flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-zinc-500 bg-zinc-300 text-zinc-900"
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
          <h1 className="font-heading flex items-center justify-center gap-2 text-2xl font-black tracking-tight">
            <SchoolIcon className="h-5 w-5 shrink-0 text-blue-600" />
            Schools
          </h1>
        </div>
        <span className="h-10 w-10 shrink-0" aria-hidden="true" />
      </div>

      <div className="relative w-full max-w-md shrink-0">
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

      <div className="flex w-full max-w-md flex-1 flex-col overflow-hidden rounded-2xl border border-zinc-300 text-left">
        <div className="grid grid-cols-[1fr_7rem_3.5rem] items-center gap-x-2 divide-x divide-zinc-200 border-b border-zinc-300 bg-zinc-100 px-3 py-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
          <span>School</span>
          <span className="pl-2 text-center">City</span>
          <span className="pl-2 text-center">Routes</span>
        </div>
        <div className="divide-y divide-zinc-200 overflow-y-auto">
          {filtered.map(([name, info]) => (
            <button
              key={name}
              type="button"
              onClick={() => onSelectSchool(name)}
              className="grid w-full grid-cols-[1fr_7rem_3.5rem] items-center gap-x-2 px-3 py-3 text-left active:bg-zinc-100"
            >
              <div className="min-w-0">
                <span className="block truncate text-sm font-semibold text-zinc-900">{name}</span>
                <span className="mt-0.5 flex items-center gap-1 text-xs text-zinc-500">
                  <MapPinIcon className="h-3 w-3 shrink-0" />
                  <span className="truncate">{info.address}</span>
                </span>
              </div>
              <span className="truncate pl-2 text-center text-sm text-zinc-600">
                {cityFromAddress(info.address)}
              </span>
              <span className="pl-2 text-center text-sm font-semibold text-zinc-700">
                {routeCounts[name] ?? 0}
              </span>
            </button>
          ))}

          {filtered.length === 0 && (
            <p className="px-2 py-6 text-center text-sm text-zinc-500">
              {query ? <>No schools match &ldquo;{query}&rdquo;.</> : "No schools found."}
            </p>
          )}
        </div>
      </div>

      <a
        href="mailto:nathan@pizar.net"
        className="shrink-0 text-xs text-zinc-400 active:text-zinc-600"
      >
        © 2026 Nathan D. B. Pizar
      </a>
    </div>
  );
}
