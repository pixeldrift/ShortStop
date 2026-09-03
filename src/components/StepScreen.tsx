import Image from "next/image";
import { RouteProgressBar } from "./RouteProgressBar";
import { TopBar } from "./TopBar";
import { PauseIcon, PersonIcon, TriangleIcon, TurnArrow } from "./icons";
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
}) {
  return (
    <div
      className="flex flex-1 touch-manipulation flex-col gap-3 p-4 select-none"
      onClick={() => !paused && onAdvance()}
    >
      <TopBar routeNumber={route.routeNumber} busNumber={route.busNumber} />

      <p className="text-center text-xs font-semibold tracking-wide text-zinc-500">
        Stop {stopProgressNumber} of {totalStops}
      </p>

      <RouteProgressBar steps={route.steps} currentIndex={stepNumber - 1} />

      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        {paused ? (
          <PausedContent />
        ) : step.kind === "stop" ? (
          <StopContent step={step} stopNumber={stopNumber} totalStops={totalStops} />
        ) : (
          <TurnContent step={step} />
        )}
      </div>

      <div
        className="flex w-full max-w-md items-center gap-3 self-center"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onBack}
          disabled={isFirstStep || paused}
          aria-label="Back"
          className="btn-glossy font-heading flex flex-1 items-center justify-center gap-1 rounded-xl border border-zinc-300 bg-zinc-100 py-4 text-lg font-semibold disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-800"
        >
          <TriangleIcon direction="left" className="h-4 w-4" /> Back
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
          className="btn-glossy font-heading flex flex-1 items-center justify-center gap-1 rounded-xl bg-blue-600 py-4 text-lg font-semibold text-white disabled:opacity-40"
        >
          Next <TriangleIcon direction="right" className="h-4 w-4" />
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
  totalStops,
}: {
  step: NavigationStep;
  stopNumber: number | null;
  totalStops: number;
}) {
  return (
    <>
      {stopNumber && (
        <p className="text-sm font-semibold tracking-wide text-zinc-500">
          STOP {stopNumber} OF {totalStops}
        </p>
      )}

      <Image src="/assets/pin.png" alt="" width={350} height={548} className="h-28 w-auto sm:h-36" />

      {step.subheading && (
        <p className="font-heading text-5xl leading-tight font-black tracking-tight sm:text-6xl">
          {step.subheading}
        </p>
      )}

      {step.studentCount != null && (
        <div className="flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-lg font-semibold text-blue-900 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-100">
          <PersonIcon className="h-5 w-5" />
          {step.studentCount} Rider{step.studentCount === 1 ? "" : "s"} Expected
          {step.pickupOrDropoff && ` · ${step.pickupOrDropoff}`}
        </div>
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

function PausedContent() {
  return (
    <h1 className="font-heading text-5xl font-black tracking-tight text-zinc-500">
      Route Paused
    </h1>
  );
}
