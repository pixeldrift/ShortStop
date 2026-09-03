"use client";

import { useEffect, useState } from "react";
import { Logo } from "./Logo";
import { TriangleIcon } from "./icons";
import { addMinutesToTimeString } from "@/lib/time";
import type { Route } from "@/lib/types";

function useCurrentTime() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return now;
}

export function StartScreen({
  route,
  onStart,
}: {
  route: Route;
  onStart: () => void;
}) {
  const now = useCurrentTime();
  const totalStops = route.steps.filter((s) => s.kind === "stop").length;
  const totalRiders = route.steps.reduce((sum, s) => sum + (s.studentCount ?? 0), 0);
  const estimatedEnd = addMinutesToTimeString(route.departureTime, route.durationMinutes);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 p-6 text-center">
      <Logo size="large" />

      <div>
        <p className="text-sm font-semibold tracking-widest text-zinc-500 uppercase">
          Today
        </p>
        <h1 className="font-heading mt-2 text-4xl font-black tracking-tight">
          Route {route.routeNumber}
        </h1>
        <p className="mt-1 text-xl text-zinc-500">{route.name}</p>
      </div>

      <div className="font-heading flex items-center gap-2 text-lg font-bold">
        <span>{route.distance}</span>
        <span className="text-zinc-400">·</span>
        <span>{route.durationMinutes} min</span>
        <span className="text-zinc-400">·</span>
        <span>Arrive {estimatedEnd}</span>
      </div>

      <div>
        <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-lg">
          <dt className="text-zinc-500">Driver</dt>
          <dd className="text-left font-medium">{route.driverName}</dd>
          <dt className="text-zinc-500">Bus</dt>
          <dd className="text-left font-medium">#{route.busNumber}</dd>
          <dt className="text-zinc-500">Departure</dt>
          <dd className="text-left font-medium">{route.departureTime}</dd>
          <dt className="text-zinc-500">School</dt>
          <dd className="text-left font-medium">Laverne Lake Elementary</dd>
          <dt className="text-zinc-500">Stops</dt>
          <dd className="text-left font-medium">{totalStops}</dd>
          <dt className="text-zinc-500">~Riders</dt>
          <dd className="text-left font-medium">{totalRiders}</dd>
        </dl>

        <p className="mt-3 text-sm text-zinc-500" suppressHydrationWarning>
          {now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
        </p>
      </div>

      <button
        type="button"
        onClick={onStart}
        className="btn-glossy font-heading flex w-full max-w-xs items-center justify-center gap-2 rounded-2xl bg-blue-600 py-6 text-2xl font-bold text-white active:scale-[0.98]"
      >
        Start Route <TriangleIcon direction="right" className="h-6 w-6" />
      </button>
    </div>
  );
}
