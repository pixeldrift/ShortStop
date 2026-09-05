"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ConfirmModal } from "./ConfirmModal";
import { Logo } from "./Logo";
import {
  EditIcon,
  HeartIcon,
  PlusIcon,
  SearchIcon,
  SortIcon,
  SunIcon,
  SunriseIcon,
  TrashIcon,
  TriangleIcon,
} from "./icons";
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
  adminMode,
  adminWaypointCaches,
  onToggleAdminMode,
  onSelect,
  onEditRoute,
  onAddRoute,
  onSetRouteStatus,
  onDeleteRoute,
}: {
  routes: Route[];
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
  /** Normal navigation - the trip-summary/step flow. Used for every
   * route when not in admin mode, and for published/demo routes even
   * while in admin mode (only a draft route's row opens straight into
   * editing instead - see handleRowClick below). */
  onSelect: (route: Route) => void;
  /** Opens EditRouteScreen directly for this route - admin mode only,
   * draft routes only (see handleRowClick), or a draft route that
   * isn't actually ready to publish yet (see handlePublishClick). */
  onEditRoute: (route: Route) => void;
  onAddRoute: () => void;
  onSetRouteStatus: (route: Route, status: RouteStatus) => void;
  onDeleteRoute: (route: Route) => void;
}) {
  const [query, setQuery] = useState("");
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);
  // Only set while handlePublishClick's own readiness check is in
  // flight - not surfaced as a spinner anywhere yet, just prevents a
  // second tap on the same row from firing a second check.
  const [checkingRouteId, setCheckingRouteId] = useState<string | null>(null);
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
      // A real (non-"demo") route that isn't "published" only ever
      // shows up in admin mode - a normal driver never needs to see a
      // route nobody's actually running.
      const isAdminOnly = route.status !== "published" && route.status !== "demo";
      if (isAdminOnly && !adminMode) return false;

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
  }, [routes, query, view, sortField, sortDir, adminMode]);

  // In admin mode, tapping any real route's row (its heart-icon slot
  // is a pencil then, see below) goes straight to editing it, whatever
  // its status - published or draft, there's always something to
  // review or fix. A demo route never has real data behind it to edit
  // at all, so its row keeps opening normally (and keeps showing the
  // heart, not a pencil) even while in admin mode.
  function handleRowClick(route: Route) {
    if (adminMode && route.status !== "demo") onEditRoute(route);
    else onSelect(route);
  }

  // "Publish" never just flips the status - the same "every geocodable
  // stop has to actually resolve first" rule EditRouteScreen.tsx
  // enforces applies here too, checked against the route's own
  // committed sidecar cache merged with this session's own
  // fetched-but-not-yet-committed overlay (adminWaypointCaches). A
  // route that isn't ready skips the confirm modal entirely and goes
  // straight to the edit screen instead, where the real warning UI
  // (and the Fetch/Fetch All buttons that actually fix this) already
  // lives - no separate warning needed here.
  async function handlePublishClick(route: Route) {
    setCheckingRouteId(route.id);
    try {
      const committed = await fetchCommittedWaypointCache(route);
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

  return (
    <div className="flex flex-1 flex-col items-center gap-4 overflow-y-auto px-6 pt-10 pb-6 text-center landscape:pt-6">
      <Logo size="large" />
      <h1 className="font-heading flex items-center gap-2 text-2xl font-black tracking-tight">
        {adminMode && <EditIcon className="h-5 w-5 shrink-0 text-red-600" />}
        {adminMode ? "Editing Routes" : "Routes"}
      </h1>

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

      <div
        className={`flex w-full max-w-md flex-1 flex-col overflow-hidden rounded-2xl border text-left ${
          adminMode ? "border-2 border-red-400" : "border-zinc-300"
        }`}
      >
        <div className="grid grid-cols-[5.75rem_1fr_4.25rem_1.25rem] items-stretch gap-x-1 divide-x divide-zinc-200 border-b border-zinc-300 bg-zinc-100 px-2 py-[0.4375rem] text-xs font-semibold tracking-wide text-zinc-500 uppercase">
          <div className="flex items-center">
            <SortableHeader
              label="#"
              field="routeNumber"
              sortField={sortField}
              sortDir={sortDir}
              onSort={toggleSort}
            />
            <SortableHeader
              label="AM/PM"
              field="tripType"
              tight
              sortField={sortField}
              sortDir={sortDir}
              onSort={toggleSort}
            />
          </div>
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
          {filtered.map((route) => {
            const isDemo = route.status === "demo";
            const isAdminOnly = !isDemo && route.status !== "published";
            return (
              <div key={route.id} className={isAdminOnly ? "opacity-50" : ""}>
                <button
                  type="button"
                  onClick={() => handleRowClick(route)}
                  className="grid w-full grid-cols-[5.75rem_1fr_4.25rem_1.25rem] items-center gap-x-1 px-2 py-2.5 text-left active:bg-zinc-100"
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
                      <span className="block text-xs font-semibold tracking-wide text-zinc-400 uppercase">
                        {route.status}
                      </span>
                    )}
                  </span>
                  <span className="text-right text-sm font-semibold text-zinc-500">
                    {route.departureTime}
                  </span>
                  {adminMode && !isDemo ? (
                    <EditIcon className="h-4 w-4 justify-self-end text-zinc-400" />
                  ) : (
                    <HeartIcon
                      filled={route.isFavorite}
                      className={`h-4 w-4 justify-self-end ${
                        route.isFavorite ? "text-blue-600" : "text-zinc-300"
                      }`}
                    />
                  )}
                </button>

                {/* Admin-only quick actions - each one a confirm-modal
                    request, never fired directly from here, so a
                    stray tap can't silently flip a route live or
                    delete one. Delete (the destructive one) always
                    reads leftmost. Every real (non-demo) route gets
                    Unpublish once published; a draft one gets Delete
                    and Publish instead - deleting a published route
                    isn't offered at all, it has to be unpublished
                    first. */}
                {adminMode && !isDemo && (
                  <div className="-mt-1 flex items-center gap-2 px-2 pb-2">
                    {route.status === "published" ? (
                      <button
                        type="button"
                        onClick={() => setConfirmRequest({ type: "unpublish", route })}
                        className="rounded-lg border border-zinc-300 px-2 py-1 text-xs font-semibold text-zinc-600 active:bg-zinc-100"
                      >
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
                          className="rounded-lg border border-zinc-300 px-2 py-1 text-xs font-semibold text-zinc-600 disabled:opacity-50 active:bg-zinc-100"
                        >
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

      {/* Small and unobtrusive on purpose - a district-admin tool, not
          a primary driver action, tucked below the list rather than up
          with Search/View. "New Route" only appears once already in
          edit mode - there's no direct route to it from the normal
          (non-admin) list. */}
      <div className="flex shrink-0 items-center gap-4">
        <button
          type="button"
          onClick={onToggleAdminMode}
          className="flex items-center gap-1 text-xs font-medium text-zinc-400 active:text-zinc-600"
        >
          <EditIcon className="h-3 w-3" />
          {adminMode ? "Exit Edit Mode" : "Edit Mode"}
        </button>
        {adminMode && (
          <button
            type="button"
            onClick={onAddRoute}
            className="flex items-center gap-1 text-xs font-medium text-zinc-400 active:text-zinc-600"
          >
            <PlusIcon className="h-3 w-3" />
            New Route
          </button>
        )}
      </div>

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
    </div>
  );
}

/** A school name, single-line and non-wrapping - a long name used to
 * wrap "School" onto its own line (line-clamp-2), which read as an
 * orphaned word more than a real second line of content. Measures its
 * own rendered width against its available column width instead: if
 * the full name doesn't fit, it drops a trailing " School" (the only
 * word actually worth shortening away - "Elementary"/"Middle"/"High"
 * all carry real information "School" alone repeats) and re-measures
 * on resize; a name that's still too long even without that word (or
 * one that never had it) just truncates normally, browser ellipsis and
 * all - there's no further clever shortening beyond the one word this
 * app's own real school names, see schools.csv, prompted this for. */
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
    <span ref={ref} className="block truncate leading-snug text-zinc-700">
      {dropSchoolWord ? name.replace(/ School$/, "") : name}
    </span>
  );
}

/** One clickable, sortable column header - label plus the traditional
 * stacked up/down carets (SortIcon), which always render but only show
 * the active direction solid once this is the column being sorted by.
 * `align="right"` keeps the Start column's label-then-icon order
 * matching its own right-aligned data below. `tight` is for the AM/PM
 * header specifically - it sits right beside "#" in one shared column
 * now (see the header row above), not its own separately-centered
 * track, so it needs a much smaller leading gap than the normal `pl-3`
 * every other header uses between columns. */
function SortableHeader({
  label,
  field,
  align = "left",
  tight = false,
  sortField,
  sortDir,
  onSort,
}: {
  label: string;
  field: SortField;
  align?: "left" | "center" | "right";
  tight?: boolean;
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
      className={`flex items-center gap-1 bg-transparent ${tight ? "pl-1.5" : "pl-3 first:pl-0"} ${justify} ${
        active ? "text-zinc-700" : ""
      }`}
    >
      <span>{label}</span>
      <SortIcon direction={active ? sortDir : "none"} className="h-2.5 w-2.5 shrink-0" />
    </button>
  );
}
