"use client";

import { useEffect, useMemo, useState } from "react";
import { RouteListScreen } from "@/components/RouteListScreen";
import { StartScreen } from "@/components/StartScreen";
import { StepScreen } from "@/components/StepScreen";
import { buildDemoRoutes } from "@/lib/demoRoutes";
import { parseRouteCsv } from "@/lib/parseRouteCsv";
import type { RouteMeta } from "@/lib/parseRouteCsv";
import { parseRouteMasterList } from "@/lib/parseRouteMasterList";
import {
  FAVORITE_ROUTE_IDS,
  PLACEHOLDER_DISTANCE,
  PLACEHOLDER_DRIVER_NAME,
  SCHOOL_ADDRESSES,
} from "@/lib/placeholderMeta";
import { parseTimeToMinutes } from "@/lib/time";
import { useRiderRoster } from "@/lib/useRiderRoster";
import { useRouteStepper } from "@/lib/useRouteStepper";
import type { Route } from "@/lib/types";

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
// steps sheet exists for - 120-PM-MS/120-PM-HS are "active" candidates
// with no entry here yet (their sheets came in visibly incomplete, so
// the master list marks them "inactive" instead - see
// route-master-list.csv), and any future "active" row with no entry
// here is skipped rather than crashing (see the `.filter` below).
const ROUTE_STEPS_CSV_PATHS: Record<string, string> = {
  "125-dropoff-elementary": "/data/125-PM-EL.csv",
  "120-pickup-elementary": "/data/120-AM-EL.csv",
  "120-pickup-middle": "/data/120-AM-MS.csv",
  "120-pickup-high": "/data/120-AM-HS.csv",
  "120-dropoff-elementary": "/data/120-PM-EL.csv",
};

async function fetchText(path: string): Promise<string> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${path}`);
  return res.text();
}

export default function Home() {
  // null while the master list + every active route's steps sheet are
  // still loading; an empty array is a real (if unexpected) "loaded but
  // nothing came back" result, kept distinct from still-loading so the
  // spinner doesn't hang forever on that edge case.
  const [realRoutes, setRealRoutes] = useState<Route[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Which route (if any) is selected for the trip-summary/step flow -
  // null means we're on the route-list home screen. Cleared back to
  // null whenever the user taps the back arrow on the trip-summary
  // screen.
  const [selectedRoute, setSelectedRoute] = useState<Route | null>(null);

  useEffect(() => {
    fetchText("/data/route-master-list.csv")
      .then(async (masterListCsv) => {
        const activeRows = parseRouteMasterList(masterListCsv).filter(
          (row) => row.status === "active",
        );

        const built = await Promise.all(
          activeRows.map(async (row) => {
            const stepsPath = ROUTE_STEPS_CSV_PATHS[row.id];
            if (!stepsPath) return null;

            // An "active" row with no computable duration (blank
            // end_time) means the master list is claiming this route
            // is fully run without actually recording when it ends -
            // a data problem worth surfacing rather than silently
            // showing a fake "0 min" trip.
            if (row.durationMinutes == null) {
              console.warn(`Active route ${row.id} has no end_time in the master list - skipped`);
              return null;
            }

            const stepsCsv = await fetchText(stepsPath);
            const meta: RouteMeta = {
              ...row,
              durationMinutes: row.durationMinutes,
              driverName: PLACEHOLDER_DRIVER_NAME,
              schoolAddress: SCHOOL_ADDRESSES[row.schoolName] ?? SCHOOL_ADDRESSES["Lavergne Lake Elementary"],
              distance: PLACEHOLDER_DISTANCE,
              isFavorite: FAVORITE_ROUTE_IDS.has(row.id),
            };
            return parseRouteCsv(stepsCsv, meta);
          }),
        );

        setRealRoutes(built.filter((r): r is Route => r !== null));
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  // buildDemoRoutes fabricates the rest purely so the list has enough
  // rows to demonstrate scrolling/search. Computed once per fetched
  // batch of real routes (not on every render) via useMemo, so the
  // list doesn't reshuffle each time the user navigates back to it.
  const routes = useMemo(() => {
    if (!realRoutes || realRoutes.length === 0) return realRoutes ?? [];
    return [...realRoutes, ...buildDemoRoutes(realRoutes, DEMO_ROUTE_COUNT)].sort(
      (a, b) => parseTimeToMinutes(a.departureTime) - parseTimeToMinutes(b.departureTime),
    );
  }, [realRoutes]);

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

  if (!selectedRoute) {
    return <RouteListScreen routes={routes} onSelect={setSelectedRoute} />;
  }

  return <RouteApp route={selectedRoute} onBack={() => setSelectedRoute(null)} />;
}

function RouteApp({ route, onBack }: { route: Route; onBack: () => void }) {
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
    return <StartScreen route={route} onStart={start} onBack={onBack} />;
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
