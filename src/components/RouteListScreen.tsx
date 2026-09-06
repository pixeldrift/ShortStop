"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ConfirmModal } from "./ConfirmModal";
import { Logo } from "./Logo";
import {
  BackArrowIcon,
  CloseIcon,
  DownloadIcon,
  EditIcon,
  EyeIcon,
  EyeOffIcon,
  HeartIcon,
  PlusIcon,
  SchoolIcon,
  SearchIcon,
  SortIcon,
  SunIcon,
  SunriseIcon,
  TrashIcon,
  TriangleIcon,
} from "./icons";
import { downloadCsv, routeListToCsv } from "@/lib/exportCsv";
import { fetchCommittedWaypointCache, isRouteFullyResolved } from "@/lib/routeReadiness";
import { parseTimeToMinutes } from "@/lib/time";
import type { Route, RouteStatus } from "@/lib/types";
import type { WaypointCache } from "@/lib/waypointCache";

/** A pending confirm-modal request - which action, on which route.
 * Rendered as a single shared ConfirmModal below rather than one
 * inline per row, so at most one is ever open at a time. */
type ConfirmRequest =
  | { type: "publish"; route: Route }
  | { type: "unpublish"; route: Route }
  | { type: "delete"; route: Route };

type SortField = "routeNumber" | "tripType" | "schoolName" | "departureTime";
type SortDir = "asc" | "desc";

