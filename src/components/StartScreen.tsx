import { Logo } from "./Logo";
import type { Route } from "@/lib/types";

export function StartScreen({
  route,
  onStart,
}: {
  route: Route;
  onStart: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-10 p-6 text-center">
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

      <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-lg">
        <dt className="text-zinc-500">Driver</dt>
        <dd className="text-left font-medium">{route.driverName}</dd>
        <dt className="text-zinc-500">Bus</dt>
        <dd className="text-left font-medium">#{route.busNumber}</dd>
        <dt className="text-zinc-500">Departure</dt>
        <dd className="text-left font-medium">{route.departureTime}</dd>
      </dl>

      <button
        type="button"
        onClick={onStart}
        className="font-heading w-full max-w-xs rounded-2xl bg-blue-600 py-6 text-2xl font-bold text-white shadow-lg active:scale-[0.98]"
      >
        Start Route
      </button>
    </div>
  );
}
