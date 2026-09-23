"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { EditRouteScreen } from "@/components/EditRouteScreen";
import { Logo } from "@/components/Logo";
import { RouteListScreen } from "@/components/RouteListScreen";
import { SchoolListScreen } from "@/components/SchoolListScreen";
import { ScreenTransition } from "@/components/ScreenTransition";
import { StartScreen } from "@/components/StartScreen";
import { StepScreen } from "@/components/StepScreen";
import { UserMenu } from "@/components/UserMenu";
import { DEFAULT_CURRENT_USER } from "@/lib/currentUser";
import type { CurrentUser } from "@/lib/currentUser";
import { buildRouteFromRows } from "@/lib/parseRouteCsv";
import type { RawRouteRow, RouteMeta } from "@/lib/parseRouteCsv";
import type { MasterListRoute } from "@/lib/parseRouteMasterList";
import type { SchoolInfo } from "@/lib/parseSchoolsCsv";
import type { SavedLocationInfo } from "@/lib/savedLocations";
import {
  FAVORITE_ROUTE_IDS,
  PLACEHOLDER_DISTANCE,
  PLACEHOLDER_DRIVER_NAME,
  SCHOOL_ADDRESS_NOT_YET_PROVIDED,
} from "@/lib/placeholderMeta";
import { permissionsFor } from "@/lib/permissions";
import { parseTimeToMinutes } from "@/lib/time";
import { useRiderRoster } from "@/lib/useRiderRoster";
import { useRouteStepper } from "@/lib/useRouteStepper";
import type { Route, RouteStatus, TripType } from "@/lib/types";
import type { WaypointCache } from "@/lib/waypointCache";

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${path}`);
  return res.json();
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
      /** Set only when returning from a quick-edit detour (StepScreen's
       * own Edit/Add buttons, gated on canEditWaypoints - see the
       * "edit-route" variant's own quickEdit field below) - skips
       * StartScreen the same way autoStart does, and resumes turn-by-
       * turn at this exact step rather than back at the depot, so
       * "Saving takes us back to where we were" holds even though the
       * whole RouteApp instance (and its live useRouteStepper state)
       * was unmounted for the trip out to EditRouteScreen and back. */
      resumeAtStepIndex?: number;
    }
  | {
      kind: "add-route";
      /** Set only when reached via EditRouteScreen's own split-to-new-
       * route flow (the Stops and Turns list's own scissors icon) -
       * pre-fills the paste box with the split-off half's waypoints,
       * already in the exact text its own import parser reads
       * (EditRouteScreen's onSplitToNewRoute prop, serialized via
       * serializeRouteImport). Omitted for the ordinary "New Route"
       * link, which still opens to a blank paste box. */
      initialStepsText?: string;
      /** This route's own School/Trip, carried over as a starting
       * point for the new one - splitting off part of a route's
       * waypoints almost always means the same school and the same
       * AM/PM/Special run, just a second bus, so only a new Route #/
       * Name is actually needed before the first Save. Omitted
       * alongside initialStepsText for the ordinary "New Route" link. */
      seedMeta?: { schoolName: string; tripType: TripType | ""; routeNumber?: string };
    }
  | {
      kind: "edit-route";
      route: Route;
      /** Opens EditRouteScreen straight to its Stops and Turns screen
       * instead of the hub - see EditRouteScreen's own initialSubScreen
       * doc comment. Omitted (hub) everywhere except the View Stops
       * popup's own pencil-to-Edit-Waypoints button. */
      initialSubScreen?: "hub" | "stops";
      /** True only for the one replaceScreen handleSaveRoute itself
       * fires right after a brand-new route's first-ever Save (see its
       * own `justCreated` argument) - threaded straight through to
       * EditRouteScreen's own `justCreated` prop for its "New Route
       * Created!" confirmation. Never set by any other navigation into
       * this screen kind. */
      justCreated?: boolean;
      /** Set only for the quick-edit detour StepScreen's own Edit/Add
       * buttons take (RouteApp's onEditWaypoint below) - opens straight
       * to this one row's popup (EditRouteScreen's own quickEdit prop
       * does the rest: auto-opening it, hiding Delete/prev/next, and
       * routing Update/Cancel through handleQuickEditSaved/onCancelled
       * below instead of the ordinary hub/list). `rowIndex` doubles as
       * the NavigationStep id to resume driving at once this popup
       * closes, since quick-edit never touches any row but this one (or
       * a row freshly inserted right after it) - see EditRouteScreen's
       * own quickEdit type doc comment for why that keeps the resume
       * math correct. Omitted for every other way into this screen. */
      quickEdit?: { rowIndex: number; insertNewAfter: boolean };
    }
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
  // Each loaded real route's own source steps, alongside the parsed
  // Route itself - EditRouteScreen needs these raw rows to seed its own
  // editable row list, not just the already-derived NavigationSteps.
  const [stepsById, setStepsById] = useState<Record<string, RawRouteRow[]>>({});
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
  // on top of whatever realRoutes loaded from Postgres (see
  // effectiveRoutes below). Not persisted anywhere real yet: a page
  // reload loses it, same known-gap honesty this app already applies
  // to rider check-in state (see useRiderRoster.ts) - see
  // EditRouteScreen's own doc comment for why saving here can't write
  // back to real files yet.
  const [adminRoutes, setAdminRoutes] = useState<Record<string, Route>>({});
  const [adminStepsById, setAdminStepsById] = useState<Record<string, RawRouteRow[]>>({});
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
  // whether the route came from Postgres or was itself only ever an
  // admin draft. Same session-only honesty as the rest of this admin
  // store: nothing is actually removed from the real database.
  const [deletedRouteIds, setDeletedRouteIds] = useState<ReadonlySet<string>>(new Set());
  // The route list's own heart toggle (RouteListScreen) - a separate,
  // session-only overlay from adminRoutes; nothing about a favorite is
  // written back anywhere real.
  const [favoriteOverrides, setFavoriteOverrides] = useState<Record<string, boolean>>({});
  // Toggled by RouteListScreen's own "Edit Mode" link, or turned on
  // unconditionally by a route's "Edit Route" link on StartScreen -
  // reveals draft real routes on the list, dimmed, and the per-row
  // publish/unpublish/delete controls alongside them. Starts off - this
  // is a deliberate before/after a demo driver still wants to control,
  // not the same question as "can this person reach admin features at
  // all" (permissionsFor/canAccessAdmin below), which is a per-driver
  // permission now, not something this toggle alone ever grants - see
  // permissions.ts's own doc comment for why the two are kept separate
  // even though there's no real per-user account system backing either
  // one yet.
  const [adminMode, setAdminMode] = useState(false);
  // How far down RouteListScreen's own list a driver had scrolled,
  // keyed by which route list it was ("top-level" or a specific
  // school's own scoped one) - a plain ref, not state, since writing it
  // on every scroll tick should never itself trigger a re-render.
  // RouteListScreen fully unmounts navigating to EditRouteScreen (only
  // one `content` value is ever rendered at a time - see the big
  // screen.kind switch below), so its own scroll position would
  // otherwise reset to the top on every single return from editing a
  // route, same as every other bit of local state there already does -
  // this is the one exception, restored once by RouteListScreen's own
  // getInitialScrollTop/onScrollTopChange props (below) rather than
  // living in that component's own state, which this exact unmount
  // already defeats.
  const routeListScrollRef = useRef<Map<string, number>>(new Map());
  // The signed-in driver, this demo phase's own stand-in for a real
  // account (currentUser.ts's own doc comment has the full reasoning) -
  // UserMenu.tsx reads and edits this directly, including its own
  // `permissions` field, which is what every permissionsFor(currentUser)
  // call below actually gates on. Plain useState, not persisted -
  // refreshing the page resets back to DEFAULT_CURRENT_USER.
  const [currentUser, setCurrentUser] = useState<CurrentUser>(DEFAULT_CURRENT_USER);

  useEffect(() => {
    Promise.all([
      fetchJson<MasterListRoute[]>("/api/route-master-list"),
      fetchJson<Record<string, SchoolInfo>>("/api/schools"),
      // Every route's steps in one request/one query, not one request
      // per route (see /api/routes/steps's own doc comment for why the
      // old per-route fan-out - Promise.all(allRows.map(fetchSteps)) -
      // could leave the whole app stuck loading once enough real
      // routes existed to outrun Neon's pooled connection limit).
      fetchJson<Record<string, RawRouteRow[]>>("/api/routes/steps"),
      // A route's own anchor doesn't have to be a real school (see
      // Route.schoolLevel's own doc comment, types.ts) - a saved
      // address-book location is just as valid, so this list is
      // checked too, by name, the same "Schools first, SavedLocations
      // second" order EditRouteScreen.tsx's own matchedSchool/
      // matchedSavedLocation already use.
      fetchJson<SavedLocationInfo[]>("/api/saved-locations"),
    ])
      .then(([allRows, schoolsTable, stepsByRouteId, savedLocations]) => {
        setSchools(schoolsTable);
        const savedLocationsByName = new Map(
          savedLocations.map((loc) => [loc.name.trim().toLowerCase(), loc]),
        );

        const built = allRows.map((row) => {
          const steps = stepsByRouteId[row.id];
          if (!steps || steps.length === 0) return null;

          const school = schoolsTable[row.schoolName];
          const savedLocation = savedLocationsByName.get(
            row.schoolName.trim().toLowerCase(),
          );
          const meta: RouteMeta = {
            ...row,
            driverName: PLACEHOLDER_DRIVER_NAME,
            schoolAddress:
              school?.address ?? savedLocation?.address ?? SCHOOL_ADDRESS_NOT_YET_PROVIDED,
            schoolLat: school?.lat ?? savedLocation?.lat ?? null,
            schoolLon: school?.lon ?? savedLocation?.lon ?? null,
            distance: PLACEHOLDER_DISTANCE,
            isFavorite: FAVORITE_ROUTE_IDS.has(row.id),
          };
          return { route: buildRouteFromRows(steps, meta), steps };
        });

        const loaded = built.filter((r): r is { route: Route; steps: RawRouteRow[] } => r !== null);
        setRealRoutes(loaded.map((l) => l.route));
        setStepsById(Object.fromEntries(loaded.map((l) => [l.route.id, l.steps])));
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

  // Computed once per fetched batch of real routes (not on every
  // render) via useMemo, so the list doesn't reshuffle each time the
  // user navigates back to it.
  const routes = useMemo(() => {
    if (!effectiveRealRoutes) return [];
    return effectiveRealRoutes
      .map((route) =>
        route.id in favoriteOverrides ? { ...route, isFavorite: favoriteOverrides[route.id] } : route,
      )
      .sort((a, b) => parseTimeToMinutes(a.departureTime) - parseTimeToMinutes(b.departureTime));
  }, [effectiveRealRoutes, favoriteOverrides]);

  function handleToggleFavorite(route: Route) {
    setFavoriteOverrides((prev) => ({ ...prev, [route.id]: !route.isFavorite }));
  }

  function handleSaveRoute(
    route: Route,
    steps: RawRouteRow[],
    waypointCache: WaypointCache,
    justCreated: boolean,
    previousId: string | null,
  ) {
    // A rename (EditRouteScreen's own handleSave changed
    // routeNumber/tripType/schoolLevel enough that Route.id itself
    // changed - see that screen's own doc comment) is NOT a second
    // route appearing alongside the first: the server already deleted
    // the old row (see /api/routes' own previousId cleanup), so the
    // old id needs to disappear from every local overlay here too,
    // not just gain a new entry under the new id - otherwise this
    // session's initial realRoutes snapshot keeps showing the old id
    // as a leftover "copy," and Delete on whatever's shown under it
    // 404s against a row that's already gone (see handleDeleteRoute).
    const renamedFrom =
      previousId != null && previousId !== route.id ? previousId : null;
    setAdminRoutes((prev) => {
      const next = { ...prev };
      if (renamedFrom) delete next[renamedFrom];
      next[route.id] = route;
      return next;
    });
    setAdminStepsById((prev) => {
      const next = { ...prev };
      if (renamedFrom) delete next[renamedFrom];
      next[route.id] = steps;
      return next;
    });
    setAdminWaypointCaches((prev) => {
      const next = { ...prev };
      if (renamedFrom) delete next[renamedFrom];
      next[route.id] = waypointCache;
      return next;
    });
    if (renamedFrom) {
      setDeletedRouteIds((prev) => new Set(prev).add(renamedFrom));
    }
    replaceScreen({ kind: "edit-route", route, justCreated });
  }

  /** The quick-edit detour's own "Update" completion (EditRouteScreen's
   * quickEdit.onSaved) - the same three admin overlays handleSaveRoute
   * above updates, but landing back on "trip" (resumeAtStepIndex, the
   * same row just edited/inserted-after) instead of "edit-route", so
   * the driver picks the route back up right where the Edit/Add button
   * was tapped rather than staying in the editor. Never renames the
   * route the way handleSaveRoute sometimes does (previousId) - quick-
   * edit only ever touches one waypoint row, never Route Details, so
   * Route.id can't have changed underneath it. */
  function handleQuickEditSaved(
    route: Route,
    steps: RawRouteRow[],
    waypointCache: WaypointCache,
    resumeAtStepIndex: number,
  ) {
    setAdminRoutes((prev) => ({ ...prev, [route.id]: route }));
    setAdminStepsById((prev) => ({ ...prev, [route.id]: steps }));
    setAdminWaypointCaches((prev) => ({ ...prev, [route.id]: waypointCache }));
    replaceScreen({ kind: "trip", route, resumeAtStepIndex });
  }

  // Updating adminRoutes alone (as this used to, before
  // /api/routes/[id]/status existed) only ever looked saved: it made
  // effectiveRealRoutes read as published/draft for the rest of this
  // session, but a later page load re-fetches realRoutes straight from
  // Postgres, which never got written, so the route silently reverted.
  // adminRoutes is still updated first and optimistically, same as
  // before, so the row's own eyeball/badge flips the instant an admin
  // taps Activate/Deactivate rather than waiting on a round trip; the
  // PATCH below just makes that same value durable. A failure reverts
  // it back rather than leaving the UI showing a status Postgres never
  // actually got, which is exactly the inconsistency this is fixing.
  async function handleSetRouteStatus(route: Route, status: RouteStatus) {
    setAdminRoutes((prev) => ({ ...prev, [route.id]: { ...route, status } }));
    try {
      const res = await fetch(`/api/routes/${route.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    } catch (err) {
      console.error(`Couldn't save route ${route.id}'s status:`, err);
      setAdminRoutes((prev) => ({ ...prev, [route.id]: route }));
    }
  }

  // Same "the local overlay isn't the real write" gap handleSetRouteStatus
  // above had until /api/routes/[id]/status existed: deletedRouteIds
  // used to be the only thing this touched, which hid the row for the
  // rest of this session (effectiveRealRoutes filters by it) but never
  // actually removed anything from Postgres, so it silently came back
  // on the next real page load.
  async function handleDeleteRoute(route: Route) {
    setDeletedRouteIds((prev) => new Set(prev).add(route.id));
    setAdminRoutes((prev) => {
      const next = { ...prev };
      delete next[route.id];
      return next;
    });
    try {
      const res = await fetch(`/api/routes/${route.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    } catch (err) {
      console.error(`Couldn't delete route ${route.id}:`, err);
      setDeletedRouteIds((prev) => {
        const next = new Set(prev);
        next.delete(route.id);
        return next;
      });
    }
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

  // This driver's own permissions, resolved once per render and handed
  // down to every screen that gates something on one of its fields -
  // UserMenu.tsx's own checkboxes are what actually change currentUser
  // (and so this) from one render to the next.
  const permissions = permissionsFor(currentUser);

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
        // `rows` state (seeded from initialSteps once on mount) would
        // never re-seed with the route just saved.
        key="add"
        mode="add"
        route={null}
        routes={routes}
        initialSteps={[]}
        initialStepsText={screen.initialStepsText}
        seedMeta={screen.seedMeta}
        schools={schools}
        permissions={permissions}
        onCancel={goBack}
        onSave={(route, steps, cache, previousId) =>
          handleSaveRoute(route, steps, cache, true, previousId)
        }
      />
    );
  } else if (screen.kind === "edit-route") {
    const initialSteps = adminStepsById[screen.route.id] ?? stepsById[screen.route.id] ?? [];
    content = (
      <EditRouteScreen
        key={`edit-${screen.route.id}`}
        mode="edit"
        route={screen.route}
        routes={routes}
        initialSteps={initialSteps}
        initialWaypointCache={adminWaypointCaches[screen.route.id]}
        schools={schools}
        permissions={permissions}
        initialSubScreen={screen.initialSubScreen}
        justCreated={screen.justCreated}
        quickEdit={
          screen.quickEdit && {
            rowIndex: screen.quickEdit.rowIndex,
            insertNewAfter: screen.quickEdit.insertNewAfter,
            onSaved: handleQuickEditSaved,
            onCancelled: (resumeAtStepIndex) =>
              replaceScreen({ kind: "trip", route: screen.route, resumeAtStepIndex }),
          }
        }
        onSplitToNewRoute={(stepsText, seedMeta) =>
          navigate({ kind: "add-route", initialStepsText: stepsText, seedMeta })
        }
        onCancel={goBack}
        onSave={(route, steps, cache, previousId) =>
          handleSaveRoute(route, steps, cache, false, previousId)
        }
      />
    );
  } else if (screen.kind === "trip") {
    content = (
      <RouteApp
        route={screen.route}
        autoStart={screen.autoStart}
        resumeAtStepIndex={screen.resumeAtStepIndex}
        onBack={goBack}
        onEdit={() => {
          setAdminMode(true);
          navigate({ kind: "edit-route", route: screen.route });
        }}
        onEditStops={() => {
          setAdminMode(true);
          navigate({
            kind: "edit-route",
            route: screen.route,
            initialSubScreen: "stops",
          });
        }}
        onStartedChange={setTripStarted}
        onViewSchool={(schoolName) => navigate({ kind: "school-routes", schoolName })}
        onArrived={handleRouteArrived}
        canEditWaypoints={permissions.canEditWaypoints}
        onEditWaypoint={(rowIndex, insertNewAfter) =>
          navigate({
            kind: "edit-route",
            route: screen.route,
            quickEdit: { rowIndex, insertNewAfter },
          })
        }
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
    const scrollKey = `school:${screen.schoolName}`;
    content = (
      <RouteListScreen
        routes={routes.filter((route) => route.schoolName === screen.schoolName)}
        title={screen.schoolName}
        onBack={goBack}
        adminMode={adminMode}
        permissions={permissions}
        adminWaypointCaches={adminWaypointCaches}
        onToggleAdminMode={() => setAdminMode((prev) => !prev)}
        onSelect={(route) => navigate({ kind: "trip", route })}
        onEditRoute={(route) => navigate({ kind: "edit-route", route })}
        onAddRoute={() => navigate({ kind: "add-route" })}
        onSetRouteStatus={handleSetRouteStatus}
        onDeleteRoute={handleDeleteRoute}
        onToggleFavorite={handleToggleFavorite}
        getInitialScrollTop={() => routeListScrollRef.current.get(scrollKey) ?? 0}
        onScrollTopChange={(top) => routeListScrollRef.current.set(scrollKey, top)}
      />
    );
  } else {
    content = (
      <RouteListScreen
        routes={routes}
        slideInOnMount={justLoaded}
        onViewSchools={() => navigate({ kind: "schools" })}
        adminMode={adminMode}
        permissions={permissions}
        adminWaypointCaches={adminWaypointCaches}
        onToggleAdminMode={() => setAdminMode((prev) => !prev)}
        onSelect={(route) => navigate({ kind: "trip", route })}
        onEditRoute={(route) => navigate({ kind: "edit-route", route })}
        onAddRoute={() => navigate({ kind: "add-route" })}
        onSetRouteStatus={handleSetRouteStatus}
        onDeleteRoute={handleDeleteRoute}
        onToggleFavorite={handleToggleFavorite}
        getInitialScrollTop={() => routeListScrollRef.current.get("top-level") ?? 0}
        onScrollTopChange={(top) => routeListScrollRef.current.set("top-level", top)}
      />
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Same "one persistent instance, not re-rendered per screen"
          reasoning as the pinned Logo just below - floats top-right on
          every screen (its own fixed positioning, not this flow), so
          it's rendered once here rather than by each screen. Gated on
          the same showsPinnedLogo flag as that Logo, and for the same
          underlying reason: StepScreen is the one arrangement that
          doesn't want this floating on top of it - a driver already
          signed in to see their own assigned routes before ever
          reaching it, and its usual top-right spot otherwise crowds
          ExpandableMap's own expand button there (see UserMenu's own
          doc comment). */}
      {showsPinnedLogo && (
        <UserMenu user={currentUser} onChange={setCurrentUser} />
      )}
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
  resumeAtStepIndex,
  onBack,
  onEdit,
  onEditStops,
  onStartedChange,
  onViewSchool,
  onArrived,
  canEditWaypoints,
  onEditWaypoint,
}: {
  route: Route;
  /** True only for the automatic hand-off from a finished route into
   * this one (see the Screen type's own doc comment, page.tsx) - calls
   * start() itself the instant this mounts, skipping past StartScreen
   * straight into this route's own directions the same way a driver
   * tapping "Start Route" normally would. */
  autoStart?: boolean;
  /** Set only when returning from a quick-edit detour (see the Screen
   * type's own "trip" doc comment) - passed straight through to
   * useRouteStepper, which calls start() and jumps straight to this
   * step itself, the same "skip StartScreen" effect autoStart has, just
   * landing mid-route instead of at step 0. */
  resumeAtStepIndex?: number;
  onBack: () => void;
  onEdit: () => void;
  /** Passed straight through to StartScreen's own View Stops popup -
   * same destination as onEdit, but straight to the Stops and Turns
   * screen rather than the hub. */
  onEditStops: () => void;
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
  /** permissionsFor().canEditWaypoints, already resolved by page.tsx -
   * passed straight through to StepScreen, which hides its own Edit/Add
   * buttons entirely when this is false (always true for now - see
   * permissionsFor's own doc comment, permissions.ts). */
  canEditWaypoints: boolean;
  /** Opens the quick-edit detour for `currentStep` (StepScreen's own
   * Edit/Add buttons) - `rowIndex` is always currentStep.id (see
   * NavigationStep.id's own doc comment, parseRouteCsv.ts: it's the raw
   * row's own array index, the same index quickEdit resumes driving at
   * once the popup closes), `insertNewAfter` true for Add, false for
   * Edit. */
  onEditWaypoint: (rowIndex: number, insertNewAfter: boolean) => void;
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
  } = useRouteStepper(route, resumeAtStepIndex);

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

  // Same forward/backward push as page.tsx's own top-level screens
  // (List <-> Add/Edit Route/trip), applied "universally" to this
  // local start/step switch too - tapping "Start Route" always flips
  // `started` false->true (forward), and the only way back to false is
  // "Exit Route" (StepScreen's own "End" at the arrived phase, via
  // endRoute/resetTrip below) - never the other way around - so the
  // direction always follows `started` itself, no separate state
  // needed to track which way this particular flip just went.
  const content = !started ? (
    <StartScreen
      route={route}
      onStart={start}
      onBack={onBack}
      onEdit={onEdit}
      onEditStops={onEditStops}
      onViewSchool={onViewSchool}
    />
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
      getRoster={getRoster}
      totalOnboard={totalOnboard}
      onRiderTap={fillTo}
      onAddRider={addUnexpectedRider}
      canEditWaypoints={canEditWaypoints}
      onEditWaypoint={(insertNewAfter) => onEditWaypoint(currentStep.id, insertNewAfter)}
    />
  );

  return (
    <ScreenTransition screenKey={started ? "step" : "start"} direction={started ? "forward" : "backward"}>
      {content}
    </ScreenTransition>
  );
}
