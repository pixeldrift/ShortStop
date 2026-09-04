"use client";

import { useEffect, useMemo, useState } from "react";
import { RouteListScreen } from "@/components/RouteListScreen";
import { StartScreen } from "@/components/StartScreen";
import { StepScreen } from "@/components/StepScreen";
import { buildDemoRoutes } from "@/lib/demoRoutes";
import { parseRouteCsv } from "@/lib/parseRouteCsv";
import { parseRouteMetaCsv } from "@/lib/parseRouteMetaCsv";
import { PLACEHOLDER_META } from "@/lib/placeholderMeta";
import { parseTimeToMinutes } from "@/lib/time";
import { useRiderRoster } from "@/lib/useRiderRoster";
import { useRouteStepper } from "@/lib/useRouteStepper";
import type { Route } from "@/lib/types";

// How many fabricated routes to add to the real one, purely so the
// route-list screen has enough rows to actually demonstrate scrolling
// and search filtering - see demoRoutes.ts.
const DEMO_ROUTE_COUNT = 24;

export default function Home() {
  const [route, setRoute] = useState<Route | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Which route (if any) is selected for the trip-summary/step flow -
  // null means we're on the route-list home screen. Cleared back to
  // null whenever the user taps the back arrow on the trip-summary
  // screen.
  const [selectedRoute, setSelectedRoute] = useState<Route | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/data/route-125.csv").then((res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return res.text();
      }),
      fetch("/data/route-125-meta.csv").then((res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return res.text();
      }),
    ])
      .then(([stepsCsv, metaCsv]) => {
        const meta = { ...parseRouteMetaCsv(metaCsv), ...PLACEHOLDER_META };
        setRoute(parseRouteCsv(stepsCsv, meta));
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  // Only one real route exists right now (see ROUTE_META above) -
  // buildDemoRoutes fabricates the rest purely so the list has enough
  // rows to demonstrate scrolling/search. Computed once per fetched
  // route (not on every render) via useMemo, so the list doesn't
  // reshuffle each time the user navigates back to it.
  const routes = useMemo(() => {
    if (!route) return [];
    return [route, ...buildDemoRoutes(route, DEMO_ROUTE_COUNT)].sort(
      (a, b) => parseTimeToMinutes(a.departureTime) - parseTimeToMinutes(b.departureTime),
    );
  }, [route]);

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-center text-red-500">
        Couldn&apos;t load route data: {error}
      </div>
    );
  }

  if (!route) {
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
