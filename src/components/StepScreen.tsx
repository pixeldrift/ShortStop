import Image from "next/image";
import { useMemo, useState } from "react";
import { RouteMap } from "./RouteMap";
import type { StopMarker } from "./RouteMap";
import { RouteProgressBar } from "./RouteProgressBar";
import { StepTransition } from "./StepTransition";
import { TopBar } from "./TopBar";
import {
  CheckCircleIcon,
  MapPinIcon,
  PauseIcon,
  PersonSolidIcon,
  RoundedTriangleIcon,
  TriangleIcon,
  TurnArrow,
} from "./icons";
import { stepsCsvBaseName } from "@/lib/parseRouteMasterList";
import { useFitGrid } from "@/lib/useFitGrid";
import { useFitLines } from "@/lib/useFitLines";
import type { SeekTarget, StepPhase } from "@/lib/useRouteStepper";
import type { NavigationStep, Route } from "@/lib/types";

export function StepScreen({
  route,
  step,
  stepNumber,
  stopNumber,
  stopProgressNumber,
  totalStops,
  phase,
  paused,
  onAdvance,
  onBack,
  onSeek,
  onTogglePause,
  onEndRoute,
  onLogoClick,
  announcementDone,
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
  phase: StepPhase;
  paused: boolean;
  onAdvance: () => void;
  onBack: () => void;
  onSeek: (target: SeekTarget) => void;
  onTogglePause: () => void;
  onEndRoute: () => void;
  onLogoClick: () => void;
  announcementDone: boolean;
  roster: boolean[];
  totalOnboard: number;
  onRiderTap: (index: number) => void;
  onAddRider: () => void;
}) {
  // Only a real "step" phase step can be a stop with riders to check in -
  // the depot/arrived virtual states never show the roster card, even if
  // route.steps[0] or the last step happens to be a stop.
  const isStop = phase === "step" && step.kind === "stop";
  // Held off until the stop's own announcement has finished speaking, so
  // the check-in card doesn't pop up over top of still-playing audio.
  const showRoster = !paused && isStop && roster.length > 0 && announcementDone;
  // Memoized against `route` (unchanged for the whole trip) rather
  // than recomputed every render - RouteMap only reads this once per
  // mount (see its own stopsRef note), but a fresh array reference
  // every render would still be visible to it as a changed prop.
  const stopMarkers = useMemo<StopMarker[]>(() => {
    let stopCount = 0;
    return route.steps
      .filter((s) => s.kind === "stop")
      .map((s) => ({ waypointKey: s.waypointKey, number: ++stopCount }));
  }, [route]);
  // This route's own sidecar waypoint cache - computed from the same
  // routeNumber/tripType/schoolLevel naming convention its steps CSV
  // itself uses (see stepsCsvBaseName, parseRouteMasterList.ts), so
  // RouteMap doesn't need a separate per-route lookup table to find it.
  const waypointsUrl = useMemo(() => `/data/${stepsCsvBaseName(route)}-waypoints.json`, [route]);
  // Guards the logo's exit-to-home tap, not the footer "End" button -
  // "End" only ever appears once the route is already finished
  // (arrived phase), so there's nothing left to lose by confirming it.
  // The logo is reachable mid-route, though, where tapping it resets
  // the whole trip (check-in progress included), so *that's* the one
  // that gets a deliberate second tap - skipped once arrived, for the
  // same "already finished" reason "End" skips it.
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const handleLogoClick = () => {
    if (phase === "arrived") {
      onLogoClick();
    } else {
      setShowEndConfirm(true);
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden select-none landscape:flex-row">
      {/* Top third of the screen in portrait / left column in landscape -
          always reserved at the same, fixed size (~30% of the viewport
          height) so nothing else ever shifts and the map never gets
          condensed. Normally the map; on a stop with expected riders,
          the check-in box takes this spot instead - if it has more
          riders than fit at their baseline size, the bubbles shrink to
          fit (see RiderCheckInBox) rather than the map giving up space
          for them. The rest of the column (street name, footer) makes
          room for itself independently, via its own two-line text
          guarantee and shrink-if-crazy-long fallback - see StopContent/
          TurnContent below - rather than by the map yielding space. */}
      <div className="relative h-[calc(30vh-20px)] w-full shrink-0 overflow-hidden landscape:h-[calc(100%-20px)] landscape:w-[42%]">
        {/* z-0 gives Leaflet's own internal panes/controls (tile pane,
            zoom control, attribution - several of which carry their own
            explicit, fairly high z-index, e.g. the zoom control's 1000) a
            stacking context of their own to escalate within. Without it,
            since neither this div nor its parent set a z-index, those
            panes escape to the nearest ancestor stacking context and can
            paint above the roster popup below despite being earlier in
            the DOM.

            The map itself is drawn 20px taller than this container
            (h-[calc(100%+20px)], pinned to the top) rather than filling
            it exactly (inset-0) - this container is itself already 20px
            shorter than it used to be, so the map ends up rendered at
            its original size but with its own bottom 20px clipped off
            by this container's overflow-hidden, instead of the whole
            map simply shrinking to match. */}
        <RouteMap
          className="absolute inset-x-0 top-0 z-0 h-[calc(100%+20px)]"
          stops={stopMarkers}
          waypointsUrl={waypointsUrl}
        />

        {showRoster && (
          <>
            {/* Dim the map rather than hiding it - the check-in card
                floats above it as its own smaller, opaque, shadowed
                panel, leaving the dimmed map visible all around it.
                z-10 keeps both above the map's own stacking context
                (see the z-0 note on RouteMap above). */}
            <div className="absolute inset-0 z-10 bg-black/35" />
            <div className="absolute inset-0 z-10 flex items-center justify-center p-3">
              <div className="animate-roster-pop h-[78%] w-[86%]">
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
        <div className="shrink-0 px-4 pt-1.5">
          <TopBar
            routeNumber={route.routeNumber}
            busNumber={route.busNumber}
            tripType={route.tripType}
            onLogoClick={handleLogoClick}
            stopProgressNumber={stopProgressNumber}
            totalStops={totalStops}
            totalOnboard={totalOnboard}
          />
        </div>

        {/* Remaining space: progress bar + step content. No scrolling -
            this area's own content is sized (via clamp()) to fit
            whatever space is left after the regions above/below it,
            which matters most on the tablet-landscape viewports this is
            built for. No gap between the progress bar and the step
            content below it - the step-content box's top edge needs to
            sit flush against the progress bar's own bottom edge, not a
            few px below it, so an exiting step (see StepTransition)
            gets clipped right at that shared edge instead of visibly
            vanishing into a gap first - that reads as sliding underneath
            the bar rather than just disappearing. */}
        <div
          className="flex flex-1 touch-manipulation flex-col px-3 pt-2 pb-1 landscape:min-h-0 landscape:overflow-hidden"
          onClick={() => !paused && onAdvance()}
        >
          <RouteProgressBar
            steps={route.steps}
            currentIndex={stepNumber - 1}
            phase={phase}
            onSeek={onSeek}
            disabled={paused}
          />

          <StepTransition
            transitionKey={
              paused ? "paused" : phase === "step" ? `${step.id}` : phase
            }
            className="flex flex-1 flex-col items-center justify-center text-center landscape:min-h-0"
          >
            {paused ? (
              <PausedContent />
            ) : phase === "depot" ? (
              <DepotContent route={route} />
            ) : phase === "arrived" ? (
              <ArrivedContent />
            ) : isStop ? (
              <StopContent step={step} stopNumber={stopNumber} />
            ) : (
              <TurnContent step={step} />
            )}
          </StepTransition>
        </div>

        {/* Footer - pinned */}
        <div
          className="flex w-full max-w-md shrink-0 items-center gap-3 self-center px-4 pt-0 pb-3"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={onBack}
            disabled={phase === "depot" || paused}
            aria-label="Back"
            className="btn-glossy font-heading flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-zinc-500 bg-zinc-300 py-3 text-lg font-semibold text-zinc-900 disabled:opacity-40"
          >
            <TriangleIcon direction="left" className="h-6 w-6" /> Back
          </button>

          <button
            type="button"
            onClick={onTogglePause}
            aria-label={paused ? "Resume route" : "Pause route"}
            className="btn-glossy flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-zinc-500 bg-zinc-300 text-zinc-900"
          >
            {paused ? (
              <TriangleIcon direction="right" className="h-6 w-6" />
            ) : (
              <PauseIcon className="h-6 w-6" />
            )}
          </button>

          <button
            type="button"
            onClick={phase === "arrived" ? onEndRoute : onAdvance}
            disabled={paused}
            aria-label={phase === "depot" ? "Start" : phase === "arrived" ? "End" : "Next"}
            className="btn-glossy font-heading flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-blue-600 py-3 text-lg font-semibold text-white disabled:opacity-40"
          >
            {phase === "depot" ? "Start" : phase === "arrived" ? "End" : "Next"}{" "}
            <TriangleIcon direction="right" className="h-6 w-6" />
          </button>
        </div>
      </div>

      {showEndConfirm && (
        <LeaveRouteConfirmModal
          onConfirm={() => {
            setShowEndConfirm(false);
            onLogoClick();
          }}
          onCancel={() => setShowEndConfirm(false)}
        />
      )}
    </div>
  );
}

/** Guards the logo's exit-to-home tap while a route's still in
 * progress (see handleLogoClick above) - unlike Back/Next/Pause, it
 * resets the whole trip and can't be walked back. A plain full-screen
 * overlay (fixed inset-0) rather than something scoped to StepScreen's
 * own box, so it isn't affected by the landscape/portrait split above
 * it. */
function LeaveRouteConfirmModal({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-20 flex items-center justify-center bg-black/50 p-6"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-xl bg-[var(--background)] p-5 text-center shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-heading text-xl font-black tracking-tight">
          Are you sure you want to end this route?
        </h2>

        <div className="mt-4 flex gap-3">
          <button
            type="button"
            onClick={onConfirm}
            className="btn-glossy font-heading flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-zinc-500 bg-zinc-300 py-3 text-lg font-semibold text-zinc-900"
          >
            <TriangleIcon direction="left" className="h-6 w-6" /> End Route
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="btn-glossy font-heading flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-blue-600 py-3 text-lg font-semibold text-white"
          >
            Return <TriangleIcon direction="right" className="h-6 w-6" />
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
          className="h-[clamp(3.25rem,12vh,8rem)] w-[clamp(3.25rem,12vh,8rem)]"
        />
      ) : (
        <h1 className="font-heading text-[clamp(1.25rem,4vh,2.25rem)] font-black tracking-tight">
          {step.heading}
        </h1>
      )}

      {step.subheading && (
        <p
          ref={subheadingRef}
          className="font-heading min-h-[2.5em] text-[clamp(1.25rem,4.5vh,2.75rem)] leading-tight font-black tracking-tight"
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
}: {
  step: NavigationStep;
  stopNumber: number | null;
}) {
  const subheadingRef = useFitLines<HTMLParagraphElement>(step.subheading, 2);

  return (
    <>
      <div className="relative shrink-0">
        <Image
          src="/assets/pin.png"
          alt=""
          width={350}
          height={548}
          className="h-[clamp(3.25rem,12vh,8rem)] w-auto"
        />
        {stopNumber && (
          <span className="font-heading absolute top-[31%] left-1/2 -translate-x-1/2 -translate-y-1/2 text-[clamp(1.15rem,3.75vh,2.5rem)] font-black text-red-700">
            {stopNumber}
          </span>
        )}
        {step.sideOfRoad && (
          <RoundedTriangleIcon
            direction={step.sideOfRoad.toLowerCase() === "left" ? "left" : "right"}
            className={
              "absolute top-[31%] h-[clamp(1.6rem,5vh,3rem)] w-[clamp(0.8rem,2.5vh,1.5rem)] -translate-y-1/2 text-[#d54e48] " +
              (step.sideOfRoad.toLowerCase() === "left" ? "right-full mr-1.5" : "left-full ml-1.5")
            }
          />
        )}
      </div>

      {step.subheading && (
        <p
          ref={subheadingRef}
          className="font-heading min-h-[2.5em] text-[clamp(1.25rem,4.5vh,2.75rem)] leading-tight font-black tracking-tight"
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
  // The map is a fixed size (doesn't condense to make room - see
  // StepScreen above), so a route with a lot of expected riders can
  // easily need more rows than this card has height for at the bubbles'
  // baseline size. Rather than let the bottom row clip, useFitGrid
  // shrinks --fit-scale until everything fits, down to a floor past
  // which a bubble would be too small to tap reliably.
  const fitRef = useFitGrid<HTMLDivElement>(roster.length, 0.6);

  return (
    <div
      ref={fitRef}
      className="flex h-full w-full flex-col items-center justify-center gap-[calc(0.75rem*var(--fit-scale,1))] overflow-hidden rounded-xl border border-zinc-200 bg-[var(--background)] p-3 shadow-lg"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex flex-wrap items-start justify-center gap-[calc(0.5rem*var(--fit-scale,1))]">
        {roster.map((checked, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onRiderTap(i)}
            aria-pressed={checked}
            aria-label={`Check in through rider ${i + 1}${checked ? " (checked in)" : ""}`}
            className="flex flex-col items-center gap-[calc(0.125rem*var(--fit-scale,1))]"
          >
            <span
              className={
                "flex h-[calc(2.75rem*var(--fit-scale,1))] w-[calc(2.75rem*var(--fit-scale,1))] items-center justify-center rounded-full border-2 border-blue-600 transition-colors " +
                (checked ? "bg-blue-600 text-white" : "bg-zinc-100 text-zinc-400")
              }
            >
              <PersonSolidIcon className="h-[calc(1.5rem*var(--fit-scale,1))] w-[calc(1.5rem*var(--fit-scale,1))]" />
            </span>
            <span className="text-[calc(0.75rem*var(--fit-scale,1))] font-semibold text-zinc-500">
              {i + 1}
            </span>
          </button>
        ))}

        <button
          type="button"
          onClick={onAddRider}
          aria-label="Add additional rider"
          className="flex flex-col items-center"
        >
          <span className="flex h-[calc(2.75rem*var(--fit-scale,1))] w-[calc(2.75rem*var(--fit-scale,1))] items-center justify-center rounded-full border-2 border-blue-600 bg-zinc-100 text-[calc(1.5rem*var(--fit-scale,1))] leading-none font-bold text-zinc-400">
            +
          </span>
        </button>
      </div>

      <button
        type="button"
        onClick={onAdvance}
        aria-label="Continue route"
        className="btn-glossy font-heading flex items-center justify-center rounded-xl bg-blue-600 px-6 py-2 text-sm font-semibold text-white"
      >
        OK
      </button>
    </div>
  );
}

/** The "depot" virtual state - before the first real step. The bus sits
 * on the start cul-de-sac (RouteProgressBar) while this generic content
 * shows in place of any actual turn/stop, so step 0's own directions
 * only appear once "Start" is tapped. */
function DepotContent({ route }: { route: Route }) {
  return (
    <>
      <Image
        src="/assets/bus.png"
        alt=""
        width={780}
        height={465}
        className="h-[clamp(3.25rem,12vh,8rem)] w-auto drop-shadow-sm"
      />
      <h1 className="font-heading text-[clamp(1.5rem,5vh,2.75rem)] font-black tracking-tight">
        Ready to Depart
      </h1>
      <p className="flex items-center gap-1 text-[clamp(0.875rem,2.5vh,1.25rem)] text-zinc-500">
        <MapPinIcon className="h-[0.9em] w-[0.9em] shrink-0 text-blue-500" />
        {route.schoolAddress}
      </p>
    </>
  );
}

/** The "arrived" virtual state - after the last real step. The bus stays
 * on the end cul-de-sac; "Route completed"/"Route ended" is deliberately
 * *not* spoken here - only tapping "End" (onEndRoute) announces it. */
function ArrivedContent() {
  return (
    <>
      <CheckCircleIcon className="h-[clamp(3.25rem,12vh,8rem)] w-[clamp(3.25rem,12vh,8rem)] text-blue-600" />
      <h1 className="font-heading text-[clamp(1.5rem,5vh,2.75rem)] font-black tracking-tight">
        All Stops Complete
      </h1>
      <p className="text-[clamp(0.875rem,2.5vh,1.25rem)] text-zinc-500">
        Press End to finish the route.
      </p>
    </>
  );
}

function PausedContent() {
  return (
    <h1 className="font-heading text-[clamp(1.75rem,7vh,3rem)] font-black tracking-tight text-zinc-500">
      Route Paused
    </h1>
  );
}
