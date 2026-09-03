import Image from "next/image";
import { RouteProgressBar } from "./RouteProgressBar";
import { TopBar } from "./TopBar";
import { PauseIcon, PersonIcon, PersonSolidIcon, TriangleIcon, TurnArrow } from "./icons";
import type { NavigationStep, Route } from "@/lib/types";

export function StepScreen({
  route,
  step,
  stepNumber,
  stopNumber,
  stopProgressNumber,
  totalStops,
  isFirstStep,
  isLastStep,
  paused,
  onAdvance,
  onBack,
  onTogglePause,
  roster,
  totalOnboard,
  onRiderTap,
  onAddRider,
}: {
  route: Route;
  step: NavigationStep;
  stepNumber: number;
  stopNumber: number | null;
  stopProgressNumber: number;
  totalStops: number;
  isFirstStep: boolean;
  isLastStep: boolean;
  paused: boolean;
  onAdvance: () => void;
  onBack: () => void;
  onTogglePause: () => void;
  roster: boolean[];
  totalOnboard: number;
  onRiderTap: (index: number) => void;
  onAddRider: () => void;
}) {
  const isStop = step.kind === "stop";
  const showRoster = !paused && isStop && roster.length > 0;

  return (
    <div className="flex flex-1 flex-col overflow-hidden select-none">
      {/* Rider check-in - occupies the same fixed slot on every step (the
          map used to live here), empty when there's nothing to check in,
          so the header/content below never shift position between a
          turn step and a stop step. */}
      <div className="h-56 shrink-0 overflow-hidden px-4 pt-4">
        {showRoster && (
          <RiderCheckInBox roster={roster} onRiderTap={onRiderTap} onAddRider={onAddRider} />
        )}
      </div>

      {/* Pinned header: always visible, doesn't scroll away */}
      <div className="shrink-0 px-4">
        <TopBar routeNumber={route.routeNumber} busNumber={route.busNumber} />

        <div className="mt-2 flex items-center justify-between">
          <p className="text-xs font-semibold tracking-wide text-zinc-500">
            Stop {stopProgressNumber} of {totalStops}
          </p>
          <div className="flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            <PersonSolidIcon className="h-3 w-3" />
            {totalOnboard} onboard
          </div>
        </div>
      </div>

      {/* Scrollable: progress bar + step content */}
      <div
        className="flex flex-1 touch-manipulation flex-col gap-3 overflow-y-auto p-4"
        onClick={() => !paused && onAdvance()}
      >
        <RouteProgressBar steps={route.steps} currentIndex={stepNumber - 1} />

        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          {paused ? (
            <PausedContent />
          ) : isStop ? (
            <StopContent step={step} stopNumber={stopNumber} />
          ) : (
            <TurnContent step={step} />
          )}
        </div>
      </div>

      {/* Footer - pinned */}
      <div
        className="flex w-full max-w-md shrink-0 items-center gap-3 self-center p-4 pt-0"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onBack}
          disabled={isFirstStep || paused}
          aria-label="Back"
          className="btn-glossy font-heading flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-zinc-300 bg-zinc-100 py-4 text-lg font-semibold disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-800"
        >
          <TriangleIcon direction="left" className="h-6 w-6" /> Back
        </button>

        <button
          type="button"
          onClick={onTogglePause}
          aria-label={paused ? "Resume route" : "Pause route"}
          className="btn-glossy flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white"
        >
          {paused ? <TriangleIcon direction="right" className="h-6 w-6" /> : <PauseIcon className="h-6 w-6" />}
        </button>

        <button
          type="button"
          onClick={onAdvance}
          disabled={isLastStep || paused}
          aria-label={isStop ? "Continue route" : "Next"}
          className="btn-glossy font-heading flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-blue-600 py-4 text-lg font-semibold text-white disabled:opacity-40"
        >
          {isStop ? "Continue Route" : "Next"} <TriangleIcon direction="right" className="h-6 w-6" />
        </button>
      </div>
    </div>
  );
}

function TurnContent({ step }: { step: NavigationStep }) {
  return (
    <>
      {step.direction ? (
        <TurnArrow direction={step.direction} className="h-32 w-32 sm:h-40 sm:w-40" />
      ) : (
        <h1 className="font-heading text-4xl font-black tracking-tight">{step.heading}</h1>
      )}

      {step.subheading && (
        <p className="font-heading text-5xl leading-tight font-black tracking-tight sm:text-6xl">
          {step.subheading}
        </p>
      )}

      {step.distance && <p className="text-xl text-zinc-500">{step.distance}</p>}

      {step.specialInstruction && (
        <p className="rounded-lg bg-yellow-400/20 px-3 py-2 text-base">
          {step.specialInstruction}
        </p>
      )}
    </>
  );
}

function StopContent({ step, stopNumber }: { step: NavigationStep; stopNumber: number | null }) {
  return (
    <>
      <div className="relative">
        <Image src="/assets/pin.png" alt="" width={350} height={548} className="h-28 w-auto sm:h-36" />
        {stopNumber && (
          <span className="font-heading absolute top-[31%] left-1/2 -translate-x-1/2 -translate-y-1/2 text-3xl font-black text-red-700 sm:text-4xl">
            {stopNumber}
          </span>
        )}
      </div>

      {step.subheading && (
        <p className="font-heading text-5xl leading-tight font-black tracking-tight sm:text-6xl">
          {step.subheading}
        </p>
      )}

      {step.sideOfRoad && <p className="text-zinc-500">Stop on {step.sideOfRoad} side</p>}

      {step.specialInstruction && (
        <p className="rounded-lg bg-yellow-400/20 px-3 py-2 text-base">
          {step.specialInstruction}
        </p>
      )}
    </>
  );
}

function RiderCheckInBox({
  roster,
  onRiderTap,
  onAddRider,
}: {
  roster: boolean[];
  onRiderTap: (index: number) => void;
  onAddRider: () => void;
}) {
  return (
    <div
      className="flex h-full w-full flex-col items-center justify-center overflow-y-auto rounded-xl border border-zinc-200 p-3 dark:border-zinc-700"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex flex-wrap items-start justify-center gap-2">
        {roster.map((checked, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onRiderTap(i)}
            aria-pressed={checked}
            aria-label={`Check in through rider ${i + 1}${checked ? " (checked in)" : ""}`}
            className="flex flex-col items-center gap-0.5"
          >
            <span
              className={
                "flex h-11 w-11 items-center justify-center rounded-full transition-colors " +
                (checked
                  ? "bg-green-600 text-white"
                  : "bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500")
              }
            >
              {checked ? <PersonSolidIcon className="h-6 w-6" /> : <PersonIcon className="h-6 w-6" />}
            </span>
            <span className="text-xs font-semibold text-zinc-500">{i + 1}</span>
          </button>
        ))}

        <button
          type="button"
          onClick={onAddRider}
          aria-label="Add additional rider"
          className="flex flex-col items-center gap-0.5"
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-zinc-100 text-2xl leading-none font-bold text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500">
            +
          </span>
          <span className="w-14 text-xs font-semibold text-zinc-500">Additional Rider</span>
        </button>
      </div>
    </div>
  );
}

function PausedContent() {
  return (
    <h1 className="font-heading text-5xl font-black tracking-tight text-zinc-500">
      Route Paused
    </h1>
  );
}
