"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ConfirmModal } from "./ConfirmModal";
import {
  BackArrowIcon,
  CheckboxIcon,
  CloseIcon,
  DownloadIcon,
  EditIcon,
  EyeIcon,
  EyeOffIcon,
  HeartIcon,
  MailIcon,
  MapPinIcon,
  PlusIcon,
  RouteIcon,
  SchoolIcon,
  SearchIcon,
  SunIcon,
  SunriseIcon,
  TrashIcon,
} from "./icons";
import { downloadCsv, routeListToCsv } from "@/lib/exportCsv";
import { fetchCommittedWaypointCache, isRouteFullyResolved } from "@/lib/routeReadiness";
import { parseTimeToMinutes } from "@/lib/time";
import type { Route, RouteStatus, SchoolLevel, TripType } from "@/lib/types";
import type { WaypointCache } from "@/lib/waypointCache";
import { SortableHeader } from "./SortableHeader";
import type { SortDir } from "./SortableHeader";

/** A pending confirm-modal request - which action, on which route(s).
 * Rendered as a single shared ConfirmModal below rather than one
 * inline per row, so at most one is ever open at a time. `routes` is
 * always at least one - a per-row action passes a single-item array,
 * the bulk "…Selected" toolbar passes every currently selected route,
 * so both share the same confirm/apply path instead of two separate
 * ones. */
type ConfirmRequest =
  | { type: "publish"; routes: Route[] }
  | { type: "unpublish"; routes: Route[] }
  | { type: "delete"; routes: Route[] };

type SortField = "routeNumber" | "tripType" | "schoolName" | "departureTime";

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

// Every toggle starts off (gray/"not filtering") - an empty set here
// means "no filter in this group," so the default state (nothing
// tapped yet) shows everything, same as the old dropdown's own "All"
// option used to. Tapping one on narrows the list to routes matching
// *some* active toggle within that same group; the other group (if
// it also has something on) still applies independently.
const TRIP_TYPE_TOGGLES: { value: TripType; label: string }[] = [
  { value: "pickup", label: "AM" },
  { value: "dropoff", label: "PM" },
];
const SCHOOL_LEVEL_TOGGLES: { value: SchoolLevel; label: string }[] = [
  { value: "elementary", label: "EL" },
  { value: "middle", label: "MS" },
  { value: "high", label: "HS" },
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
 * Start / favorite heart), filterable by a search box and AM/PM +
 * school-level toggles above it. Tapping a row goes to that route's
 * trip-summary screen (StartScreen), or opens its edit screen directly
 * once admin mode is on. Only one real route exists (see ROUTE_META in
 * page.tsx) - the rest are fabricated by buildDemoRoutes purely so this
 * screen has enough rows to actually exercise scrolling and search,
 * clearly flagged as fake in the generator itself rather than
 * pretending to be real district data.
 */
