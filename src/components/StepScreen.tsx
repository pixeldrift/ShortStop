import Image from "next/image";
import { RouteProgressBar } from "./RouteProgressBar";
import { TopBar } from "./TopBar";
import { PauseIcon, PersonIcon, PersonSolidIcon, TriangleIcon, TurnArrow } from "./icons";
import { useFitLines } from "@/lib/useFitLines";
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
    <div className="flex flex-1 flex-col overflow-hidden select-none landscape:flex-row">
      {/* Top third of the screen in portrait / left column in landscape -
          always reserved at the same size so nothing else ever shifts.
          Normally the map; on a stop with expected riders, the check-in
          box takes this spot instead. */}
      <div className="relative h-[30vh] w-full min-h-[4.5rem] shrink overflow-hidden landscape:h-full landscape:min-h-0 landscape:shrink-0 landscape:w-[42%]">
        <Image src="/assets/map-placeholder.jpg" alt="" fill className="object-cover" priority />
        <div className="absolute inset-0 flex items-center justify-center bg-black/45 p-3 text-center">
          <p className="text-sm font-semibold text-white">
            Demo only placeholder, not actual map
          </p>
        </div>

        {showRoster && (
          <>
            {/* Dim the map rather than hiding it - the check-in card
                floats above it as its own opaque, shadowed panel. */}
            <div className="absolute inset-0 bg-black/35" />
            <div className="absolute inset-0 p-3">
              <RiderCheckInBox
                roster={roster}
                onRiderTap={onRiderTap}
                onAddRider={onAddRider}
                onAdvance={onAdvance}
              />
            </div>
          </>
        )}
      </div>

      {/* Glossy blue divider between the map/rider region and the rest of
          the pane - a horizontal bar in portrait, vertical in landscape. */}
      <div className="btn-glossy h-1.5 w-full shrink-0 bg-blue-600 landscape:h-full landscape:w-1.5" />

      {/* Everything else - stacked below the top third in portrait, to its
          right (its own column) in landscape. */}
      <div className="flex min-w-0 flex-1 flex-col landscape:min-h-0 landscape:overflow-hidden">
        {/* Pinned header: always visible, doesn't scroll away */}
        <div className="shrink-0 px-4 pt-2">
          <TopBar routeNumber={route.routeNumber} busNumber={route.busNumber} />

          <div className="mt-1 flex items-center justify-between">
            <p className="text-xs font-semibold tracking-wide text-zinc-500">
              Stop {stopProgressNumber} of {totalStops}
            </p>
            <div className="flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              <PersonSolidIcon className="h-3 w-3" />
              {totalOnboard} onboard
            </div>
          </div>
        </div>

        {/* Remaining space: progress bar + step content. No scrolling -
            this area's own content is sized (via clamp()) to fit
            whatever space is left after the regions above/below it,
            which matters most on the tablet-landscape viewports this is
            built for. */}
        <div
          className="flex flex-1 touch-manipulation flex-col gap-2 p-3 landscape:min-h-0 landscape:overflow-hidden"
          onClick={() => !paused && onAdvance()}
        >
          <RouteProgressBar steps={route.steps} currentIndex={stepNumber - 1} />

          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center landscape:min-h-0">
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
            {paused ? (
              <TriangleIcon direction="right" className="h-6 w-6" />
            ) : (
              <PauseIcon className="h-6 w-6" />
            )}
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
    </div>
  );
}

function TurnContent({ step }: { step: NavigationStep }) {
  const subheadingRef = useFitLines<HTMLParagraphElement>(step.subheading, 2);

  return (
    <>
      {step.direction ? (
        <TurnArrow
          direction={step.direction}
          className="h-[clamp(4rem,16vh,9rem)] w-[clamp(4rem,16vh,9rem)]"
        />
      ) : (
        <h1 className="font-heading text-[clamp(1.25rem,4vh,2.25rem)] font-black tracking-tight">
          {step.heading}
        </h1>
      )}

      {step.subheading && (
        <p
          ref={subheadingRef}
          className="font-heading min-h-[2.5em] text-[clamp(1.5rem,6vh,3.25rem)] leading-tight font-black tracking-tight"
        >
          {step.subheading}
        </p>
      )}

      {step.distance && (
        <p className="text-[clamp(0.875rem,2.5vh,1.25rem)] text-zinc-500">{step.distance}</p>
      )}

      {step.specialInstruction && (
        <p className="rounded-lg bg-yellow-400/20 px-3 py-2 text-sm">{step.specialInstruction}</p>
      )}
    </>
  );
}

function StopContent({ step, stopNumber }: { step: NavigationStep; stopNumber: number | null }) {
  const subheadingRef = useFitLines<HTMLParagraphElement>(step.subheading, 2);

  return (
    <>
      <div className="relative shrink-0">
        <Image
          src="/assets/pin.png"
          alt=""
          width={350}
          height={548}
          className="h-[clamp(4rem,16vh,9rem)] w-auto"
        />
        {stopNumber && (
          <span className="font-heading absolute top-[31%] left-1/2 -translate-x-1/2 -translate-y-1/2 text-[clamp(1.25rem,4.5vh,2.5rem)] font-black text-red-700">
            {stopNumber}
          </span>
        )}
      </div>

      {step.subheading && (
        <p
          ref={subheadingRef}
          className="font-heading min-h-[2.5em] text-[clamp(1.5rem,6vh,3.25rem)] leading-tight font-black tracking-tight"
        >
          {step.subheading}
        </p>
      )}

      {step.sideOfRoad && (
        <p className="text-[clamp(0.75rem,2vh,1rem)] text-zinc-500">
          Stop on the {step.sideOfRoad.toLowerCase()} side
        </p>
      )}

      {step.specialInstruction && (
        <p className="rounded-lg bg-yellow-400/20 px-3 py-2 text-sm">{step.specialInstruction}</p>
      )}
    </>
  );
}

function RiderCheckInBox({
  roster,
  onRiderTap,
  onAddRider,
  onAdvance,
}: {
  roster: boolean[];
  onRiderTap: (index: number) => void;
  onAddRider: () => void;
  onAdvance: () => void;
}) {
  return (
    <div
      className="flex h-full w-full flex-col items-center justify-center gap-3 overflow-hidden rounded-xl border border-zinc-200 bg-[var(--background)] p-3 shadow-lg dark:border-zinc-700"
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

      <button
        type="button"
        onClick={onAdvance}
        aria-label="Continue route"
        className="btn-glossy font-heading flex items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white"
      >
        Resume Route <TriangleIcon direction="right" className="h-4 w-4" />
      </button>
    </div>
  );
}

function PausedContent() {
  return (
    <h1 className="font-heading text-[clamp(1.75rem,7vh,3rem)] font-black tracking-tight text-zinc-500">
      Route Paused
    </h1>
  );
}
