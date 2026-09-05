"use client";

import { useEffect, useState } from "react";
import { Logo } from "./Logo";
import { BackArrowIcon, CloseIcon, MapPinIcon, SunIcon, SunriseIcon, TriangleIcon } from "./icons";
import type { NavigationStep, Route } from "@/lib/types";

// Not currently rendered (see StartScreen below) - kept ready to
// re-enable later, so it's exported rather than deleted.
export function useCurrentTime() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return now;
}

export function LiveClock({ now }: { now: Date }) {
  const hours24 = now.getHours();
  const hour12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const minute = String(now.getMinutes()).padStart(2, "0");
  const period = hours24 >= 12 ? "PM" : "AM";

  return (
    <div
      className="font-heading mt-2 inline-flex items-center gap-0.5 rounded-lg border border-zinc-300 px-3 py-1"
      suppressHydrationWarning
    >
      <span className="text-xl font-extrabold tabular-nums">{hour12}</span>
      <span className="animate-blink text-xl font-extrabold">:</span>
      <span className="text-xl font-extrabold tabular-nums">{minute}</span>
      <span className="ml-1 text-xs font-semibold text-zinc-500">{period}</span>
    </div>
  );
}

/** Splits a value string like "8.4 mi" into ["8.4", "mi"] - only the
 * number is used, so the distance stat tile can show a spelled-out
 * "miles" label instead of whatever abbreviated unit the data uses. */
function splitValueUnit(text: string): [string, string] {
  const match = text.match(/^([\d.,]+)\s*(.*)$/);
  return match ? [match[1], match[2]] : [text, ""];
}

function StatTile({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col items-center">
      <span className="font-heading text-2xl font-black tracking-tight">{value}</span>
      <span className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">{label}</span>
    </div>
  );
}

export function StartScreen({
  route,
  onStart,
  onBack,
}: {
  route: Route;
  onStart: () => void;
  onBack: () => void;
}) {
  const totalStops = route.steps.filter((s) => s.kind === "stop").length;
  const totalRiders = route.steps.reduce((sum, s) => sum + (s.studentCount ?? 0), 0);
  const [distanceValue] = splitValueUnit(route.distance);
  const [showStopsModal, setShowStopsModal] = useState(false);

  return (
    <div className="flex flex-1 flex-col items-center gap-4 overflow-y-auto px-6 pt-6 pb-6 text-center landscape:pt-4">
      <Logo size="large" />

      <div className="flex w-full max-w-md items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to routes"
          className="btn-glossy flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-zinc-400 bg-zinc-200"
        >
          <BackArrowIcon className="h-5 w-5" />
        </button>
        <h1 className="font-heading flex items-center gap-2 text-4xl font-black tracking-tight">
          Route {route.routeNumber}
          <span className="flex items-center gap-1 text-lg text-blue-500">
            {route.tripType === "pickup" ? "AM" : "PM"}
            {route.tripType === "pickup" ? (
              <SunriseIcon className="h-4 w-4" />
            ) : (
              <SunIcon className="h-4 w-4" />
            )}
          </span>
        </h1>
      </div>

      <div className="w-full max-w-md rounded-2xl border border-zinc-300 p-5">
        <p className="text-lg leading-tight text-zinc-500">{route.name}</p>
        <p className="mt-1 flex items-center justify-center gap-1 text-sm text-zinc-500">
          <MapPinIcon className="h-3.5 w-3.5 shrink-0 text-blue-500" />
          {route.schoolAddress}
        </p>

        <div className="mt-4 grid grid-cols-4 gap-2">
          <StatTile value={distanceValue} label="miles" />
          <StatTile value={String(route.durationMinutes)} label="minutes" />
          <StatTile value={String(totalStops)} label="stops" />
          <StatTile value={String(totalRiders)} label="riders" />
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-x-8 gap-y-1 text-lg">
          <dt className="text-right text-zinc-500">Departure</dt>
          <dd className="text-left font-medium">{route.departureTime}</dd>
          <dt className="text-right text-zinc-500">Bus</dt>
          <dd className="text-left font-medium">#{route.busNumber}</dd>
          <dt className="text-right text-zinc-500">Driver</dt>
          <dd className="text-left font-medium">{route.driverName}</dd>
        </dl>

        <button
          type="button"
          onClick={() => setShowStopsModal(true)}
          className="btn-glossy font-heading mt-4 flex w-full items-center justify-center gap-1.5 rounded-xl border border-zinc-300 bg-white py-2.5 text-base font-semibold text-zinc-700"
        >
          View All Stops
        </button>
      </div>

      <button
        type="button"
        onClick={onStart}
        className="btn-glossy font-heading flex w-full max-w-xs items-center justify-center gap-2 rounded-2xl bg-blue-600 py-6 text-2xl font-bold text-white active:scale-[0.98]"
      >
        Start Route <TriangleIcon direction="right" className="h-6 w-6" />
      </button>

      {showStopsModal && (
        <AllStopsModal route={route} onClose={() => setShowStopsModal(false)} />
      )}
    </div>
  );
}

/** Scrolling list of every stop on the route, in order - tapping "View
 * All Stops" on the Route info screen above. Only "stop" steps for
 * now, not turns - a later toggle to also show turns (see the
 * StepScreen "TURN {direction}" heading/subheading convention) can
 * switch which steps this filters to without changing anything else
 * here. */
function AllStopsModal({ route, onClose }: { route: Route; onClose: () => void }) {
  const stops = route.steps.filter((step): step is NavigationStep & { kind: "stop" } =>
    step.kind === "stop",
  );

  return (
    <div
      className="fixed inset-0 z-20 flex items-center justify-center bg-black/50 p-6"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-sm flex-col rounded-xl bg-[var(--background)] shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-zinc-200 px-5 py-4">
          <h2 className="font-heading text-xl font-black tracking-tight">All Stops</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-500 active:bg-zinc-100"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="divide-y divide-zinc-200 overflow-y-auto px-5">
          {stops.map((step, index) => (
            <div key={step.id} className="py-3 text-left">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-heading font-black">Stop {index + 1}</span>
                {step.studentCount != null && (
                  <span className="shrink-0 text-sm text-zinc-500">
                    {step.studentCount} rider{step.studentCount === 1 ? "" : "s"}
                  </span>
                )}
              </div>
              <p className="text-zinc-700">
                {step.subheading}
                {step.sideOfRoad ? ` (${step.sideOfRoad})` : ""}
              </p>
              {step.specialInstruction && (
                <p className="mt-0.5 text-sm text-zinc-500">{step.specialInstruction}</p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