export function RouteListScreen({
  routes,
  title,
  onBack,
  slideInOnMount,
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
  /** True for the app's very first paint of this screen, right after
   * route data finishes loading (see page.tsx's own `justLoaded`) -
   * slides the heading/search/table up into place under the logo
   * (already visible during the "Loading routes…" state) instead of
   * snapping straight into view. Only the top-level route list passes
   * this - the school-scoped reuse and every later visit back to this
   * screen (admin toggle, search, etc.) just render normally. */
  slideInOnMount?: boolean;
  /** Renders the "Schools" link (under the table, left-aligned) when
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
   * main tap target outside admin mode - once admin mode is on, the
   * row instead just selects itself (see the row rendering below), so
   * this never fires while adminMode is true. */
  onSelect: (route: Route) => void;
  /** Opens EditRouteScreen directly for this route - fired by the
   * "Edit Selected" bulk button (only enabled for exactly one selected
   * route, there's only one edit screen), or by a "Publish Selected"
   * attempt on a single route that turns out not to be ready yet (see
   * handlePublishClick). */
  onEditRoute: (route: Route) => void;
  onAddRoute: () => void;
  onSetRouteStatus: (route: Route, status: RouteStatus) => void;
  onDeleteRoute: (route: Route) => void;
  /** Toggles a route's own favorite heart - independent of the row's
   * main click (onSelect), which only ever navigates; see the row
   * rendering below for how the heart gets its own tap target (a
   * checkbox takes its place there instead, in admin mode). */
  onToggleFavorite: (route: Route) => void;
  /** Which fabricated demo routes are "unpublished" this session (see
   * page.tsx) - a demo route's own `status` always stays literally
   * "demo" (every real/fake distinction elsewhere depends on that), so
   * this is the only place that knows one's been toggled off; combined
   * with `route.status` via isRoutePublished below wherever a row needs
   * to know whether it currently reads as published. */
  demoHiddenIds: ReadonlySet<string>;
}) {
  // Only ever read when onBack is set (the school-scoped reuse) - every
  // route here already carries its own school's address (Route.schoolAddress),
  // so the school itself is the same for all of them; no separate prop
  // needed just to look one up.
  const scopedSchoolAddress = routes[0]?.schoolAddress;
  const [query, setQuery] = useState("");
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);
  // Only set while handlePublishClick's own readiness check is in
  // flight - not surfaced as a spinner anywhere yet, just prevents a
  // second tap on the same row from firing a second check.
  const [checkingRouteId, setCheckingRouteId] = useState<string | null>(null);
  // Every toggle starts off - see TRIP_TYPE_TOGGLES/SCHOOL_LEVEL_TOGGLES
  // above for why an empty set is the "show everything" state here.
  const [activeTripTypes, setActiveTripTypes] = useState<ReadonlySet<TripType>>(() => new Set());
  const [activeSchoolLevels, setActiveSchoolLevels] = useState<ReadonlySet<SchoolLevel>>(() => new Set());
  function toggleTripType(value: TripType) {
    setActiveTripTypes((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }
  function toggleSchoolLevel(value: SchoolLevel) {
    setActiveSchoolLevels((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }
  // Admin-mode bulk selection (the checkbox column) - route ids, not
  // Route objects, so a route that gets edited/reloaded mid-session
  // doesn't silently drop out of an existing selection by object
  // identity.
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  // "Adjust state during render" (React's own sanctioned pattern for
  // this, see ScreenTransition.tsx/StepScreen.tsx elsewhere in this
  // app) rather than a useEffect - clears the selection the moment
  // admin mode itself turns off, without the extra render/lint issue a
  // synchronous setState-in-effect would trigger.
  const [prevAdminMode, setPrevAdminMode] = useState(adminMode);
  if (adminMode !== prevAdminMode) {
    setPrevAdminMode(adminMode);
    if (!adminMode) setSelectedIds(new Set());
  }
  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  // routeNumber/asc (tripType as its own tie-break, see
  // SORT_COMPARATORS) is the default a driver actually wants: routes
  // grouped by bus, AM before PM within a bus, rather than the arrival
  // order page.tsx happens to hand this screen (real+demo routes
  // sorted by departure time).
  const [sortField, setSortField] = useState<SortField>("routeNumber");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  // Lets a tap outside the red admin-mode box exit it (see the effect
  // below) without also swallowing a tap on the "Exit Edit Mode"/"New
  // Route" controls themselves, or the "…Selected" bulk toolbar right
  // below the box - all three live in these refs, specifically excluded
  // so this effect never double-fires alongside their own click handler
  // (Exit Edit Mode, New Route which needs adminMode to stay on across
  // the navigation it triggers, and Delete/Edit/Publish Selected which
  // need their own onClick to actually run instead of getting cut off
  // by admin mode exiting first).
  const boxRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const bulkActionsRef = useRef<HTMLDivElement>(null);

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
      if (bulkActionsRef.current?.contains(target)) return;
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
      const matchesToggles =
        (activeTripTypes.size === 0 || activeTripTypes.has(route.tripType)) &&
        (activeSchoolLevels.size === 0 || activeSchoolLevels.has(route.schoolLevel));
      return matchesQuery && matchesToggles;
    });

    const compare = SORT_COMPARATORS[sortField];
    return [...matching].sort((a, b) => {
      const result = compare(a, b);
      return sortDir === "asc" ? result : -result;
    });
  }, [routes, query, activeTripTypes, activeSchoolLevels, sortField, sortDir, adminMode, demoHiddenIds]);

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
      setConfirmRequest({ type: "publish", routes: [route] });
      return;
    }
    setCheckingRouteId(route.id);
    try {
      const committed = await fetchCommittedWaypointCache();
      const merged = { ...committed, ...(adminWaypointCaches[route.id] ?? {}) };
      if (isRouteFullyResolved(route, merged)) {
        setConfirmRequest({ type: "publish", routes: [route] });
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

  // The bulk "Publish/Unpublish Selected" button - unpublishing never
  // needs a readiness check (see canToggleStatus's own reasoning in
  // EditRouteScreen.tsx), so that direction always goes straight to
  // the confirm modal. Publishing exactly one selected route reuses
  // handlePublishClick's own readiness check/edit-screen redirect
  // (the common case, now that selecting is a single tap away) - a
  // real multi-route selection has nowhere sensible to redirect *to*
  // for just one of several, so that case alone skips the check.
  function handlePublishSelected() {
    if (allSelectedPublished) {
      setConfirmRequest({ type: "unpublish", routes: selectedRoutes });
      return;
    }
    if (selectedRoutes.length === 1) {
      handlePublishClick(selectedRoutes[0]);
      return;
    }
    setConfirmRequest({ type: "publish", routes: selectedRoutes });
  }

  // Backs the "…Selected" toolbar under the table - looked up against
  // the full `routes` prop, not `filtered`, so a route stays selected
  // even if a search/toggle change scrolls it out of view momentarily.
  const selectedRoutes = routes.filter((r) => selectedIds.has(r.id));
  const allSelectedPublished =
    selectedRoutes.length > 0 && selectedRoutes.every((r) => isRoutePublished(r, demoHiddenIds));
  // Mirrors the per-row Delete button's own safety rule (disabled until
  // unpublished) - bulk delete stays disabled unless *every* selected
  // route already reads unpublished, rather than silently skipping the
  // published ones and deleting only the rest.
  const canBulkDelete =
    selectedRoutes.length > 0 && selectedRoutes.every((r) => !isRoutePublished(r, demoHiddenIds));

  return (
    <div className="flex flex-1 flex-col items-center gap-4 overflow-hidden px-6 pb-2 text-center">
      {/* Everything that can genuinely grow past the viewport (the
          route table especially) lives in this inner, scrollable
          region - the toolbar/links/copyright below stay outside it,
          pinned to the bottom of the screen instead of scrolling away
          with a long/filtered list. */}
      <div
        className={`flex min-h-0 w-full flex-1 flex-col items-center gap-4 ${
          slideInOnMount ? "animate-list-content-enter" : ""
        }`}
      >
        {onBack ? (
          <div className="flex w-full flex-col items-center gap-1">
            <div className="flex w-full max-w-md items-center justify-between">
              <button
                type="button"
                onClick={onBack}
                aria-label="Back to schools"
                className="btn-glossy-light flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-300 text-zinc-900"
              >
                <BackArrowIcon className="h-5 w-5" />
              </button>
              <h1 className="font-heading flex items-center gap-2 text-4xl font-black tracking-tight">{title}</h1>
              <span className="h-10 w-10 shrink-0" aria-hidden="true" />
            </div>
            {/* Same MapPinIcon + address convention every other
                school-name callout in the app uses (StartScreen's own
                school card, StepScreen's "From/To" line) - under the
                name, not folded into the heading itself. */}
            {scopedSchoolAddress && (
              <p className="flex items-center justify-center gap-1 text-sm text-zinc-500">
                <MapPinIcon className="h-3.5 w-3.5 shrink-0 text-blue-500" />
                {scopedSchoolAddress}
              </p>
            )}
          </div>
        ) : (
          <div className="flex w-full flex-col items-center gap-1">
            <div className="flex w-full max-w-md items-center justify-between">
              {/* A real back arrow only in admin mode, where it exits
                  edit mode (same action as the "Exit Edit Mode" button
                  below, just also reachable the way every other screen's
                  own back arrow sits) - the top-level route list itself
                  has nowhere to go back to, so this stays an inert
                  same-size spacer then, keeping the title centered
                  either way rather than shifting over once a real button
                  appears. */}
              {adminMode ? (
                <button
                  type="button"
                  onClick={onToggleAdminMode}
                  aria-label="Exit edit mode"
                  className="btn-glossy-light flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-300 text-zinc-900"
                >
                  <BackArrowIcon className="h-5 w-5" />
                </button>
              ) : (
                <span className="h-10 w-10 shrink-0" aria-hidden="true" />
              )}
              <div>
                {/* Same small district label SchoolListScreen carries
                    above its own heading. */}
                <span className="block text-xs font-semibold tracking-wide text-zinc-400 uppercase">
                  Rutherford County
                </span>
                <h1 className="font-heading -mt-1 flex items-center justify-center gap-2 text-4xl leading-none font-black tracking-tight">
                  <RouteIcon className="h-6 w-6 shrink-0 text-blue-600" />
                  {adminMode ? "Edit Routes" : "Routes"}
                </h1>
              </div>
              <span className="h-10 w-10 shrink-0" aria-hidden="true" />
            </div>
          </div>
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
          {/* Two stacked toggle rows, not a dropdown - time of day on
              top, school level below. Every toggle starts on/blue
              ("showing"); tapping one off fades it, excluding that
              trip type/level from the list below rather than picking a
              single exclusive view the old "View" dropdown did. Sized
              small enough that both rows together sit within the
              search box's own height beside them, not taller than it. */}
          <div className="flex shrink-0 flex-col gap-0.5">
            <div className="flex items-center gap-0.5">
              {TRIP_TYPE_TOGGLES.map((toggle) => {
                const active = activeTripTypes.has(toggle.value);
                return (
                  <button
                    key={toggle.value}
                    type="button"
                    onClick={() => toggleTripType(toggle.value)}
                    aria-pressed={active}
                    className={`rounded px-1.5 py-0.5 text-[10px] leading-tight font-bold ${
                      active ? "bg-blue-600 text-white" : "bg-zinc-200 text-zinc-400"
                    }`}
                  >
                    {toggle.label}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-0.5">
              {SCHOOL_LEVEL_TOGGLES.map((toggle) => {
                const active = activeSchoolLevels.has(toggle.value);
                return (
                  <button
                    key={toggle.value}
                    type="button"
                    onClick={() => toggleSchoolLevel(toggle.value)}
                    aria-pressed={active}
                    className={`rounded px-1.5 py-0.5 text-[10px] leading-tight font-bold ${
                      active ? "bg-blue-600 text-white" : "bg-zinc-200 text-zinc-400"
                    }`}
                  >
                    {toggle.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div
          ref={boxRef}
          className={`flex min-h-0 w-full max-w-md flex-1 flex-col overflow-hidden rounded-2xl border text-left ${
            adminMode ? "border-2 border-dashed border-blue-400" : "border-zinc-300"
          }`}
        >
          <div className="grid grid-cols-[5.75rem_1fr_3.75rem_1.75rem] items-stretch gap-x-1 divide-x divide-zinc-200 border-b border-zinc-300 bg-zinc-100 px-2 py-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
            {/* The #/School/Start group is its own col-span-3 grid using
                the exact same grid-cols-[5.75rem_1fr_3.75rem] template
                (and gap) as each row's own button below, rather than
                three independent columns of this outer 4-col grid - that
                guarantees their boundaries are computed identically, not
                just hopefully-equal, so the divide lines here land
                exactly on the row content's own column edges instead of
                drifting off to the side of them. */}
            <div className="col-span-3 grid grid-cols-[5.75rem_1fr_3.75rem] items-stretch gap-x-1 divide-x divide-zinc-200">
              {/* "#" keeps its own cell/divider, separate from AM/PM -
                  AM and PM themselves stack as two lines within that
                  second cell instead of reading "AM/PM" on one line. A
                  bigger label than the rest of this row's own text-xs
                  (this is the whole table's own primary sort key, and
                  the tap target every row's own big route-number digits
                  echo) - easier to actually see/hit than a header cell
                  this narrow would otherwise read as. */}
              <div className="grid h-full grid-cols-[2.75rem_1fr] items-stretch gap-x-1 divide-x divide-zinc-200">
                <SortableHeader
                  label={<span className="text-base leading-none">#</span>}
                  field="routeNumber"
                  align="center"
                  fill
                  padded={false}
                  sortField={sortField}
                  sortDir={sortDir}
                  onSort={toggleSort}
                />
                <SortableHeader
                  label={
                    <span className="flex flex-col items-center leading-none">
                      <span>AM</span>
                      <span>PM</span>
                    </span>
                  }
                  field="tripType"
                  align="center"
                  fill
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
                favorite heart normally, a "select all" checkbox in admin
                mode (see the row rendering below, whose own checkbox
                replaces what used to be a pencil there - editing now
                happens by tapping the row itself) - same
                `justify-self-center` positioning as that button too, not
                just sitting in the same column, so this actually lines
                up with it, evenly centered in its own (wider than the
                icon itself) column rather than crowding the divider on
                its left. */}
            {adminMode ? (
              <button
                type="button"
                onClick={() =>
                  setSelectedIds(
                    filtered.length > 0 && filtered.every((r) => selectedIds.has(r.id))
                      ? new Set()
                      : new Set(filtered.map((r) => r.id)),
                  )
                }
                aria-label={
                  filtered.length > 0 && filtered.every((r) => selectedIds.has(r.id))
                    ? "Deselect all routes"
                    : "Select all routes"
                }
                className="justify-self-center p-1 text-blue-600 active:opacity-70"
              >
                <CheckboxIcon
                  checked={filtered.length > 0 && filtered.every((r) => selectedIds.has(r.id))}
                  className="h-4 w-4"
                />
              </button>
            ) : (
              <span className="justify-self-center p-1">
                <HeartIcon className="h-4 w-4 text-zinc-400" />
              </span>
            )}
          </div>
          <div className="min-h-0 flex-1 divide-y divide-zinc-200 overflow-y-auto">
            {filtered.map((route) => {
              const isPublished = isRoutePublished(route, demoHiddenIds);
              const isAdminOnly = !isPublished;
              const isSelected = adminMode && selectedIds.has(route.id);
              return (
                <div
                  key={route.id}
                  className={`grid w-full grid-cols-[5.75rem_1fr_3.75rem_1.75rem] items-center gap-x-1 px-2 py-3 text-left ${
                    isAdminOnly ? "opacity-50" : ""
                  } ${isSelected ? "ring-2 ring-inset ring-blue-500" : ""}`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      if (!adminMode) {
                        onSelect(route);
                        return;
                      }
                      // A tap selects this route alone (replacing
                      // whatever else was selected), or deselects it if
                      // it was already the only one selected - only the
                      // checkbox column builds up a multi-route
                      // selection (see toggleSelected below).
                      setSelectedIds((prev) =>
                        prev.size === 1 && prev.has(route.id) ? new Set() : new Set([route.id]),
                      );
                    }}
                    className="col-span-3 grid grid-cols-[5.75rem_1fr_3.75rem] items-center gap-x-1 text-left active:bg-zinc-100"
                  >
                    <div
                      className={`flex gap-1.5 ${
                        route.tripType === "pickup" ? "items-end" : "items-start"
                      }`}
                    >
                      <span className="font-heading text-2xl leading-none font-black">
                        {route.routeNumber}
                      </span>
                      <div className="flex items-center gap-0.5 text-blue-500">
                        <span className="font-heading text-xs leading-none font-black">
                          {route.tripType === "pickup" ? "AM" : "PM"}
                        </span>
                        {route.tripType === "pickup" ? (
                          <SunriseIcon className="h-3 w-3" />
                        ) : (
                          <SunIcon className="h-3 w-3" />
                        )}
                      </div>
                    </div>
                    <span className="min-w-0 pl-1.5">
                      <SchoolNameLabel name={route.schoolName} />
                    </span>
                    <span className="text-right text-sm font-semibold text-zinc-500">
                      {route.departureTime}
                    </span>
                  </button>
                  {adminMode ? (
                    <button
                      type="button"
                      onClick={() => toggleSelected(route.id)}
                      aria-label={
                        selectedIds.has(route.id)
                          ? `Deselect route ${route.routeNumber}`
                          : `Select route ${route.routeNumber}`
                      }
                      className="justify-self-center p-1 text-blue-600 active:opacity-70"
                    >
                      <CheckboxIcon checked={selectedIds.has(route.id)} className="h-4 w-4" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onToggleFavorite(route)}
                      aria-label={route.isFavorite ? "Remove favorite" : "Add favorite"}
                      className="justify-self-center p-1 active:opacity-70"
                    >
                      <HeartIcon
                        filled={route.isFavorite}
                        className={`h-4 w-4 ${route.isFavorite ? "text-blue-600" : "text-zinc-300"}`}
                      />
                    </button>
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
      </div>

      {/* The only way left to act on a route in admin mode - select it
          (a tap, or the checkbox column above) and use one of these.
          Delete Selected is disabled unless every selected route
          already reads unpublished. Edit Selected only ever makes
          sense for exactly one route at a time (there's only one edit
          screen), so it's disabled otherwise. Publish/Unpublish
          Selected reads "Unpublish" only once every selected route is
          already published; otherwise it publishes (see
          handlePublishSelected - a single selected route still gets
          the real readiness check/edit-screen redirect, same as the
          old per-row Publish button did; only an actual multi-route
          selection skips it, since there's nowhere to redirect *to*
          for just one of several). */}
      {adminMode && (
        <div ref={bulkActionsRef} className="flex w-full max-w-md shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setConfirmRequest({ type: "delete", routes: selectedRoutes })}
            disabled={!canBulkDelete}
            className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-red-300 px-2 py-1.5 text-xs font-semibold text-red-600 disabled:opacity-30 active:bg-red-50"
          >
            <TrashIcon className="h-3.5 w-3.5" />
            Delete Selected
          </button>
          <button
            type="button"
            onClick={() => selectedRoutes.length === 1 && onEditRoute(selectedRoutes[0])}
            disabled={selectedRoutes.length !== 1}
            className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-zinc-300 px-2 py-1.5 text-xs font-semibold text-zinc-600 disabled:opacity-30 active:bg-zinc-100"
          >
            <EditIcon className="h-3.5 w-3.5" />
            Edit Selected
          </button>
          <button
            type="button"
            onClick={handlePublishSelected}
            disabled={selectedRoutes.length === 0 || checkingRouteId !== null}
            className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-zinc-300 px-2 py-1.5 text-xs font-semibold text-zinc-600 disabled:opacity-30 active:bg-zinc-100"
          >
            {allSelectedPublished ? (
              <EyeOffIcon className="h-3.5 w-3.5" />
            ) : (
              <EyeIcon className="h-3.5 w-3.5" />
            )}
            {checkingRouteId !== null
              ? "Checking…"
              : allSelectedPublished
                ? "Unpublish Selected"
                : "Publish Selected"}
          </button>
        </div>
      )}

      {/* Schools (left) shares one row directly under the table with,
          on the right, either "Edit Routes" (outside admin mode) or a
          plain "Download routes" text link (once actually in admin
          mode) - admin mode has no "Edit Routes" counterpart here (its
          own Exit Edit Mode/New Route row follows below instead, same
          as always), so Schools sits alone, still left-aligned, if
          there's no admin-mode download link to place opposite it
          either. */}
      {(onViewSchools || !adminMode) && (
        <div
          ref={adminMode ? undefined : controlsRef}
          className="flex w-full max-w-md shrink-0 items-center justify-between"
        >
          {onViewSchools ? (
            <button
              type="button"
              onClick={onViewSchools}
              className="flex items-center gap-1.5 text-sm font-semibold text-blue-600 active:text-blue-800"
            >
              <SchoolIcon className="h-4 w-4" />
              Schools
            </button>
          ) : (
            <span />
          )}
          {/* The Home Screen's own entry point (adminMode off) stays the
              small `btn-glossy` chip this used to be everywhere - a
              district-admin tool, not something that needs to compete
              with Search/View for attention. */}
          {!adminMode && (
            <button
              type="button"
              onClick={onToggleAdminMode}
              className="btn-glossy-blue flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white"
            >
              <EditIcon className="h-3 w-3" />
              Edit Routes
            </button>
          )}
          {/* A plain text link, not a button - this is just a CSV of
              the whole routes table for now (routeListToCsv below);
              nicely formatted, printable per-route lists are a later
              step (see the README's own Next steps). */}
          {adminMode && (
            <button
              type="button"
              onClick={handleDownloadCsv}
              aria-label="Download the route list as a CSV"
              className="flex items-center gap-1.5 text-sm font-semibold text-blue-600 active:text-blue-800"
            >
              <DownloadIcon className="h-4 w-4" />
              Download routes
            </button>
          )}
        </div>
      )}

      {/* Once actually in edit mode, both controls become full-width
          and split evenly, the same large treatment as StepScreen's own
          Back/Next footer buttons (flex-1 each, py-3, text-lg) -
          exiting is deliberately the gray/neutral button of the pair,
          adding a route is the blue "forward" action. */}
      {adminMode && (
        <div ref={controlsRef} className="flex w-full max-w-md shrink-0 items-center gap-3">
          <button
            type="button"
            onClick={onToggleAdminMode}
            className="btn-glossy-light font-heading flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-zinc-300 py-3 text-lg font-semibold text-zinc-900"
          >
            <BackArrowIcon className="h-5 w-5" />
            Exit Edit Mode
          </button>
          <button
            type="button"
            onClick={onAddRoute}
            className="btn-glossy-blue font-heading flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-blue-600 py-3 text-lg font-semibold text-white"
          >
            <PlusIcon className="h-5 w-5" />
            New Route
          </button>
        </div>
      )}

      <a
        href="mailto:nathan@pizar.net"
        className="flex shrink-0 items-center gap-1 text-xs text-zinc-400 active:text-zinc-600"
      >
        © 2026 Nathan D. B. Pizar
        <MailIcon className="h-3 w-3" />
      </a>

      {confirmRequest && (
        <ConfirmModal
          title={
            confirmRequest.routes.length === 1
              ? confirmRequest.type === "delete"
                ? `Delete Route ${confirmRequest.routes[0].routeNumber}?`
                : confirmRequest.type === "publish"
                  ? `Publish Route ${confirmRequest.routes[0].routeNumber}?`
                  : `Unpublish Route ${confirmRequest.routes[0].routeNumber}?`
              : confirmRequest.type === "delete"
                ? `Delete ${confirmRequest.routes.length} routes?`
                : confirmRequest.type === "publish"
                  ? `Publish ${confirmRequest.routes.length} routes?`
                  : `Unpublish ${confirmRequest.routes.length} routes?`
          }
          message={
            confirmRequest.type === "delete"
              ? "This removes " +
                (confirmRequest.routes.length === 1 ? "it" : "them") +
                " for the rest of this session and can't be undone."
              : confirmRequest.type === "publish"
                ? "Drivers will see " +
                  (confirmRequest.routes.length === 1 ? "this route" : "these routes") +
                  " as soon as " +
                  (confirmRequest.routes.length === 1 ? "it's" : "they're") +
                  " published."
                : "Drivers will no longer see " +
                  (confirmRequest.routes.length === 1 ? "this route" : "these routes") +
                  " until " +
                  (confirmRequest.routes.length === 1 ? "it's" : "they're") +
                  " published again."
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
              confirmRequest.routes.forEach(onDeleteRoute);
            } else {
              const status = confirmRequest.type === "publish" ? "published" : "draft";
              confirmRequest.routes.forEach((route) => onSetRouteStatus(route, status));
            }
            setSelectedIds(new Set());
            setConfirmRequest(null);
          }}
        />
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

// SortableHeader itself now lives in ./SortableHeader.tsx (shared with
// SchoolListScreen's own table) - every header in the route list's
// header row is `align="center"`, labels read centered in their own
// cell regardless of how that column's own data below is aligned
// (Start's data is right-aligned, say).
