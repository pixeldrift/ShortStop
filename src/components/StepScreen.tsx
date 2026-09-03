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
  onToggleRider,
  onCheckAll,
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
  onToggleRider: (index: number) => void;
  onCheckAll: () => void;
  onAddRider: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col overflow-hidden select-none">
      {/* Map - upper third of the screen. Placeholder art only; not a
          real map yet. */}
      <div className="relative h-[33vh] shrink-0 overflow-hidden">
        <Image
          src="/assets/map-placeholder.jpg"
          alt=""
          fill
          className="object-cover"
          priority
        />
        <div className="absolute inset-0 flex items-center justify-center bg-black/45 p-3 text-center">
          <p className="text-sm font-semibold text-white">
            Demo only placeholder, not actual map
          </p>
        </div>
      </div>

      {/* Pinned header: always visible, doesn't scroll away */}
      <div className="shrink-0 px-4 pt-3">
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
          ) : step.kind === "stop" ? (
            <StopContent
              step={step}
              stopNumber={stopNumber}
              roster={roster}
              onToggleRider={onToggleRider}
              onCheckAll={onCheckAll}
              onAddRider={onAddRider}
            />
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
          aria-label="Next"
          className="btn-glossy font-heading flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-blue-600 py-4 text-lg font-semibold text-white disabled:opacity-40"
        >
          Next <TriangleIcon direction="right" className="h-6 w-6" />
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

function StopContent({
  step,
  stopNumber,
  roster,
  onToggleRider,
  onCheckAll,
  onAddRider,
}: {
  step: NavigationStep;
  stopNumber: number | null;
  roster: boolean[];
  onToggleRider: (index: number) => void;
  onCheckAll: () => void;
  onAddRider: () => void;
}) {
  return (
    <>
      <div className="relative">
        <Image src="/assets/pin.png" alt="" width={350} height={548} className="h-28 w-auto sm:h-36" />
        {stopNumber && (
          <span className="font-heading absolute top-[30%] left-1/2 -translate-x-1/2 -translate-y-1/2 text-2xl font-black text-red-700 sm:text-3xl">
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

      {roster.length > 0 && (
        <div
          className="flex w-full max-w-sm flex-col items-center gap-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-700"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
            {roster.filter(Boolean).length} of {roster.length} checked in - tap a rider to check them in
          </p>

          <div className="flex flex-wrap justify-center gap-2">
            {roster.map((checked, i) => (
              <button
                key={i}
                type="button"
                onClick={() => onToggleRider(i)}
                aria-pressed={checked}
                aria-label={`Rider ${i + 1}${checked ? ", checked in" : ", not checked in"}`}
                className={
                  "flex h-11 w-11 items-center justify-center rounded-full transition-colors " +
                  (checked
                    ? "bg-green-600 text-white"
                    : "bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500")
                }
              >
                {checked ? (
                  <PersonSolidIcon className="h-6 w-6" />
                ) : (
                  <PersonIcon className="h-6 w-6" />
                )}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCheckAll}
              className="btn-glossy rounded-lg bg-zinc-700 px-3 py-2 text-sm font-semibold text-white"
            >
              Check All
            </button>
            <button
              type="button"
              onClick={onAddRider}
              aria-label="Add unexpected rider"
              className="btn-glossy flex h-9 w-9 items-center justify-center rounded-full bg-zinc-700 text-xl leading-none font-bold text-white"
            >
              +
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function PausedContent() {
  return (
    <h1 className="font-heading text-5xl font-black tracking-tight text-zinc-500">
      Route Paused
    </h1>
  );
}
