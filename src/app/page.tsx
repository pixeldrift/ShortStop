"use client";

import { useEffect, useState } from "react";
import { RouteListScreen } from "@/components/RouteListScreen";
import { StartScreen } from "@/components/StartScreen";
import { StepScreen } from "@/components/StepScreen";
import { parseRouteCsv } from "@/lib/parseRouteCsv";
import { useRiderRoster } from "@/lib/useRiderRoster";
import { useRouteStepper } from "@/lib/useRouteStepper";
import type { Route } from "@/lib/types";

// distance/durationMinutes are placeholders - no real mileage/timing
// data exists for this route yet.
const ROUTE_META = {
  name: "Lavergne Lake Elementary — Afternoon Drop Off",
  routeNumber: "125",
  driverName: "Otto Mann",
  busNumber: "125",
  departureTime: "3:30 PM",
  schoolName: "Lavergne Lake Elementary",
  schoolAddress: "1425 Lake Forest Dr, Smyrna, TN 37167",
  tripType: "dropoff" as const,
  distance: "8.4 mi",
  durationMinutes: 28,
};

export default function Home() {
  const [route, setRoute] = useState<Route | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Which screen we're on: the route list (home) or a selected route's
  // trip-summary/step flow. Reset to the list whenever the user taps the
  // back arrow on the trip-summary screen.
  const [routeSelected, setRouteSelected] = useState(false);

  useEffect(() => {
    fetch("/data/route-125.csv")
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return res.text();
      })
      .then((text) => setRoute(parseRouteCsv(text, ROUTE_META)))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

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

  // Only one real route exists right now (see ROUTE_META above) - the
  // list still renders as a genuinely scrollable table, ready for more
  // rows, rather than padding it out with fabricated placeholder routes.
  if (!routeSelected) {
    return <RouteListScreen routes={[route]} onSelect={() => setRouteSelected(true)} />;
  }

  return <RouteApp route={route} onBack={() => setRouteSelected(false)} />;
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
    paused,
    togglePause,
    endRoute,
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
      onTogglePause={togglePause}
      onEndRoute={endRoute}
      announcementDone={announcementDone}
      roster={getRoster(currentStep.id, expectedCount)}
      totalOnboard={totalOnboard}
      onRiderTap={(index) => fillTo(currentStep.id, index, expectedCount)}
      onAddRider={() => addUnexpectedRider(currentStep.id, expectedCount)}
    />
  );
}
