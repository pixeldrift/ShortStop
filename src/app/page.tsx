"use client";

import { useEffect, useMemo, useState } from "react";
import { EditRouteScreen } from "@/components/EditRouteScreen";
import { RouteListScreen } from "@/components/RouteListScreen";
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

// Where each master-list row's own turn-by-turn steps sheet lives,
// keyed by the same `${routeNumber}-${tripType}-${schoolLevel}` id the
// master list generates/carries (see Route.id's doc comment in
// types.ts). File names follow the district's own convention -
// route, AM/PM, school type (e.g. "120-AM-MS.csv"), not this app's
// tripType/schoolLevel spelling. Deliberately only covers routes a real
// steps sheet exists for - 120-PM-HS has no entry here yet (its sheet
// came in visibly incomplete, cutting off mid-neighborhood, so the
// master list marks it "draft" - see route-master-list.csv), and any
// row with no entry here is skipped rather than crashing (see the
// `.filter` below).
const ROUTE_STEPS_CSV_PATHS: Record<string, string> = {
  "125-dropoff-elementary": "/data/125-PM-EL.csv",
  "120-pickup-elementary": "/data/120-AM-EL.csv",
  "120-pickup-middle": "/data/120-AM-MS.csv",
  "120-pickup-high": "/data/120-AM-HS.csv",
  "120-dropoff-elementary": "/data/120-PM-EL.csv",
  "120-dropoff-middle": "/data/120-PM-MS.csv",
};

