"use client";

import { useEffect, useState } from "react";
import { StartScreen } from "@/components/StartScreen";
import { StepScreen } from "@/components/StepScreen";
import { parseRouteCsv } from "@/lib/parseRouteCsv";
import { useRiderRoster } from "@/lib/useRiderRoster";
import { useRouteStepper } from "@/lib/useRouteStepper";
import type { Route } from "@/lib/types";

// distance/durationMinutes are placeholders - no real mileage/timing
// data exists for this route yet.
const ROUTE_META = {
  name: "Bus 125 Route",
  routeNumber: "125",
  driverName: "Otto Mann",
  busNumber: "125",
  departureTime: "3:30 PM",
  distance: "8.4 mi",
  durationMinutes: 28,
};

export default function Home() {
  const [route, setRoute] = useState<Route | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  return <RouteApp route={route} />;
}

function RouteApp({ route }: { route: Route }) {
  const {
    currentStep,
    currentIndex,
    isFirstStep,
    isLastStep,
    totalStops,
    currentStopNumber,
    stopProgressNumber,
    started,
    start,
    advance,
    goBack,
    paused,
    togglePause,
  } = useRouteStepper(route);

  const { getRoster, toggleRider, checkAll, addUnexpectedRider, totalOnboard } =
    useRiderRoster();

  if (!started) {
    return <StartScreen route={route} onStart={start} />;
  }

  const expectedCount = currentStep.studentCount ?? 0;

  return (
    <StepScreen
      route={route}
      step={currentStep}
      stepNumber={currentIndex + 1}
      stopNumber={currentStopNumber}
      stopProgressNumber={stopProgressNumber}
      totalStops={totalStops}
      isFirstStep={isFirstStep}
      isLastStep={isLastStep}
      paused={paused}
      onAdvance={advance}
      onBack={goBack}
      onTogglePause={togglePause}
      roster={getRoster(currentStep.id, expectedCount)}
      totalOnboard={totalOnboard}
      onToggleRider={(index) => toggleRider(currentStep.id, index, expectedCount)}
      onCheckAll={() => checkAll(currentStep.id, expectedCount)}
      onAddRider={() => addUnexpectedRider(currentStep.id, expectedCount)}
    />
  );
}
