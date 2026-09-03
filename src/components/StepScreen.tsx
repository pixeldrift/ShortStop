import Image from "next/image";
import { useState } from "react";
import { RouteProgressBar } from "./RouteProgressBar";
import { StepTransition } from "./StepTransition";
import { TopBar } from "./TopBar";
import { PauseIcon, PersonSolidIcon, RoundedTriangleIcon, TriangleIcon, TurnArrow } from "./icons";
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
  onEndRoute,
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
  onEndRoute: () => void;
  roster: boolean[];
  totalOnboard: number;
  onRiderTap: (index: number) => void;
  onAddRider: () => void;
}) {
  const isStop = step.kind === "stop";
  const showRoster = !paused && isStop && roster.length > 0;

  // The map only gives up its own space when the current step's street
  // name genuinely can't fit its two-line baseline (useFitLines's own
  // shrink-fallback engaging) - not just because the viewport is short.
  // Otherwise the map stayed needlessly small on ordinary steps, with
  // room to spare below it that was never actually being used, and it
  // was cramping the rider check-in card for no reason.
  const [textOverflowed, setNeedsMoreRoom] = useState(false);
  const needsMoreRoom = !paused && textOverflowed;

  return (
    <div className="flex flex-1 flex-col overflow-hidden select-none landscape:flex-row">
      {/* Top third of the screen in portrait / left column in landscape -
          always reserved at the same size so nothing else ever shifts.
          Normally the map; on a stop with expected riders, the check-in
          box takes this spot instead. */}
      <div
        className={
          "relative h-[30vh] w-full overflow-hidden landscape:h-full landscape:min-h-0 landscape:shrink-0 landscape:w-[42%] " +
          (needsMoreRoom ? "min-h-[4.5rem] shrink" : "shrink-0")
        }
      >
        <Image src="/assets/map-placeholder.jpg" alt="" fill className="object-cover" priority />
        <div className="absolute inset-0 flex items-center justify-center bg-black/45 p-3 text-center">
          <p className="text-sm font-semibold text-white">
            Demo only placeholder, not actual map
          </p>
        </div>

        {showRoster && (
          <>
            {/* Dim the map rather than hiding it - the check-in card
                floats above it as its own smaller, opaque, shadowed
                panel, leaving the dimmed map visible all around it. */}
            <div className="absolute inset-0 bg-black/35" />
            <div className="absolute inset-0 flex items-center justify-center p-3">
              <div className="h-[78%] w-[86%]">
                <RiderCheckInBox
                  roster={roster}
                  onRiderTap={onRiderTap}
                  onAddRider={onAddRider}
                  onAdvance={onAdvance}
                />
              </div>
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
            <p className="font-heading text-sm font-black tracking-wide text-zinc-600">
              Stop {stopProgressNumber} of {totalStops}
            </p>
            <div className="flex items-center gap-1 rounded-full bg-zinc-100 px-2.5 py-1 text-sm font-bold text-zinc-700">
              <PersonSolidIcon className="h-4 w-4" />
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

          <StepTransition
            transitionKey={paused ? "paused" : `${step.id}`}
            className="flex flex-1 flex-col items-center justify-center text-center landscape:min-h-0"
          >
            {paused ? (
              <PausedContent />
            ) : isStop ? (
              <StopContent step={step} stopNumber={stopNumber} onNeedsMoreRoom={setNeedsMoreRoom} />
            ) : (
              <TurnContent step={step} onNeedsMoreRoom={setNeedsMoreRoom} />
            )}
          </StepTransition>
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
            className="btn-glossy font-heading flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-zinc-300 bg-zinc-100 py-4 text-lg font-semibold disabled:opacity-40"
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
            onClick={isLastStep ? onEndRoute : onAdvance}
            disabled={paused}
            aria-label={isFirstStep ? "Start" : isLastStep ? "End" : "Next"}
            className="btn-glossy font-heading flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-blue-600 py-4 text-lg font-semibold text-white disabled:opacity-40"
          >
            {isFirstStep ? "Start" : isLastStep ? "End" : "Next"}{" "}
            <TriangleIcon direction="right" className="h-6 w-6" />
          </button>
        </div>
      </div>
    </div>
  );
}

function TurnContent({
  step,
  onNeedsMoreRoom,
}: {
  step: NavigationStep;
  onNeedsMoreRoom: (needsMore: boolean) => void;
}) {
  const subheadingRef = useFitLines<HTMLParagraphElement>(step.subheading, 2, 0.55, onNeedsMoreRoom);

  return (
    <>
      {step.direction ? (
        <TurnArrow
          direction={step.direction}
          className="h-[clamp(3.5rem,14vh,8rem)] w-[clamp(3.5rem,14vh,8rem)]"
        />
      ) : (
        <h1 className="font-heading text-[clamp(1.25rem,4vh,2.25rem)] font-black tracking-tight">
          {step.heading}
        </h1>
      )}

      {step.subheading && (
        <p
          ref={subheadingRef}
          className="font-heading min-h-[2.5em] text-[clamp(1.35rem,5.25vh,2.75rem)] leading-tight font-black tracking-tight"
        >
          {step.subheading}
        </p>
      )}

      {step.distance && (
        <p className="text-[clamp(0.875rem,2.5vh,1.25rem)] text-zinc-500">{step.distance}</p>
      )}

      {/* Always rendered, even with no note, so the space is reserved
          and nothing else shifts depending on whether this step has
          one. */}
      <p className="min-h-[1.4em] px-3 text-sm text-zinc-500">{step.specialInstruction}</p>
    </>
  );
}

function StopContent({
  step,
  stopNumber,
  onNeedsMoreRoom,
}: {
  step: NavigationStep;
  stopNumber: number | null;
  onNeedsMoreRoom: (needsMore: boolean) => void;
}) {
  const subheadingRef = useFitLines<HTMLParagraphElement>(step.subheading, 2, 0.55, onNeedsMoreRoom);

  return (
    <>
      <div className="relative shrink-0">
        <Image
          src="/assets/pin.png"
          alt=""
          width={350}
          height={548}
          className="h-[clamp(3.5rem,14vh,8rem)] w-auto"
        />
        {stopNumber && (
          <span className="font-heading absolute top-[31%] left-1/2 -translate-x-1/2 -translate-y-1/2 text-[clamp(1.25rem,4.5vh,2.5rem)] font-black text-red-700">
            {stopNumber}
          </span>
        )}
        {step.sideOfRoad && (
          <RoundedTriangleIcon
            direction={step.sideOfRoad.toLowerCase() === "left" ? "left" : "right"}
            className={
              "absolute top-[31%] h-[clamp(1.75rem,6vh,3rem)] w-[clamp(0.875rem,3vh,1.5rem)] -translate-y-1/2 text-[#d54e48] " +
              (step.sideOfRoad.toLowerCase() === "left" ? "right-full mr-1.5" : "left-full ml-1.5")
            }
          />
        )}
      </div>

      {step.subheading && (
        <p
          ref={subheadingRef}
          className="font-heading min-h-[2.5em] text-[clamp(1.35rem,5.25vh,2.75rem)] leading-tight font-black tracking-tight"
        >
          {step.subheading}
        </p>
      )}

      {/* Always rendered, even with no note, so the space is reserved
          and nothing else shifts depending on whether this stop has
          one. */}
      <p className="min-h-[1.4em] px-3 text-sm text-zinc-500">{step.specialInstruction}</p>
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
      className="flex h-full w-full flex-col items-center justify-center gap-3 overflow-hidden rounded-xl border border-zinc-200 bg-[var(--background)] p-3 shadow-lg"
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
                "flex h-11 w-11 items-center justify-center rounded-full border-2 border-blue-600 transition-colors " +
                (checked ? "bg-blue-600 text-white" : "bg-zinc-100 text-zinc-400")
              }
            >
              <PersonSolidIcon className="h-6 w-6" />
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
          <span className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-blue-600 bg-zinc-100 text-2xl leading-none font-bold text-zinc-400">
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
