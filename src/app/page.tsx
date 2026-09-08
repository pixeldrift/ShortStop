"use client";

import { useEffect, useMemo, useState } from "react";
import { EditRouteScreen } from "@/components/EditRouteScreen";
import { Logo } from "@/components/Logo";
import { RouteListScreen } from "@/components/RouteListScreen";
import { SchoolListScreen } from "@/components/SchoolListScreen";
import { ScreenTransition } from "@/components/ScreenTransition";
import { StartScreen } from "@/components/StartScreen";
import { StepScreen } from "@/components/StepScreen";
import { buildDemoRoutes } from "@/lib/demoRoutes";
import { parseRouteCsv } from "@/lib/parseRouteCsv";
import type { RouteMeta } from "@/lib/parseRouteCsv";
import { parseRouteMasterList } from "@/lib/parseRouteMasterList";
import { parseSchoolsCsv } from "@/lib/parseSchoolsCsv";
import type { SchoolInfo } from "@/lib/parseSchoolsCsv";
import {
  FAVORITE_ROUTE_IDS,
  PLACEHOLDER_DISTANCE,
  PLACEHOLDER_DRIVER_NAME,
  SCHOOL_ADDRESS_NOT_YET_PROVIDED,
} from "@/lib/placeholderMeta";
import { parseTimeToMinutes } from "@/lib/time";
import { useRiderRoster } from "@/lib/useRiderRoster";
import { useRouteStepper } from "@/lib/useRouteStepper";
import type { Route, RouteStatus } from "@/lib/types";
import type { WaypointCache } from "@/lib/waypointCache";

// How many fabricated routes to add to the real ones, purely so the
// route-list screen has enough rows to actually demonstrate scrolling
// and search filtering - see demoRoutes.ts.
const DEMO_ROUTE_COUNT = 24;

async function fetchText(path: string): Promise<string> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${path}`);
  return res.text();
}

/** Fetches one route's own turn-by-turn steps sheet from Postgres (see
 * src/app/api/routes/[id]/steps) - null for a master-list row with no
 * steps sheet committed yet (e.g. 120-PM-HS, whose sheet came in
 * visibly incomplete, cutting off mid-neighborhood, so the master list
 * marks it "draft"), same skip-not-crash handling the old hardcoded
 * ROUTE_STEPS_CSV_PATHS file map gave a missing entry. */
async function fetchStepsText(routeId: string): Promise<string | null> {
  const res = await fetch(`/api/routes/${routeId}/steps`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for /api/routes/${routeId}/steps`);
  return res.text();
}

/** Which screen is showing, replacing a plain `selectedRoute: Route |
 * null` now that there's more than one non-list screen to be on.
 * "trip" is the existing StartScreen/StepScreen flow for actually
 * running a route; "add-route"/"edit-route" are the admin-only
 * EditRouteScreen, reached via RouteListScreen's "New Route" link
 * (edit mode only), tapping a draft route's row in edit mode,
 * StartScreen's "Edit Route" link, or a "Publish" attempt that turns
 * out not to be ready yet (see RouteListScreen.tsx). */
type Screen =
  | { kind: "list" }
  | {
      kind: "trip";
      route: Route;
      /** True only for the automatic hand-off from a finished route
       * into its own linked Route.nextRouteId (see RouteApp's own
       * onArrived below) - skips straight into this route's directions
       * (RouteApp calls start() itself the moment it mounts) instead of
       * landing on its StartScreen the way every other "trip" navigation
       * still does, matching "you get those directions automatically,
       * without pulling the route up separately." */
      autoStart?: boolean;
    }
  | { kind: "add-route" }
  | { kind: "edit-route"; route: Route }
  | { kind: "schools" }
  | { kind: "school-routes"; schoolName: string };

/** ScreenTransition's own `screenKey` for a given Screen - identifies
 * not just which kind of screen this is but which route it's for, so
 * e.g. opening a *different* route's trip/edit screen while already on
 * one still triggers a real transition (Home's own `key` props on
 * EditRouteScreen already rely on this same route-scoped identity, for
 * the same "actually a different screen" reason). */