// One comparator per sortable header - routeNumber compares numerically
// (route numbers sort as text otherwise: "120" would land after "20"),
// tripType ranks "pickup" (AM) before "dropoff" (PM) rather than
// relying on string comparison to happen to agree, departureTime goes
// through parseTimeToMinutes rather than comparing the displayed
// "3:30 PM" strings directly, since those don't sort into chronological
// order as text either. routeNumber breaks a tie with tripType (a bus
// runs both an AM and a PM route under the same number) rather than
// leaving same-number rows in whatever order they happened to arrive
// in - the only pair here that ties often enough for that to matter.
const SORT_COMPARATORS: Record<SortField, (a: Route, b: Route) => number> = {
  routeNumber: (a, b) =>
    Number(a.routeNumber) - Number(b.routeNumber) || SORT_COMPARATORS.tripType(a, b),
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

/** Whether a route currently reads as published - a real route's own
 * `status` says so directly; a demo route's `status` is always literally
 * "demo" (never actually changed, see page.tsx's own demoHiddenIds doc
 * comment), so its published/unpublished state lives in that separate
 * overlay instead. Shared by the search/filter pass and the row
 * rendering below so both agree on what "published" means for either
 * kind of route. */
function isRoutePublished(route: Route, demoHiddenIds: ReadonlySet<string>): boolean {
  if (route.status === "demo") return !demoHiddenIds.has(route.id);
  return route.status === "published";
}

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
  title,
  onBack,
  onViewSchools,
  adminMode,
  adminWaypointCaches,
  onToggleAdminMode,
  onSelect,
  onEditRoute,
  onAddRoute,
  onSetRouteStatus,
  onDeleteRoute,
  onToggleFavorite,
  demoHiddenIds,
}: {
  routes: Route[];
  /** Heading text - "Routes" (or "Edit Routes" in admin mode) when
   * omitted, the normal top-level route list. page.tsx reuses this same
   * component school-scoped (its own `school-routes` screen kind,
   * reached from SchoolListScreen), passing a school's own name here so
   * the heading reads as "which school's routes is this" instead. */
  title?: string;
  /** Shows a back-arrow button next to the heading when given, same
   * placement/style as StartScreen's own - only the school-scoped reuse
   * passes this (back to SchoolListScreen); the top-level route list
   * has nowhere "back" to go, so it omits both this and `title`. */
  onBack?: () => void;
  /** Renders the "View all Schools" corner button (bottom-left) when
   * given - only the top-level route list passes this; the
   * school-scoped reuse above already knows which school it's showing
   * routes for, so re-offering a jump to the schools list from inside
   * one school's own routes would be redundant. */
  onViewSchools?: () => void;
  /** Reveals draft real routes below, dimmed, and turns on the
   * per-row publish/unpublish/delete controls - toggled by the
   * "Edit Mode" link at the bottom (onToggleAdminMode), or turned on
   * unconditionally by a route's own "Edit Route" link on StartScreen
   * (see page.tsx). */
  adminMode: boolean;
  /** This session's own fetched-coordinates overlay per route id (see
   * page.tsx) - merged on top of each route's real committed sidecar
   * cache before deciding whether "Publish" is actually allowed
   * (handlePublishClick below), so a route made ready via
   * EditRouteScreen's "Fetch Location"/"Fetch All Locations" this
   * session is recognized as ready here too. */
  adminWaypointCaches: Record<string, WaypointCache>;
  onToggleAdminMode: () => void;
  /** Normal navigation - the trip-summary/step flow. Every row's own
   * main tap target, whether or not admin mode is on - editing has its
   * own separate pencil button now (see the row rendering below), so
   * this never redirects to it itself. */
  onSelect: (route: Route) => void;
  /** Opens EditRouteScreen directly for this route - fired by the
   * row's own pencil button in admin mode (every route, demo included),
   * or by a "Publish" attempt that turns out not to be ready yet (see
   * handlePublishClick). */
  onEditRoute: (route: Route) => void;
  onAddRoute: () => void;
  onSetRouteStatus: (route: Route, status: RouteStatus) => void;
  onDeleteRoute: (route: Route) => void;
  /** Toggles a route's own favorite heart - independent of the row's
   * main click (onSelect), which only ever navigates; see the row
   * rendering below for how the heart gets its own tap target (a
   * pencil takes its place there instead, in admin mode). */
  onToggleFavorite: (route: Route) => void;
  /** Which fabricated demo routes are "unpublished" this session (see
   * page.tsx) - a demo route's own `status` always stays literally
   * "demo" (every real/fake distinction elsewhere depends on that), so
   * this is the only place that knows one's been toggled off; combined
   * with `route.status` via isRoutePublished below wherever a row needs
   * to know whether it currently reads as published. */
  demoHiddenIds: ReadonlySet<string>;
}) {
  const [query, setQuery] = useState("");
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);
  // Only set while handlePublishClick's own readiness check is in
  // flight - not surfaced as a spinner anywhere yet, just prevents a
  // second tap on the same row from firing a second check.
  const [checkingRouteId, setCheckingRouteId] = useState<string | null>(null);
  const [view, setView] = useState<ViewFilter>("all");
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  // routeNumber/asc (tripType as its own tie-break, see
  // SORT_COMPARATORS) is the default a driver actually wants: routes
  // grouped by bus, AM before PM within a bus, rather than the arrival
  // order page.tsx happens to hand this screen (real+demo routes
  // sorted by departure time).
  const [sortField, setSortField] = useState<SortField>("routeNumber");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  // Lets a tap outside the red admin-mode box exit it (see the effect
  // below) without also swallowing a tap on the "Exit Edit Mode"/"New
  // Route" controls themselves, which sit below the box and already
  // handle their own clicks correctly - those live in `controlsRef`,
  // specifically excluded so this effect never double-fires alongside
  // them (Exit Edit Mode) or fights their own action (New Route, which
  // needs adminMode to stay on across the navigation it triggers).
  const boxRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!adminMode) return;
    function handleOutsideClick(e: MouseEvent) {
      // A confirm modal (delete/publish/unpublish) is its own in-progress
      // action - exiting admin mode underneath it at the same time would
      // be a jarring side effect of whatever the modal itself is doing.
      if (confirmRequest) return;
      const target = e.target as Node;
      if (boxRef.current?.contains(target)) return;
      if (controlsRef.current?.contains(target)) return;
      onToggleAdminMode();
    }
    // Capture phase - fires even if a row button or dropdown item
    // stops propagation on the way up, same as any standard
    // "click outside to close" pattern needs to.
    document.addEventListener("click", handleOutsideClick, true);
    return () => document.removeEventListener("click", handleOutsideClick, true);
  }, [adminMode, confirmRequest, onToggleAdminMode]);

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
      // A route that doesn't currently read as published only ever
      // shows up in admin mode - a normal driver never needs to see a
      // route nobody's actually running, whether it's a real draft or
      // a demo row toggled unpublished this session.
      if (!isRoutePublished(route, demoHiddenIds) && !adminMode) return false;

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
  }, [routes, query, view, sortField, sortDir, adminMode, demoHiddenIds]);

  // "Publish" never just flips the status - the same "every geocodable
  // stop has to actually resolve first" rule EditRouteScreen.tsx
  // enforces applies here too, checked against the route's own
  // committed sidecar cache merged with this session's own
  // fetched-but-not-yet-committed overlay (adminWaypointCaches). A
  // route that isn't ready skips the confirm modal entirely and goes
  // straight to the edit screen instead, where the real warning UI
  // (and the Fetch/Fetch All buttons that actually fix this) already
  // lives - no separate warning needed here. A demo route has no real
  // committed sidecar file of its own to check (it's fabricated, and
  // never opens the edit screen at all - see handleRowClick above), so
  // it skips the readiness check entirely and always goes straight to
  // the confirm modal.
  async function handlePublishClick(route: Route) {
    if (route.status === "demo") {
      setConfirmRequest({ type: "publish", route });
      return;
    }
    setCheckingRouteId(route.id);
    try {
      const committed = await fetchCommittedWaypointCache();
      const merged = { ...committed, ...(adminWaypointCaches[route.id] ?? {}) };
      if (isRouteFullyResolved(route, merged)) {
        setConfirmRequest({ type: "publish", route });
      } else {
        onEditRoute(route);
      }
    } finally {
      setCheckingRouteId(null);
    }
  }

  function handleDownloadCsv() {
    downloadCsv("routes.csv", routeListToCsv(routes));
  }

  return (
    <div className="flex flex-1 flex-col items-center gap-4 overflow-y-auto px-6 pt-10 pb-6 text-center landscape:pt-6">
      <Logo size="large" />
      {onBack ? (
        <div className="flex w-full max-w-md items-center justify-between">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to schools"
            className="btn-glossy flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-zinc-500 bg-zinc-300 text-zinc-900"
          >
            <BackArrowIcon className="h-5 w-5" />
          </button>
          <h1 className="font-heading flex items-center gap-2 text-2xl font-black tracking-tight">
            {adminMode && <EditIcon className="h-5 w-5 shrink-0 text-red-600" />}
            {title}
          </h1>
          <span className="h-10 w-10 shrink-0" aria-hidden="true" />
        </div>
      ) : (
        <h1 className="font-heading flex items-center gap-2 text-2xl font-black tracking-tight">
          {adminMode && <EditIcon className="h-5 w-5 shrink-0 text-red-600" />}
          {title ?? (adminMode ? "Edit Routes" : "Routes")}
        </h1>
      )}

      <div className="flex w-full max-w-md shrink-0 items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search routes"
            aria-label="Search routes"
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

      <div
        ref={boxRef}
        className={`flex w-full max-w-md flex-1 flex-col overflow-hidden rounded-2xl border text-left ${
          adminMode ? "border-2 border-dashed border-blue-400" : "border-zinc-300"
        }`}
      >
        <div className="grid grid-cols-[5.75rem_1fr_4.25rem_1.25rem] items-stretch gap-x-1 divide-x divide-zinc-200 border-b border-zinc-300 bg-zinc-100 px-2 py-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
          {/* The #/School/Start group is its own col-span-3 grid using
              the exact same grid-cols-[5.75rem_1fr_4.25rem] template
              (and gap) as each row's own button below, rather than
              three independent columns of this outer 4-col grid - that
              guarantees their boundaries are computed identically, not
              just hopefully-equal, so the divide lines here land
              exactly on the row content's own column edges instead of
              drifting off to the side of them. `fill` on "#" makes its
              whole 2.75rem-wide cell the tap target, not just the
              "#"-glyph-plus-icon sliver a plain inline button would be. */}
          <div className="col-span-3 grid grid-cols-[5.75rem_1fr_4.25rem] items-stretch gap-x-1 divide-x divide-zinc-200">
            <div className="grid h-full grid-cols-[2.75rem_1fr] items-stretch gap-x-1">
              <SortableHeader
                label="#"
                field="routeNumber"
                align="center"
                fill
                padded={false}
                sortField={sortField}
                sortDir={sortDir}
                onSort={toggleSort}
              />
              <SortableHeader
                label="AM/PM"
                field="tripType"
                align="center"
                padded={false}
                sortField={sortField}
                sortDir={sortDir}
                onSort={toggleSort}
              />
            </div>
            <SortableHeader
              label="School"
              field="schoolName"
              align="center"
              padded={false}
              sortField={sortField}
              sortDir={sortDir}
              onSort={toggleSort}
            />
            <SortableHeader
              label="Start"
              field="departureTime"
              align="center"
              padded={false}
              sortField={sortField}
              sortDir={sortDir}
              onSort={toggleSort}
            />
          </div>
          {/* Matches the row's own last-column icon slot exactly - the
              favorite heart normally, a pencil in admin mode (see the
              row rendering below) - same `justify-self-end p-1`
              positioning as that button too, not just centered in the
              column generically, so this actually lines up with it
              instead of merely sitting in the same column. Never
              itself clickable/sortable, just labeling what that column
              currently holds. */}
          <span className="justify-self-end p-1">
            {adminMode ? (
              <EditIcon className="h-4 w-4 text-blue-600" />
            ) : (
              <HeartIcon className="h-4 w-4 text-zinc-400" />
            )}
          </span>
        </div>
        <div className="divide-y divide-zinc-200 overflow-y-auto">
          {filtered.map((route) => {
            const isPublished = isRoutePublished(route, demoHiddenIds);
            const isAdminOnly = !isPublished;
            return (
              <div key={route.id}>
                <div
                  className={`grid w-full grid-cols-[5.75rem_1fr_4.25rem_1.25rem] items-center gap-x-1 px-2 py-3 text-left ${
                    isAdminOnly ? "opacity-50" : ""
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onSelect(route)}
                    className="col-span-3 grid grid-cols-[5.75rem_1fr_4.25rem] items-center gap-x-1 text-left active:bg-zinc-100"
                  >
                    <div className="flex items-center gap-1.5">
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
                    <span className="min-w-0 pl-3">
                      <SchoolNameLabel name={route.schoolName} />
                      {isAdminOnly && (
                        // Always "draft" here, whether this is a real
                        // draft route or a demo one toggled unpublished
                        // this session (see isRoutePublished) - reaching
                        // this branch at all already means "not
                        // currently published," the same thing for both.
                        <span className="block text-xs font-semibold tracking-wide text-zinc-400 uppercase">
                          draft
                        </span>
                      )}
                    </span>
                    <span className="text-right text-sm font-semibold text-zinc-500">
                      {route.departureTime}
                    </span>
                  </button>
                  {adminMode ? (
                    <button
                      type="button"
                      onClick={() => onEditRoute(route)}
                      aria-label={`Edit route ${route.routeNumber}`}
                      className="justify-self-end p-1 text-blue-600 active:opacity-70"
                    >
                      <EditIcon className="h-4 w-4" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onToggleFavorite(route)}
                      aria-label={route.isFavorite ? "Remove favorite" : "Add favorite"}
                      className="justify-self-end p-1 active:opacity-70"
                    >
                      <HeartIcon
                        filled={route.isFavorite}
                        className={`h-4 w-4 ${route.isFavorite ? "text-blue-600" : "text-zinc-300"}`}
                      />
                    </button>
                  )}
                </div>

                {/* Admin-only quick actions - shown for every route,
                    demo included, not just real ones - each one a
                    confirm-modal request, never fired directly from
                    here, so a stray tap can't silently flip a route
                    live or delete one. Delete (the destructive one)
                    always reads leftmost. Every route gets Unpublish
                    once published; an unpublished one gets Delete and
                    Publish instead - deleting a published route isn't
                    offered at all, it has to be unpublished first. */}
                {adminMode && (
                  <div className="-mt-1 flex items-center gap-2 px-2 pb-2">
                    {isPublished ? (
                      <button
                        type="button"
                        onClick={() => setConfirmRequest({ type: "unpublish", route })}
                        className="flex items-center gap-1 rounded-lg border border-zinc-300 px-2 py-1 text-xs font-semibold text-zinc-600 active:bg-zinc-100"
                      >
                        <EyeOffIcon className="h-3.5 w-3.5" />
                        Unpublish
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => setConfirmRequest({ type: "delete", route })}
                          className="flex items-center gap-1 rounded-lg border border-red-300 px-2 py-1 text-xs font-semibold text-red-600 active:bg-red-50"
                        >
                          <TrashIcon className="h-3.5 w-3.5" />
                          Delete
                        </button>
                        <button
                          type="button"
                          onClick={() => handlePublishClick(route)}
                          disabled={checkingRouteId === route.id}
                          className="flex items-center gap-1 rounded-lg border border-zinc-300 px-2 py-1 text-xs font-semibold text-zinc-600 disabled:opacity-50 active:bg-zinc-100"
                        >
                          <EyeIcon className="h-3.5 w-3.5" />
                          {checkingRouteId === route.id ? "Checking…" : "Publish"}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {filtered.length === 0 && (
            <p className="px-2 py-6 text-center text-sm text-zinc-500">
              {query ? <>No routes match &ldquo;{query}&rdquo;.</> : "No routes match the selected filters."}
            </p>
          )}
        </div>
      </div>

      {/* The Home Screen's own entry point (adminMode off) stays the
          small `btn-glossy` chip this used to be everywhere - a
          district-admin tool, not something that needs to compete with
          Search/View for attention. Once actually in edit mode, though,
          both controls become full-width and split evenly, the same
          large treatment as StepScreen's own Back/Next footer buttons
          (flex-1 each, py-3, text-lg) - exiting is deliberately the
          gray/neutral button of the pair, adding a route is the blue
          "forward" action. */}
      {adminMode ? (
        <div ref={controlsRef} className="flex w-full max-w-md shrink-0 items-center gap-3">
          <button
            type="button"
            onClick={onToggleAdminMode}
            className="btn-glossy font-heading flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-zinc-500 bg-zinc-300 py-3 text-lg font-semibold text-zinc-900"
          >
            <EditIcon className="h-5 w-5" />
            Exit Edit Mode
          </button>
          <button
            type="button"
            onClick={onAddRoute}
            className="btn-glossy font-heading flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-blue-600 py-3 text-lg font-semibold text-white"
          >
            <PlusIcon className="h-5 w-5" />
            New Route
          </button>
        </div>
      ) : (
        <div ref={controlsRef} className="flex shrink-0 items-center">
          <button
            type="button"
            onClick={onToggleAdminMode}
            className="btn-glossy flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white"
          >
            <EditIcon className="h-3 w-3" />
            Edit Routes
          </button>
        </div>
      )}

      <a
        href="mailto:nathan@pizar.net"
        className="shrink-0 text-xs text-zinc-400 active:text-zinc-600"
      >
        © 2026 Nathan D. B. Pizar
      </a>

      {confirmRequest && (
        <ConfirmModal
          title={
            confirmRequest.type === "delete"
              ? `Delete Route ${confirmRequest.route.routeNumber}?`
              : confirmRequest.type === "publish"
                ? `Publish Route ${confirmRequest.route.routeNumber}?`
                : `Unpublish Route ${confirmRequest.route.routeNumber}?`
          }
          message={
            confirmRequest.type === "delete"
              ? "This removes it for the rest of this session and can't be undone."
              : confirmRequest.type === "publish"
                ? "Drivers will see this route as soon as it's published."
                : "Drivers will no longer see this route until it's published again."
          }
          confirmLabel={
            confirmRequest.type === "delete"
              ? "Delete"
              : confirmRequest.type === "publish"
                ? "Publish"
                : "Unpublish"
          }
          confirmIcon={
            confirmRequest.type === "delete" ? <TrashIcon className="h-4 w-4" /> : undefined
          }
          destructive={confirmRequest.type === "delete"}
          onCancel={() => setConfirmRequest(null)}
          onConfirm={() => {
            if (confirmRequest.type === "delete") {
              onDeleteRoute(confirmRequest.route);
            } else {
              onSetRouteStatus(
                confirmRequest.route,
                confirmRequest.type === "publish" ? "published" : "draft",
              );
            }
            setConfirmRequest(null);
          }}
        />
      )}

      {adminMode && (
        <button
          type="button"
          onClick={handleDownloadCsv}
          aria-label="Download the route list as a CSV"
          className="btn-glossy fixed right-4 bottom-4 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-zinc-500 bg-zinc-300 text-zinc-900"
        >
          <DownloadIcon className="h-4 w-4" />
        </button>
      )}

      {onViewSchools && (
        <button
          type="button"
          onClick={onViewSchools}
          className="btn-glossy fixed bottom-4 left-4 z-10 flex items-center gap-1.5 rounded-full border border-zinc-500 bg-zinc-300 px-3.5 py-2 text-sm font-semibold text-zinc-900"
        >
          <SchoolIcon className="h-4 w-4" />
          View all Schools
        </button>
      )}
    </div>
  );
}

/** A school name, single-line and non-wrapping - a long name used to
 * wrap "School" onto its own line (line-clamp-2), which read as an
 * orphaned word more than a real second line of content. A smaller
 * `text-sm` (down from the row's own default size) buys back some of
 * that room on its own before anything below even has to kick in.
 * Measures its own rendered width against its available column width
 * next: if the full name still doesn't fit, it drops a trailing
 * " School" (the only word actually worth shortening away -
 * "Elementary"/"Middle"/"High" all carry real information "School"
 * alone repeats) and re-measures on resize; a name that's still too
 * long even without that word (or one that never had it) just
 * truncates normally, browser ellipsis and all - there's no further
 * clever shortening beyond the one word this app's own real school
 * names, see schools.csv, prompted this for. */
function SchoolNameLabel({ name }: { name: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [dropSchoolWord, setDropSchoolWord] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || !/ School$/.test(name)) {
      setDropSchoolWord(false);
      return;
    }
    const checkFit = () => setDropSchoolWord(el.scrollWidth > el.clientWidth);
    checkFit();
    const observer = new ResizeObserver(checkFit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [name]);

  return (
    <span ref={ref} className="block truncate text-sm leading-snug text-zinc-700">
      {dropSchoolWord ? name.replace(/ School$/, "") : name}
    </span>
  );
}

/** One clickable, sortable column header - label plus the traditional
 * stacked up/down carets (SortIcon), which always render but only show
 * the active direction solid once this is the column being sorted by.
 * Every header here is `align="center"` - labels read centered in
 * their own cell regardless of how that column's own data below is
 * aligned (Start's data is right-aligned, say). */
function SortableHeader({
  label,
  field,
  align = "left",
  padded = true,
  fill = false,
  sortField,
  sortDir,
  onSort,
}: {
  label: string;
  field: SortField;
  align?: "left" | "center" | "right";
  /** This header's own leading gutter (pl-3, none if it's the first in
   * its row) - on by default, off for every header in the route list's
   * own header row (see above), which get their spacing from their
   * shared grid's own gap and centered text instead of a per-button
   * padding. */
  padded?: boolean;
  /** Fills its whole grid cell instead of shrinking to its own label+
   * icon width - used for "#", whose tiny label alone would otherwise
   * be a cramped tap target hugging the row's left edge. */
  fill?: boolean;
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
      className={`flex items-center gap-1 bg-transparent ${fill ? "h-full w-full" : ""} ${
        padded ? "pl-3 first:pl-0" : ""
      } ${justify} ${active ? "text-zinc-700" : ""}`}
    >
      <span>{label}</span>
      <SortIcon direction={active ? sortDir : "none"} className="h-2.5 w-2.5 shrink-0" />
    </button>
  );
}