async function fetchText(path: string): Promise<string> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${path}`);
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
  | { kind: "trip"; route: Route }
  | { kind: "add-route" }
  | { kind: "edit-route"; route: Route };

export default function Home() {
  // null while the master list + every loadable route's steps sheet
  // are still loading; an empty array is a real (if unexpected) "loaded
  // but nothing came back" result, kept distinct from still-loading so
  // the spinner doesn't hang forever on that edge case.
  const [realRoutes, setRealRoutes] = useState<Route[] | null>(null);
  // Each loaded real route's own source steps text, alongside the
  // parsed Route itself - EditRouteScreen needs the raw text to
  // pre-fill its textarea, not just the already-derived NavigationSteps.
  const [rawStepsById, setRawStepsById] = useState<Record<string, string>>({});
  const [schools, setSchools] = useState<Record<string, SchoolInfo>>({});
  const [error, setError] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>({ kind: "list" });

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
  // Toggled by RouteListScreen's own "Edit Mode" link, or turned on
  // unconditionally by a route's "Edit Route" link on StartScreen -
  // reveals draft real routes on the list, dimmed, and the per-row
  // publish/unpublish/delete controls alongside them.
  const [adminMode, setAdminMode] = useState(false);

  useEffect(() => {
    Promise.all([fetchText("/data/route-master-list.csv"), fetchText("/data/schools.csv")])
      .then(async ([masterListCsv, schoolsCsv]) => {
        const allRows = parseRouteMasterList(masterListCsv);
        const schoolsTable = parseSchoolsCsv(schoolsCsv);
        setSchools(schoolsTable);

        const built = await Promise.all(
          allRows.map(async (row) => {
            const stepsPath = ROUTE_STEPS_CSV_PATHS[row.id];
            if (!stepsPath) return null;

            // A row with no computable duration (blank end_time) means
            // the master list hasn't recorded when this route ends yet
            // - a data problem worth surfacing rather than silently
            // showing a fake "0 min" trip, whatever its status.
            if (row.durationMinutes == null) {
              console.warn(`Route ${row.id} has no end_time in the master list - skipped`);
              return null;
            }

            const stepsCsv = await fetchText(stepsPath);
            const meta: RouteMeta = {
              ...row,
              durationMinutes: row.durationMinutes,
              driverName: PLACEHOLDER_DRIVER_NAME,
              schoolAddress: schoolsTable[row.schoolName]?.address ?? SCHOOL_ADDRESS_NOT_YET_PROVIDED,
              distance: PLACEHOLDER_DISTANCE,
              isFavorite: FAVORITE_ROUTE_IDS.has(row.id),
            };
            return { route: parseRouteCsv(stepsCsv, meta), rawStepsText: stepsCsv };
          }),
        );

        const loaded = built.filter((r): r is { route: Route; rawStepsText: string } => r !== null);
        setRealRoutes(loaded.map((l) => l.route));
        setRawStepsById(Object.fromEntries(loaded.map((l) => [l.route.id, l.rawStepsText])));
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

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
      .map((route) =>
        route.id in favoriteOverrides ? { ...route, isFavorite: favoriteOverrides[route.id] } : route,
      )
      .sort((a, b) => parseTimeToMinutes(a.departureTime) - parseTimeToMinutes(b.departureTime));
  }, [effectiveRealRoutes, favoriteOverrides]);

  function handleToggleFavorite(route: Route) {
    setFavoriteOverrides((prev) => ({ ...prev, [route.id]: !route.isFavorite }));
  }

  function handleSaveRoute(route: Route, rawStepsText: string, waypointCache: WaypointCache) {
    setAdminRoutes((prev) => ({ ...prev, [route.id]: route }));
    setAdminRawStepsById((prev) => ({ ...prev, [route.id]: rawStepsText }));
    setAdminWaypointCaches((prev) => ({ ...prev, [route.id]: waypointCache }));
    setScreen({ kind: "edit-route", route });
  }

  function handleSetRouteStatus(route: Route, status: RouteStatus) {
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

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-center text-red-500">
        Couldn&apos;t load route data: {error}
      </div>
    );
  }

  if (!realRoutes) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-zinc-500">
        Loading route…
      </div>
    );
  }

  if (screen.kind === "add-route") {
    return (
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
        rawStepsText=""
        schools={schools}
        onCancel={() => setScreen({ kind: "list" })}
        onSave={handleSaveRoute}
      />
    );
  }

  if (screen.kind === "edit-route") {
    const rawStepsText = adminRawStepsById[screen.route.id] ?? rawStepsById[screen.route.id] ?? "";
    return (
      <EditRouteScreen
        key={`edit-${screen.route.id}`}
        mode="edit"
        route={screen.route}
        rawStepsText={rawStepsText}
        initialWaypointCache={adminWaypointCaches[screen.route.id]}
        schools={schools}
        onCancel={() => setScreen({ kind: "list" })}
        onSave={handleSaveRoute}
      />
    );
  }

  if (screen.kind === "trip") {
    return (
      <RouteApp
        route={screen.route}
        onBack={() => setScreen({ kind: "list" })}
        onEdit={() => {
          setAdminMode(true);
          setScreen({ kind: "edit-route", route: screen.route });
        }}
      />
    );
  }

  return (
    <RouteListScreen
      routes={routes}
      adminMode={adminMode}
      adminWaypointCaches={adminWaypointCaches}
      onToggleAdminMode={() => setAdminMode((prev) => !prev)}
      onSelect={(route) => setScreen({ kind: "trip", route })}
      onEditRoute={(route) => setScreen({ kind: "edit-route", route })}
      onAddRoute={() => setScreen({ kind: "add-route" })}
      onSetRouteStatus={handleSetRouteStatus}
      onDeleteRoute={handleDeleteRoute}
      onToggleFavorite={handleToggleFavorite}
    />
  );
}

function RouteApp({
  route,
  onBack,
  onEdit,
}: {
  route: Route;
  onBack: () => void;
  onEdit: () => void;
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

  const { getRoster, fillTo, addUnexpectedRider, totalOnboard } = useRiderRoster();

  if (!started) {
    return <StartScreen route={route} onStart={start} onBack={onBack} onEdit={onEdit} />;
  }

  const expectedCount = phase === "step" ? (currentStep.studentCount ?? 0) : 0;

  return (
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
}
