"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ConfirmModal } from "./ConfirmModal";
import { TripTypeIcon } from "./TripTypeIcon";
import {
  BackArrowIcon,
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
  TrashIcon,
} from "./icons";
import { downloadCsv, routeListToCsv } from "@/lib/exportCsv";
import { fetchCommittedWaypointCache, isRouteFullyResolved } from "@/lib/routeReadiness";
import { parseTimeToMinutes } from "@/lib/time";
import { tripTypeLabel, TRIP_TYPE_ORDER } from "@/lib/tripType";
import type { Route, RouteStatus, SchoolLevel, TripType } from "@/lib/types";
import type { WaypointCache } from "@/lib/waypointCache";
import { SortableHeader } from "./SortableHeader";
import type { SortDir } from "./SortableHeader";

/** A pending confirm-modal request - which action, on which route.
 * Rendered as a single shared ConfirmModal below rather than one
 * inline per row, so at most one is ever open at a time. Every action
 * here is single-route now that the eyeball icon replaced the
 * checkbox/bulk-select toolbar: "deactivate" is the one-button
 * published->draft confirm, "draft-options" is the Delete/Activate
 * pair offered for a route that's already draft. */
type ConfirmRequest =
  | { type: "deactivate"; route: Route }
  | { type: "draft-options"; route: Route };

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
  tripType: (a, b) => TRIP_TYPE_ORDER.indexOf(a.tripType) - TRIP_TYPE_ORDER.indexOf(b.tripType),
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
  { value: "fieldtrip", label: "SP" },
  // "other" has no toggle of its own for now - dropped rather than
  // grown the column past the three rows the mockup's own AM/PM/SP
  // group shows (see the school-level group right beside it, same
  // three-tall shape). An "other" route still shows up fine (an empty
  // active set means "show everything"), it just can't be isolated by
  // this toggle group the way the other three trip types can yet.
];
const SCHOOL_LEVEL_TOGGLES: { value: SchoolLevel; label: string }[] = [
  { value: "elementary", label: "ES" },
  { value: "middle", label: "MS" },
  { value: "high", label: "HS" },
];
// Admin-mode only (see its own row below) - a normal driver's view
// already excludes unpublished routes outright, so filtering by
// published/hidden would have nothing to do there.
const PUBLISH_STATUS_TOGGLES: { value: "published" | "hidden"; label: string }[] = [
  { value: "published", label: "Pub" },
  { value: "hidden", label: "Hid" },
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
   * cache before deciding whether activating is actually allowed
   * (handleEyeClick below), so a route made ready via EditRouteScreen's
   * "Fetch Location"/"Fetch All Locations" this session is recognized
   * as ready here too. */
  adminWaypointCaches: Record<string, WaypointCache>;
  onToggleAdminMode: () => void;
  /** Normal navigation - the trip-summary/step flow. Every row's own
   * main tap target outside admin mode - once admin mode is on, the
   * row instead opens EditRouteScreen directly (see the row rendering
   * below), so this never fires while adminMode is true. */
  onSelect: (route: Route) => void;
  /** Opens EditRouteScreen directly for this route - fired by tapping
   * a row's own body in admin mode, or by an eyeball-icon tap on a
   * draft route that turns out not to be ready to activate yet (see
   * handleEyeClick). */
  onEditRoute: (route: Route) => void;
  onAddRoute: () => void;
  onSetRouteStatus: (route: Route, status: RouteStatus) => void;
  onDeleteRoute: (route: Route) => void;
  /** Toggles a route's own favorite heart - independent of the row's
   * main click (onSelect), which only ever navigates; see the row
   * rendering below for how the heart gets its own tap target (the
   * eyeball status toggle takes its place there instead, in admin
   * mode). */
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
  // Only set while handleActivateFromModal's own readiness check is
  // in flight - not surfaced as a spinner anywhere yet, just prevents a
  // second tap on the same row from firing a second check.
  const [checkingRouteId, setCheckingRouteId] = useState<string | null>(null);
  // Every toggle starts off - see TRIP_TYPE_TOGGLES/SCHOOL_LEVEL_TOGGLES
  // above for why an empty set is the "show everything" state here.
  const [activeTripTypes, setActiveTripTypes] = useState<ReadonlySet<TripType>>(() => new Set());
  const [activeSchoolLevels, setActiveSchoolLevels] = useState<ReadonlySet<SchoolLevel>>(() => new Set());
  const [activePublishStatuses, setActivePublishStatuses] = useState<ReadonlySet<"published" | "hidden">>(
    () => new Set(),
  );
  // The fabricated filler rows (buildDemoRoutes, page.tsx) - on by
  // default, matching how this list always looked before this toggle
  // existed. Off just hides them from view here; page.tsx keeps
  // generating the same 24 regardless (nothing else - the school list's
  // own route counts, a school-scoped reuse of this same screen -
  // should look different just because this one screen's own toggle is
  // off).
  const [showDemoData, setShowDemoData] = useState(true);
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
  function togglePublishStatus(value: "published" | "hidden") {
    setActivePublishStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
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
  // Route" controls themselves - both live in these refs, specifically
  // excluded so this effect never double-fires alongside their own
  // click handler (Exit Edit Mode, New Route which needs adminMode to
  // stay on across the navigation it triggers).
  const boxRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  // The Schools/Hide Demo Data/Download routes row - its own ref,
  // always attached regardless of adminMode, since (unlike
  // controlsRef's own two rows, which are mutually exclusive by
  // adminMode) this row and controlsRef's admin-mode row can both be on
  // screen at once. It used to share controlsRef itself (attached only
  // while !adminMode, on the theory that the admin-mode row below took
  // over that same ref once it appeared) - which left this exact row
  // with no ref at all once actually in admin mode, so clicking "Hide
  // Demo Data" or "Download routes" read as a click *outside* every
  // exempted area and exited admin mode instead of doing what it says.
  const secondaryControlsRef = useRef<HTMLDivElement>(null);

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
      if (secondaryControlsRef.current?.contains(target)) return;
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
      // "Show Demo Data" off - the fabricated filler rows disappear
      // outright, regardless of anything else below (published status,
      // search text, other toggles).
      if (!showDemoData && route.status === "demo") return false;

      // A route that doesn't currently read as published only ever
      // shows up in admin mode - a normal driver never needs to see a
      // route nobody's actually running, whether it's a real draft or
      // a demo row toggled unpublished this session.
      if (!isRoutePublished(route, demoHiddenIds) && !adminMode) return false;

      const matchesQuery =
        !q || route.name.toLowerCase().includes(q) || route.routeNumber.includes(q);
      const publishStatus: "published" | "hidden" = isRoutePublished(route, demoHiddenIds)
        ? "published"
        : "hidden";
      const matchesToggles =
        (activeTripTypes.size === 0 || activeTripTypes.has(route.tripType)) &&
        (activeSchoolLevels.size === 0 || activeSchoolLevels.has(route.schoolLevel)) &&
        // Only admin mode ever renders this toggle row (a normal
        // driver's view already excludes hidden routes outright above),
        // but guard on adminMode here too so a stale selection can't
        // silently filter the driver-facing list if admin mode toggles
        // off without this set happening to already be empty.
        (!adminMode || activePublishStatuses.size === 0 || activePublishStatuses.has(publishStatus));
      return matchesQuery && matchesToggles;
    });

    const compare = SORT_COMPARATORS[sortField];
    return [...matching].sort((a, b) => {
      const result = compare(a, b);
      return sortDir === "asc" ? result : -result;
    });
  }, [
    routes,
    query,
    activeTripTypes,
    activeSchoolLevels,
    activePublishStatuses,
    showDemoData,
    sortField,
    sortDir,
    adminMode,
    demoHiddenIds,
  ]);

  // The eyeball icon's own click handler - always opens the matching
  // popup immediately, published or draft, so a tap never silently
  // does something other than what tapping the eye reads as. A
  // published route gets the one-button "Deactivate" confirm (hiding
  // never needs a readiness check, see canToggleStatus's own reasoning
  // in EditRouteScreen.tsx); a draft one gets the Delete/Activate
  // popup - readiness is only checked once "Activate" is actually
  // pressed inside it (handleActivateFromModal below), not before the
  // popup can even open, which used to skip the popup entirely for a
  // not-yet-ready route and land on the edit screen with no visible
  // confirmation the eye tap had done anything at all.
  function handleEyeClick(route: Route) {
    if (isRoutePublished(route, demoHiddenIds)) {
      setConfirmRequest({ type: "deactivate", route });
    } else {
      setConfirmRequest({ type: "draft-options", route });
    }
  }

  // The draft-options popup's own "Activate" button - checks the same
  // "every geocodable stop has to actually resolve first" rule
  // EditRouteScreen.tsx enforces, against the route's own committed
  // sidecar cache merged with this session's own fetched-but-not-yet-
  // committed overlay (adminWaypointCaches). Ready: activates and
  // closes the popup. Not ready: closes the popup and goes to the edit
  // screen instead, where the real warning UI (and the Fetch/Fetch All
  // buttons that actually fix this) already lives - no separate
  // warning needed here. A demo route has no real committed sidecar
  // file of its own to check (it's fabricated), so it skips the
  // readiness check entirely and always just activates.
  async function handleActivateFromModal(route: Route) {
    if (route.status === "demo") {
      onSetRouteStatus(route, "published");
      setConfirmRequest(null);
      return;
    }
    setCheckingRouteId(route.id);
    try {
      const committed = await fetchCommittedWaypointCache();
      const merged = { ...committed, ...(adminWaypointCaches[route.id] ?? {}) };
      if (isRouteFullyResolved(route, merged)) {
        onSetRouteStatus(route, "published");
        setConfirmRequest(null);
      } else {
        setConfirmRequest(null);
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
                {/* relative/absolute rather than a flex row - the icon
                    floats off the text's own left edge (right-full) so
                    it never shifts the text itself off-center from the
                    county label above, the way sharing a centered flex
                    row with it used to. */}
                <h1 className="font-heading relative -mt-1 text-4xl leading-none font-black tracking-tight">
                  <RouteIcon className="absolute top-1/2 right-full mr-2 h-6 w-6 -translate-y-1/2 text-blue-600" />
                  Routes
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
          {/* Two (three in admin mode) grouped columns, not stacked
              rows - trip type on the left, school level next to it,
              each its own vertical stack of toggle buttons, divided by
              a plain vertical rule rather than boxed. Every toggle
              starts on/blue ("showing"); tapping one off fades it,
              excluding that trip type/level from the list below rather
              than picking a single exclusive view the old "View"
              dropdown did. Sized small enough that a full three-tall
              column sits within the search box's own height beside it,
              not taller than it - same constraint the old two-row
              layout was built around, just stacked instead of spread
              sideways now. */}
          <div className="flex shrink-0 items-stretch gap-1">
            <div className="flex flex-col gap-0.5">
              {TRIP_TYPE_TOGGLES.map((toggle) => {
                const active = activeTripTypes.has(toggle.value);
                return (
                  <button
                    key={toggle.value}
                    type="button"
                    onClick={() => toggleTripType(toggle.value)}
                    aria-pressed={active}
                    className={`px-1 text-[10px] font-bold ${active ? "text-blue-600" : "text-zinc-400"}`}
                  >
                    {toggle.label}
                  </button>
                );
              })}
            </div>
            <div className="w-px self-stretch bg-zinc-300" aria-hidden="true" />
            <div className="flex flex-col gap-0.5">
              {SCHOOL_LEVEL_TOGGLES.map((toggle) => {
                const active = activeSchoolLevels.has(toggle.value);
                return (
                  <button
                    key={toggle.value}
                    type="button"
                    onClick={() => toggleSchoolLevel(toggle.value)}
                    aria-pressed={active}
                    className={`px-1 text-[10px] font-bold ${active ? "text-blue-600" : "text-zinc-400"}`}
                  >
                    {toggle.label}
                  </button>
                );
              })}
            </div>
            {/* Published/Hidden - admin mode only, same empty-set-shows-
                everything convention as the two groups above. A normal
                driver's list already excludes hidden routes outright, so
                this toggle would have nothing to do there. */}
            {adminMode && (
              <>
                <div className="w-px self-stretch bg-zinc-300" aria-hidden="true" />
                <div className="flex flex-col gap-0.5">
                  {PUBLISH_STATUS_TOGGLES.map((toggle) => {
                    const active = activePublishStatuses.has(toggle.value);
                    return (
                      <button
                        key={toggle.value}
                        type="button"
                        onClick={() => togglePublishStatus(toggle.value)}
                        aria-pressed={active}
                        className={`px-1 text-[10px] font-bold ${active ? "text-blue-600" : "text-zinc-400"}`}
                      >
                        {toggle.label}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>

        <div
          ref={boxRef}
          className={`flex min-h-0 w-full max-w-md flex-1 flex-col overflow-hidden rounded-2xl border text-left ${
            adminMode ? "border-2 border-blue-400" : "border-zinc-300"
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
                favorite heart normally, a plain (non-interactive) eye
                glyph heading the eyeball toggle column in admin mode -
                same `justify-self-center` positioning as that button
                too, not just sitting in the same column, so this
                actually lines up with it, evenly centered in its own
                (wider than the icon itself) column rather than crowding
                the divider on its left. */}
            {adminMode ? (
              <span className="justify-self-center p-1" aria-hidden="true">
                <EyeIcon className="h-4 w-4 text-zinc-400" />
              </span>
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
              return (
                <div
                  key={route.id}
                  className={`grid w-full grid-cols-[5.75rem_1fr_3.75rem_1.75rem] items-center gap-x-1 px-2 py-3 text-left ${
                    isAdminOnly ? "opacity-50" : ""
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => (adminMode ? onEditRoute(route) : onSelect(route))}
                    className="col-span-3 grid grid-cols-[5.75rem_1fr_3.75rem] items-center gap-x-1 text-left active:bg-zinc-100"
                  >
                    {/* leading-none (line-height: 1) still isn't tight -
                        Ubuntu at this weight reports a font-box taller
                        than any digit or all-caps letter actually needs
                        (no ascenders/descenders in "120" or "AM" to make
                        room for), so a 24px line still measured 24px
                        tall around 17px of real digit ink, ~3.5px of
                        dead space above and below - same story for the
                        12px AM/PM label around its own 9px of cap-height
                        ink. leading-[0.7083]/leading-[0.75] are exactly
                        those two ratios (17/24, 9/12) - unitless so they
                        keep scaling correctly, not a magic one-off pixel
                        value - and were confirmed against the live
                        rendered box (not just canvas metrics) before
                        landing here. */}
                    {/* items-start/items-end on the outer row aligns the
                        badge's own div to the route number's own top/
                        bottom edge - but that div also has to stop
                        centering its own two children (items-center) to
                        actually deliver "flush," since the icon (h-3,
                        12px) is taller than the now-trimmed text (~9px,
                        leading-[0.75] below); items-center would leave
                        the text itself sitting short of the div's own
                        edge by half that difference even once the div
                        itself is correctly placed. Matching the same
                        start/end here instead puts the *text* flush
                        against the number, icon included, not just the
                        div loosely centered around it. */}
                    <div
                      className={`flex gap-1.5 ${
                        route.tripType === "dropoff" ? "items-start" : "items-end"
                      }`}
                    >
                      <span className="font-heading text-2xl leading-[0.7083] font-black">
                        {route.routeNumber}
                      </span>
                      <div
                        className={`flex gap-0.5 text-blue-500 ${
                          route.tripType === "dropoff" ? "items-start" : "items-end"
                        }`}
                      >
                        <span className="font-heading text-xs leading-[0.75] font-black">
                          {tripTypeLabel(route.tripType)}
                        </span>
                        <TripTypeIcon tripType={route.tripType} className="h-3 w-3" />
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
                      onClick={() => handleEyeClick(route)}
                      disabled={checkingRouteId === route.id}
                      aria-label={
                        isPublished
                          ? `Deactivate route ${route.routeNumber}`
                          : `Activate route ${route.routeNumber}`
                      }
                      className="justify-self-center p-1 text-blue-600 active:opacity-70 disabled:opacity-30"
                    >
                      {isPublished ? (
                        <EyeIcon className="h-4 w-4" />
                      ) : (
                        <EyeOffIcon className="h-4 w-4 text-zinc-400" />
                      )}
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
          ref={secondaryControlsRef}
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
          {/* Plain text, no icon (unlike Schools/Edit Routes either
              side of it) - a quieter secondary control for hiding the
              fabricated filler rows, not something that needs to
              compete with either of those for attention. Only the
              top-level list (onViewSchools) shows this at all - same
              gate as Schools itself, since the school-scoped reuse of
              this screen has nowhere for it to sit opposite. */}
          {onViewSchools && (
            <button
              type="button"
              onClick={() => setShowDemoData((prev) => !prev)}
              className="text-sm font-semibold text-blue-600 active:text-blue-800"
            >
              {showDemoData ? "Hide Demo Data" : "Show Demo Data"}
            </button>
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

      {confirmRequest?.type === "deactivate" && (
        <ConfirmModal
          title={`Deactivate Route ${confirmRequest.route.routeNumber}?`}
          message="This puts it in draft mode - drivers won't see it until it's activated again."
          confirmLabel="Deactivate"
          confirmIcon={<EyeOffIcon className="h-4 w-4" />}
          onCancel={() => setConfirmRequest(null)}
          onConfirm={() => {
            onSetRouteStatus(confirmRequest.route, "draft");
            setConfirmRequest(null);
          }}
        />
      )}
      {confirmRequest?.type === "draft-options" && (
        <ConfirmModal
          title={`Route ${confirmRequest.route.routeNumber} is in Draft`}
          message="It won't be visible to drivers until it's activated."
          confirmLabel="Activate"
          confirmIcon={<EyeIcon className="h-4 w-4" />}
          secondaryLabel="Delete"
          secondaryIcon={<TrashIcon className="h-4 w-4" />}
          onSecondary={() => {
            onDeleteRoute(confirmRequest.route);
            setConfirmRequest(null);
          }}
          onCancel={() => setConfirmRequest(null)}
          onConfirm={() => {
            void handleActivateFromModal(confirmRequest.route);
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
