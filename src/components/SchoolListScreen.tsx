"use client";

import { useMemo, useState } from "react";
import { Logo } from "./Logo";
import { BackArrowIcon, CloseIcon, MapPinIcon, SearchIcon } from "./icons";
import type { SchoolInfo } from "@/lib/parseSchoolsCsv";
import type { SchoolLevel } from "@/lib/types";

const LEVEL_LABEL: Record<SchoolLevel, string> = {
  elementary: "Elementary",
  middle: "Middle",
  high: "High",
};

/**
 * Companion screen to RouteListScreen, reached via its "View all
 * Schools" button - every real district school (schools.csv/Postgres'
 * `School` table, via the same `schools` lookup page.tsx already loads
 * for EditRouteScreen's own school picker), searchable by name, sorted
 * alphabetically. Tapping a row hands its name up to `onSelectSchool`,
 * which page.tsx uses to open a school-scoped RouteListScreen (see its
 * own `school-routes` screen kind) - this screen itself only ever
 * shows school details, never route data.
 */
export function SchoolListScreen({
  schools,
  onSelectSchool,
  onBack,
}: {
  schools: Record<string, SchoolInfo>;
  onSelectSchool: (schoolName: string) => void;
  onBack: () => void;
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return Object.entries(schools)
      .filter(([name]) => !q || name.toLowerCase().includes(q))
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
        <h1 className="font-heading text-2xl font-black tracking-tight">Schools</h1>
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
        <div className="divide-y divide-zinc-200 overflow-y-auto">
          {filtered.map(([name, info]) => (
            <button
              key={name}
              type="button"
              onClick={() => onSelectSchool(name)}
              className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left active:bg-zinc-100"
            >
              <div className="min-w-0">
                <span className="block truncate text-sm font-semibold text-zinc-900">{name}</span>
                <span className="mt-0.5 flex items-center gap-1 text-xs text-zinc-500">
                  <MapPinIcon className="h-3 w-3 shrink-0" />
                  <span className="truncate">{info.address}</span>
                </span>
              </div>
              <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
                {LEVEL_LABEL[info.schoolLevel]}
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