function screenKey(screen: Screen): string {
  switch (screen.kind) {
    case "list":
      return "list";
    case "trip":
      return `trip:${screen.route.id}`;
    case "add-route":
      return "add-route";
    case "edit-route":
      return `edit-route:${screen.route.id}`;
    case "schools":
      return "schools";
    case "school-routes":
      return `school-routes:${screen.schoolName}`;
  }
}

export default function Home() {
  // null while the master list + every loadable route's steps sheet
  // are still loading; an empty array is a real (if unexpected) "loaded
  // but nothing came back" result, kept distinct from still-loading so
  // the spinner doesn't hang forever on that edge case.
  const [realRoutes, setRealRoutes] = useState<Route[] | null>(null);
  // True for the one moment realRoutes first finishes loading - lets
  // the top-level route list's own heading/table slide up into place
  // under the already-visible logo (see globals.css's own
  // animate-list-content-enter) instead of just snapping into view.
  // Flips back to false shortly after (matching that animation's own
  // duration) so it never replays on a later visit to the list.
  const [justLoaded, setJustLoaded] = useState(false);
  // Each loaded real route's own source steps text, alongside the
  // parsed Route itself - EditRouteScreen needs the raw text to
  // pre-fill its textarea, not just the already-derived NavigationSteps.
  const [rawStepsById, setRawStepsById] = useState<Record<string, string>>({});
  const [schools, setSchools] = useState<Record<string, SchoolInfo>>({});
  const [error, setError] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>({ kind: "list" });
  // Every screen `navigate` has dived forward through, oldest first -
  // what makes goBack (below) a *true* back button rather than each
  // screen's own onBack hardcoding a fixed parent. That hardcoding
  // used to be fine (every screen had exactly one way in), but broke
  // the moment a screen became reachable from more than one place -
  // e.g. school-routes, reachable both from the Schools list and now
  // from a route's own info screen (StartScreen's onViewSchool):
  // hardcoding "back always goes to Schools" is simply wrong from the
  // second entry point. goBack instead returns to whatever's actually
  // on top of this stack, regardless of how the current screen was
  // reached.
  const [, setHistory] = useState<Screen[]>([]);
  // Which way ScreenTransition should animate the *next* time `screen`
  // actually changes - "forward" (out left/in right) for every dive
  // deeper into the app, "backward" (the reverse) for every Cancel/Back
  // that returns to wherever that dive started. Set alongside `screen`
  // itself, always in the same state update, so ScreenTransition never
  // sees a direction that doesn't match the transition it's actually
  // mid-triggering.
  const [navDirection, setNavDirection] = useState<"forward" | "backward">("forward");

  // Dives deeper into the app - pushes the current screen onto history
  // so goBack (below) can return to it later, then switches to `next`.
  function navigate(next: Screen) {
    setNavDirection("forward");
    setHistory((prev) => [...prev, screen]);
    setScreen(next);
    // Every "trip" screen starts on StartScreen, never mid-drive, *except*
    // an autoStart hand-off from a just-finished route's own
    // Route.nextRouteId (RouteApp calls start() itself the instant it
    // mounts for one of those) - matching that here too, rather than
    // waiting on RouteApp's own onStartedChange mirror (a plain effect)
    // to catch up, so showsPinnedLogo below never reads a stale value
    // left over from whatever trip was open last, not even for the one
    // frame that'd otherwise be visible.
    if (next.kind === "trip") setTripStarted(Boolean(next.autoStart));
  }

  // The one true "Back"/"Cancel" - pops whatever screen is actually on
  // top of `history` rather than a hardcoded destination. `history`
  // should never genuinely be empty here (the top-level list is the
  // only screen with no way to reach this at all, and it's always
  // pushed before anything deeper is), but a no-op if it somehow is
  // beats crashing on a screen that isn't there.
  function goBack() {
    setNavDirection("backward");
    setHistory((prev) => {
      if (prev.length === 0) return prev;
      setScreen(prev[prev.length - 1]);
      return prev.slice(0, -1);
    });
  }

  // Re-navigates to a screen the user is conceptually already on, for
  // handleSaveRoute's own remount-forcing trick (EditRouteScreen's key
  // prop needs a real prop change to re-seed its state after a route's
  // just been created/saved) - a real `navigate` would push a phantom
  // history entry for a screen that isn't a genuine new place the user
  // went, breaking goBack (Cancel would land back on that phantom
  // add-route/edit-route hop instead of wherever the edit session
  // actually started from).
  function replaceScreen(next: Screen) {
    setNavDirection("forward");
    setScreen(next);
  }

  // Mirrors RouteApp's own internal (useRouteStepper) `started` flag -
  // page.tsx doesn't otherwise know or care whether a "trip" screen is
  // showing StartScreen or StepScreen, but it needs exactly this one
  // bit to decide whether the pinned logo below still applies (see
  // showsPinnedLogo) - StepScreen has its own compact header instead,
  // the one arrangement among every screen here that doesn't want it.
  const [tripStarted, setTripStarted] = useState(false);

  // Every screen kind but "trip" always wants the pinned logo; "trip"
  // does too, but only for its own StartScreen (before tripStarted).
  const showsPinnedLogo = screen.kind !== "trip" || !tripStarted;

  // Session-only admin edits/new routes, keyed by route id - overlaid
  // on top of whatever realRoutes loaded from the committed CSVs (see
  // effectiveRoutes below). Not persisted anywhere real yet: a page
  // reload loses it, same known-gap honesty this app already applies
  // to rider check-in state (see useRiderRoster.ts) - see
  // EditRouteScreen's own doc comment for why saving here can't write
  // back to real files yet.
  const [adminRoutes, setAdminRoutes] = useState<Record<string, Route>>({});
  const [adminRawStepsById, setAdminRawStepsById] = useState<Record<string, string>>({});
  // This session's own fetched-coordinates overlay per route id, from
  // EditRouteScreen's "Fetch Location"/"Fetch All Locations" - kept
  // alongside adminRoutes so a route made ready this session (but
  // never committed to a real sidecar file) is still recognized as
  // ready by both the list's own readiness check and a later re-open
  // of the same route's edit screen (see EditRouteScreen's
  // initialWaypointCache prop).
  const [adminWaypointCaches, setAdminWaypointCaches] = useState<Record<string, WaypointCache>>({});
  // Deleted this session (see RouteListScreen's "Delete" action, and
  // its own confirm modal) - filtered out of every screen below,
  // whether the route came from a real committed CSV or was itself
  // only ever an admin draft. Same session-only honesty as the rest of
  // this admin store: nothing is actually removed from any real file.
  const [deletedRouteIds, setDeletedRouteIds] = useState<ReadonlySet<string>>(new Set());
  // The route list's own heart toggle (RouteListScreen) - a separate
  // overlay from adminRoutes since it needs to apply to fabricated demo
  // routes too, not just real ones, and demo routes aren't in that map
  // at all (buildDemoRoutes fabricates them fresh every time `routes`
  // below recomputes). Same session-only honesty as everything else
  // here - nothing about a favorite is written back anywhere real.
  const [favoriteOverrides, setFavoriteOverrides] = useState<Record<string, boolean>>({});
  // A fabricated demo route's own Publish/Unpublish toggle - never
  // written into `adminRoutes`/`route.status` itself, since every piece
  // of "is this route fake" logic elsewhere (favorites' own real-first
  // sort, RouteListScreen's row click, buildDemoRoutes regenerating the
  // exact same fabricated routes every render) depends on `status`
  // staying literally "demo" forever. This is purely a display-time
  // overlay (RouteListScreen derives `isPublished` from it) - a demo
  // route's id living here means "treat it as unpublished this
  // session," nothing about the route object itself ever changes.
  const [demoHiddenIds, setDemoHiddenIds] = useState<ReadonlySet<string>>(new Set());
  // Toggled by RouteListScreen's own "Edit Mode" link, or turned on
  // unconditionally by a route's "Edit Route" link on StartScreen -
  // reveals draft real routes on the list, dimmed, and the per-row
  // publish/unpublish/delete controls alongside them.
  const [adminMode, setAdminMode] = useState(false);

  useEffect(() => {
    Promise.all([fetchText("/api/route-master-list"), fetchText("/api/schools")])
      .then(async ([masterListCsv, schoolsCsv]) => {
        const allRows = parseRouteMasterList(masterListCsv);
        const schoolsTable = parseSchoolsCsv(schoolsCsv);
        setSchools(schoolsTable);

        const built = await Promise.all(
          allRows.map(async (row) => {
            // A row with no computable duration (blank end_time) means
            // the master list hasn't recorded when this route ends yet
            // - a data problem worth surfacing rather than silently
            // showing a fake "0 min" trip, whatever its status.
            if (row.durationMinutes == null) {
              console.warn(`Route ${row.id} has no end_time in the master list - skipped`);
              return null;
            }

            const stepsCsv = await fetchStepsText(row.id);
            if (!stepsCsv) return null;

            const meta: RouteMeta = {
              ...row,
              durationMinutes: row.durationMinutes,
              driverName: PLACEHOLDER_DRIVER_NAME,
              schoolAddress: schoolsTable[row.schoolName]?.address ?? SCHOOL_ADDRESS_NOT_YET_PROVIDED,
              schoolLat: schoolsTable[row.schoolName]?.lat ?? null,
              schoolLon: schoolsTable[row.schoolName]?.lon ?? null,
              distance: PLACEHOLDER_DISTANCE,
              isFavorite: FAVORITE_ROUTE_IDS.has(row.id),
            };
            return { route: parseRouteCsv(stepsCsv, meta), rawStepsText: stepsCsv };
          }),
        );

        const loaded = built.filter((r): r is { route: Route; rawStepsText: string } => r !== null);
        setRealRoutes(loaded.map((l) => l.route));
        setRawStepsById(Object.fromEntries(loaded.map((l) => [l.route.id, l.rawStepsText])));
        setJustLoaded(true);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  // Clears justLoaded shortly after it's set - long enough for
  // animate-list-content-enter (0.4s) to actually finish playing, so
  // the class comes off only once it's no longer needed rather than
  // mid-animation.
  useEffect(() => {
    if (!justLoaded) return;
    const timer = setTimeout(() => setJustLoaded(false), 500);
    return () => clearTimeout(timer);
  }, [justLoaded]);

  // realRoutes overlaid with any session-only admin edits/new routes -
  // an edited real route's admin version wins outright (steps, status,
  // everything), and a brand-new route (an id realRoutes never had) is
  // simply added - with anything deleted this session filtered back
  // out again regardless of which of those two groups it came from.
  const effectiveRealRoutes = useMemo(() => {
    if (!realRoutes) return null;
    const byId = new Map(realRoutes.map((r) => [r.id, r]));
    for (const [id, route] of Object.entries(adminRoutes)) byId.set(id, route);
    for (const id of deletedRouteIds) byId.delete(id);
    return Array.from(byId.values());
  }, [realRoutes, adminRoutes, deletedRouteIds]);

  // buildDemoRoutes fabricates the rest purely so the list has enough
  // rows to demonstrate scrolling/search. Computed once per fetched
  // batch of real routes (not on every render) via useMemo, so the
  // list doesn't reshuffle each time the user navigates back to it.
  const routes = useMemo(() => {
    if (!effectiveRealRoutes || effectiveRealRoutes.length === 0) return effectiveRealRoutes ?? [];
    const combined = [...effectiveRealRoutes, ...buildDemoRoutes(effectiveRealRoutes, DEMO_ROUTE_COUNT)];
    return combined
      // Real deletions are already gone via effectiveRealRoutes above -
      // this second pass is what actually removes a deleted *demo* row,
      // since buildDemoRoutes fabricates the same ones fresh every time
      // (deterministically, so this doesn't reshuffle anything else).
      .filter((route) => !deletedRouteIds.has(route.id))
      .map((route) =>
        route.id in favoriteOverrides ? { ...route, isFavorite: favoriteOverrides[route.id] } : route,
      )
      .sort((a, b) => parseTimeToMinutes(a.departureTime) - parseTimeToMinutes(b.departureTime));
  }, [effectiveRealRoutes, favoriteOverrides, deletedRouteIds]);

  function handleToggleFavorite(route: Route) {
    setFavoriteOverrides((prev) => ({ ...prev, [route.id]: !route.isFavorite }));
  }

  function handleSaveRoute(route: Route, rawStepsText: string, waypointCache: WaypointCache) {
    // A demo route (see demoRoutes.ts) is fabricated filler, not a real
    // entity of its own - folding it into adminRoutes here would merge
    // it into effectiveRealRoutes below (double-counting it, since
    // buildDemoRoutes keeps generating its own fresh 24 regardless) and
    // could even reshuffle every other demo row's own generated number
    // (buildDemoRoutes' routeNumber draws depend on which numbers are
    // already taken). Its edit screen is for review only - nothing
    // typed or saved there actually persists.
    if (route.status === "demo") {
      goBack();
      return;
    }
    setAdminRoutes((prev) => ({ ...prev, [route.id]: route }));
    setAdminRawStepsById((prev) => ({ ...prev, [route.id]: rawStepsText }));
    setAdminWaypointCaches((prev) => ({ ...prev, [route.id]: waypointCache }));
    replaceScreen({ kind: "edit-route", route });
  }

  // A demo route's own "status" is a fixed identity marker, not a real
  // lifecycle value (see demoHiddenIds above) - publishing/unpublishing
  // one only ever toggles that separate overlay, never adminRoutes.
  function handleSetRouteStatus(route: Route, status: RouteStatus) {
    if (route.status === "demo") {
      setDemoHiddenIds((prev) => {
        const next = new Set(prev);
        if (status === "published") next.delete(route.id);
        else next.add(route.id);
        return next;
      });
      return;
    }
    setAdminRoutes((prev) => ({ ...prev, [route.id]: { ...route, status } }));
  }

  function handleDeleteRoute(route: Route) {
    setDeletedRouteIds((prev) => new Set(prev).add(route.id));
    setAdminRoutes((prev) => {
      const next = { ...prev };
      delete next[route.id];
      return next;
    });
  }

  // RouteApp's own hand-off the moment a route reaches "arrived" -
  // Route.nextRouteId (EditRouteScreen's "Next Action" field) is what
  // actually decides whether anything happens: no id set, or one that
  // no longer resolves against `routes` (a deleted/renamed route),
  // just does nothing here and leaves the normal manual "End" flow in
  // place. A real match navigates straight into that route's own
  // directions (autoStart) instead of ending the trip - "you get those
  // directions automatically, without pulling the route up separately."
  function handleRouteArrived(route: Route) {
    if (!route.nextRouteId) return;
    const nextRoute = routes.find((r) => r.id === route.nextRouteId);
    if (nextRoute) navigate({ kind: "trip", route: nextRoute, autoStart: true });
  }

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-center text-red-500">
        Couldn&apos;t load route data: {error}
      </div>
    );
  }

  if (!realRoutes) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-zinc-500">
        <Logo size="large" />
        Loading routes…
      </div>
    );
  }

  // Rather than each branch returning straight away, every screen's
  // own element is built into `content` first and returned once at the
  // bottom wrapped in ScreenTransition - `navigate` above is what
  // actually decides *which way* that wrapper animates a given change,
  // matched to whichever branch is doing the navigating below.
  let content: React.ReactNode;

  if (screen.kind === "add-route") {
    content = (
      <EditRouteScreen
        // Forces a fresh mount when handleSaveRoute switches straight
        // from this add screen into editing the just-created route
        // below - without a key, React sees the same <EditRouteScreen>
        // element at the same position and reuses the instance, so its
        // `rows` state (lazily seeded from rawStepsText once on mount)
        // would never re-seed with the route just saved.
        key="add"
        mode="add"
        route={null}
        routes={routes}
        rawStepsText=""
        schools={schools}
        onCancel={goBack}
        onSave={handleSaveRoute}
      />
    );
  } else if (screen.kind === "edit-route") {
    // A demo route (see demoRoutes.ts) never has its own real committed
    // steps sheet - it borrows realRoutes[0]'s exact steps as its base,
    // so its edit screen borrows that same route's raw CSV text too,
    // rather than opening to a stops list that looks empty next to the
    // (borrowed) steps it already shows when actually run as a trip.
    const rawStepsText =
      adminRawStepsById[screen.route.id] ??
      rawStepsById[screen.route.id] ??
      (screen.route.status === "demo" ? (rawStepsById[realRoutes[0]?.id ?? ""] ?? "") : "");
    content = (
      <EditRouteScreen
        key={`edit-${screen.route.id}`}
        mode="edit"
        route={screen.route}
        routes={routes}
        rawStepsText={rawStepsText}
        initialWaypointCache={adminWaypointCaches[screen.route.id]}
        schools={schools}
        onCancel={goBack}
        onSave={handleSaveRoute}
      />
    );
  } else if (screen.kind === "trip") {
    content = (
      <RouteApp
        route={screen.route}
        autoStart={screen.autoStart}
        onBack={goBack}
        onEdit={() => {
          setAdminMode(true);
          navigate({ kind: "edit-route", route: screen.route });
        }}
        onStartedChange={setTripStarted}
        onViewSchool={(schoolName) => navigate({ kind: "school-routes", schoolName })}
        onArrived={handleRouteArrived}
      />
    );
  } else if (screen.kind === "schools") {
    content = (
      <SchoolListScreen
        schools={schools}
        routes={routes}
        onSelectSchool={(schoolName) => navigate({ kind: "school-routes", schoolName })}
        onBack={goBack}
      />
    );
  } else if (screen.kind === "school-routes") {
    content = (
      <RouteListScreen
        routes={routes.filter((route) => route.schoolName === screen.schoolName)}
        title={screen.schoolName}
        onBack={goBack}
        adminMode={adminMode}
        adminWaypointCaches={adminWaypointCaches}
        onToggleAdminMode={() => setAdminMode((prev) => !prev)}
        onSelect={(route) => navigate({ kind: "trip", route })}
        onEditRoute={(route) => navigate({ kind: "edit-route", route })}
        onAddRoute={() => navigate({ kind: "add-route" })}
        onSetRouteStatus={handleSetRouteStatus}
        onDeleteRoute={handleDeleteRoute}
        onToggleFavorite={handleToggleFavorite}
        demoHiddenIds={demoHiddenIds}
      />
    );
  } else {
    content = (
      <RouteListScreen
        routes={routes}
        slideInOnMount={justLoaded}
        onViewSchools={() => navigate({ kind: "schools" })}
        adminMode={adminMode}
        adminWaypointCaches={adminWaypointCaches}
        onToggleAdminMode={() => setAdminMode((prev) => !prev)}
        onSelect={(route) => navigate({ kind: "trip", route })}
        onEditRoute={(route) => navigate({ kind: "edit-route", route })}
        onAddRoute={() => navigate({ kind: "add-route" })}
        onSetRouteStatus={handleSetRouteStatus}
        onDeleteRoute={handleDeleteRoute}
        onToggleFavorite={handleToggleFavorite}
        demoHiddenIds={demoHiddenIds}
      />
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Rendered once here, outside ScreenTransition entirely, rather
          than by each screen component itself (RouteListScreen,
          SchoolListScreen, StartScreen, EditRouteScreen used to each
          render their own) - every one of those shares this exact same
          logo/position, so keeping one persistent instance means it
          never re-mounts or moves as part of a screen-to-screen push;
          it only ever appears/disappears outright, and only when
          crossing into/out of the one arrangement that doesn't have it
          (StepScreen, via showsPinnedLogo above). A minimal top inset
          (pt-2/landscape:pt-1) - trimmed down again from pt-4/pt-3, the
          logo doesn't need much breathing room above it at all, and
          reclaiming that space leaves more of the viewport for the
          actual content below - plus a pb-4 standing in for the gap-4
          that used to separate it from what's now each screen's own
          first child. */}
      {showsPinnedLogo && (
        <div className="flex shrink-0 justify-center px-6 pt-2 pb-4 landscape:pt-1">
          <Logo size="large" />
        </div>
      )}
      <ScreenTransition screenKey={screenKey(screen)} direction={navDirection}>
        {content}
      </ScreenTransition>
    </div>
  );
}

function RouteApp({
  route,
  autoStart,
  onBack,
  onEdit,
  onStartedChange,
  onViewSchool,
  onArrived,
}: {
  route: Route;
  /** True only for the automatic hand-off from a finished route into
   * this one (see the Screen type's own doc comment, page.tsx) - calls
   * start() itself the instant this mounts, skipping past StartScreen
   * straight into this route's own directions the same way a driver
   * tapping "Start Route" normally would. */
  autoStart?: boolean;
  onBack: () => void;
  onEdit: () => void;
  /** Reports RouteApp's own internal started flag (useRouteStepper) up
   * to page.tsx, purely so it knows whether to keep showing the pinned
   * logo (see showsPinnedLogo there) - RouteApp itself still owns
   * `started` outright, this is a one-way mirror, not a hand-off. */
  onStartedChange: (started: boolean) => void;
  /** Passed straight through to StartScreen - opens the school's own
   * school-routes screen (see page.tsx's own navigate call below). */
  onViewSchool: (schoolName: string) => void;
  /** Fires once this route reaches its own "arrived" phase - page.tsx
   * decides what that actually means (nothing, if this route has no
   * Route.nextRouteId, or an autoStart navigation into whichever route
   * that id names, if page.tsx's own `routes` still has one under it). */
  onArrived: (route: Route) => void;
}) {
  const {
    currentStep,
    currentIndex,
    phase,
    totalStops,
    currentStopNumber,
    stopProgressNumber,
    started,
    start,
    advance,
    goBack,
    jumpTo,
    paused,
    togglePause,
    endRoute,
    exitTrip,
    announcementDone,
  } = useRouteStepper(route);

  useEffect(() => {
    onStartedChange(started);
  }, [started, onStartedChange]);

  useEffect(() => {
    if (autoStart) start();
    // Only ever meant to fire once, right as this route's own RouteApp
    // instance mounts (autoStart is fixed for this instance's whole
    // lifetime - a real change means page.tsx navigated to a genuinely
    // different route, which remounts this component fresh anyway, see
    // page.tsx's own screenKey) - deliberately not depending on `start`
    // itself (a useRouteStepper useCallback that's already stable
    // across renders in practice) to keep that "once" guarantee explicit
    // rather than relying on referential stability.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // This route's own hand-off, the moment it's actually reached - see
  // this component's own onArrived prop doc comment for what page.tsx
  // does with it.
  useEffect(() => {
    if (phase === "arrived") onArrived(route);
  }, [phase, route, onArrived]);

  const { getRoster, fillTo, addUnexpectedRider, totalOnboard } = useRiderRoster();

  const expectedCount = phase === "step" ? (currentStep.studentCount ?? 0) : 0;

  // Same forward/backward push as page.tsx's own top-level screens
  // (List <-> Add/Edit Route/trip), applied "universally" to this
  // local start/step switch too - tapping "Start Route" always flips
  // `started` false->true (forward), and the only way back to false is
  // "Exit Route" (StepScreen's own "End" at the arrived phase, via
  // endRoute/resetTrip below) - never the other way around - so the
  // direction always follows `started` itself, no separate state
  // needed to track which way this particular flip just went.
  const content = !started ? (
    <StartScreen route={route} onStart={start} onBack={onBack} onEdit={onEdit} onViewSchool={onViewSchool} />
  ) : (
    <StepScreen
      route={route}
      step={currentStep}
      stepNumber={currentIndex + 1}
      stopNumber={currentStopNumber}
      stopProgressNumber={stopProgressNumber}
      totalStops={totalStops}
      phase={phase}
      paused={paused}
      onAdvance={advance}
      onBack={goBack}
      onSeek={jumpTo}
      onTogglePause={togglePause}
      onEndRoute={endRoute}
      onLogoClick={() => {
        exitTrip();
        onBack();
      }}
      announcementDone={announcementDone}
      roster={getRoster(currentStep.id, expectedCount)}
      totalOnboard={totalOnboard}
      onRiderTap={(index) => fillTo(currentStep.id, index, expectedCount)}
      onAddRider={() => addUnexpectedRider(currentStep.id, expectedCount)}
    />
  );

  return (
    <ScreenTransition screenKey={started ? "step" : "start"} direction={started ? "forward" : "backward"}>
      {content}
    </ScreenTransition>
  );
}
