import Image from "next/image";
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { RouteMap } from "./RouteMap";
import type { StopMarker, TurnMarker } from "./RouteMap";
import { RouteProgressBar } from "./RouteProgressBar";
import { StepTransition } from "./StepTransition";
import { TopBar } from "./TopBar";
import {
  ActionIcon,
  CheckCircleIcon,
  CheckIcon,
  MapPinIcon,
  PauseIcon,
  PersonSolidIcon,
  RoundedTriangleIcon,
  TriangleIcon,
  TurnArrow,
} from "./icons";
import { addressWithoutZip } from "@/lib/schoolAddress";
import { useFitGrid } from "@/lib/useFitGrid";
import { useFitLines } from "@/lib/useFitLines";
import type { SeekTarget, StepPhase } from "@/lib/useRouteStepper";
import type { NavigationStep, Route, TripType } from "@/lib/types";

// How long the depot bus's own slide-off animation runs (matches
// animate-bus-depart in globals.css) - handleStart below holds off the
// real onAdvance for exactly this long so the bus is fully off screen,
// not cut short, before the step actually changes underneath it.
const BUS_DEPART_MS = 450;

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
  // Set by the roster card's own "OK" (closes the card without also
  // advancing to the next stop - see RiderCheckInBox's onClose below).
  // Keyed by step id rather than a plain boolean so it resets itself the
  // moment the driver actually moves to a different step, without a
  // separate effect to clear it - this step's own id simply stops
  // matching once `step` changes.
  const [dismissedStepId, setDismissedStepId] = useState<number | null>(null);
  // Held off until the stop's own announcement has finished speaking, so
  // the check-in card doesn't pop up over top of still-playing audio.
  const showRoster =
    !paused && isStop && roster.length > 0 && announcementDone && dismissedStepId !== step.id;
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
  // Every turn's own "<preceding stop>.<turn count since that stop>"
  // label - the turns before the route's first stop count as stop 0
  // (so its first turn reads "0.1"), and the count resets to 1 right
  // after each stop (so the third turn after stop 5 reads "5.3").
  // Empty for a stops-only steps sheet (every 120 route today) - there
  // are simply no "turn" kind steps to map over.
  const turnMarkers = useMemo<TurnMarker[]>(() => {
    let stopCount = 0;
    let turnCount = 0;
    const markers: TurnMarker[] = [];
    for (const step of route.steps) {
      if (step.kind === "stop") {
        stopCount += 1;
        turnCount = 0;
      } else if (step.kind === "turn") {
        turnCount += 1;
        markers.push({ waypointKey: step.waypointKey, label: `${stopCount}.${turnCount}` });
      }
    }
    return markers;
  }, [route]);
  // Every step's own waypointKey, in the route's own order - RouteMap
  // uses whichever of these are actually geocoded to request a real,
  // road-following line from /api/route-geometry (its own `path` prop
  // doc comment has the details, including where the school - passed
  // separately below - fits into that same ordered list).
  const routePath = useMemo(() => route.steps.map((s) => s.waypointKey), [route]);
  // The school's own geocoded location (School.lat/lon), straight from
  // the route - not a Waypoint cache lookup, so changing a route's
  // school (EditRouteScreen) always shows the right pin immediately,
  // with no separate "fetch location" step needed for the school pin
  // itself (see RouteMap's own `school` prop doc comment).
  const schoolPoint = useMemo(
    () => (route.schoolLat != null && route.schoolLon != null ? { lat: route.schoolLat, lon: route.schoolLon } : null),
    [route.schoolLat, route.schoolLon],
  );
  // The geocode cache, shared across every route now that it lives in
  // Postgres (see src/app/api/waypoints) rather than split into a
  // sidecar file per route - RouteMap looks its own stops up from this
  // by key regardless, so a shared URL is a drop-in replacement.
  const waypointsUrl = "/api/waypoints";
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

  // Fun send-off for the one moment there's actually a bus graphic to
  // send off with - pressing "Start" at the depot slides it away to the
  // right (see DepotContent's own bus Image, animate-bus-depart in
  // globals.css) before the real onAdvance actually fires, rather than
  // just cutting straight to the first step the instant it's tapped.
  // Guarded by the flag itself (not just `phase`) so a second tap mid-
  // animation can't double-fire the timeout/onAdvance.
  const [busDeparting, setBusDeparting] = useState(false);
  const handleStart = () => {
    if (busDeparting) return;
    setBusDeparting(true);
    window.setTimeout(() => {
      setBusDeparting(false);
      onAdvance();
    }, BUS_DEPART_MS);
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
          turns={turnMarkers}
          path={routePath}
          school={schoolPoint}
          tripType={route.tripType}
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
              <RiderCheckInBox
                roster={roster}
                tripType={route.tripType}
                onRiderTap={onRiderTap}
                onAddRider={onAddRider}
                onClose={() => setDismissedStepId(step.id)}
              />
            </div>
          </>
        )}
      </div>

      {/* Glossy blue divider between the map/rider region and the rest of
          the pane - a horizontal bar in portrait, vertical in landscape. */}
      <div className="btn-glossy-blue h-1.5 w-full shrink-0 bg-blue-600 landscape:h-full landscape:w-1.5" />

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
            entering={busDeparting}
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
              <DepotContent route={route} departing={busDeparting} />
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
          {/* At "depot" there's no previous step to go back to - rather
              than just disabling this button there, it becomes another
              way back to the route list instead (the same, un-confirmed
              exit the logo takes once arrived - nothing's actually
              happened yet at depot, no steps or check-ins to lose, so
              this skips handleLogoClick's own "are you sure" gate
              rather than reusing it). */}
          <button
            type="button"
            onClick={phase === "depot" ? onLogoClick : onBack}
            disabled={paused}
            aria-label={phase === "depot" ? "Routes" : "Back"}
            className="btn-glossy-light font-heading flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-zinc-300 py-3 text-lg font-semibold text-zinc-900 disabled:opacity-40"
          >
            <TriangleIcon direction="left" className="h-6 w-6" />
            {phase === "depot" ? "Routes" : "Back"}
          </button>

          <button
            type="button"
            onClick={onTogglePause}
            aria-label={paused ? "Resume route" : "Pause route"}
            className="btn-glossy-light flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-zinc-300 text-zinc-900"
          >
            {paused ? (
              <TriangleIcon direction="right" className="h-6 w-6" />
            ) : (
              <PauseIcon className="h-6 w-6" />
            )}
          </button>

          <button
            type="button"
            onClick={phase === "depot" ? handleStart : phase === "arrived" ? onEndRoute : onAdvance}
            disabled={paused || busDeparting}
            aria-label={phase === "depot" ? "Start" : phase === "arrived" ? "End" : "Next"}
            className="btn-glossy-blue font-heading flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-blue-600 py-3 text-lg font-semibold text-white disabled:opacity-40"
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
        className="animate-popup-pop w-full max-w-sm rounded-xl bg-[var(--background)] p-5 text-center shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-heading text-xl font-black tracking-tight">
          Are you sure you want to end this route?
        </h2>

        <div className="mt-4 flex gap-3">
          <button
            type="button"
            onClick={onConfirm}
            className="btn-glossy-light font-heading flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-zinc-300 py-3 text-lg font-semibold text-zinc-900"
          >
            <TriangleIcon direction="left" className="h-6 w-6" /> End Route
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="btn-glossy-blue font-heading flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-blue-600 py-3 text-lg font-semibold text-white"
          >
            Return <TriangleIcon direction="right" className="h-6 w-6" />
          </button>
        </div>
      </div>
    </div>
  );
}

/** A cross-street subheading ("Main St & Oak Ave") only ever wraps
 * between the two road names (or around the "&" itself) - never
 * splitting either road's own, possibly multi-word name apart onto two
 * lines, which reads like a mistake more than a wrap. Each name is its
 * own `whitespace-nowrap` span so the browser's only remaining choice
 * of where to break is the space next to "&" - if everything fits on
 * one line it still does, this only constrains *where* a wrap can
 * happen, not whether one does. A turn's own subheading (a single
 * destination road, no "&") has nothing to split and passes through
 * unchanged. */
function RoadNames({ subheading }: { subheading: string }) {
  const parts = subheading.split(" & ");
  if (parts.length !== 2) return <>{subheading}</>;
  const [roadA, roadB] = parts;
  return (
    <>
      <span className="whitespace-nowrap">{roadA}</span>
      {" & "}
      <span className="whitespace-nowrap">{roadB}</span>
    </>
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
        <div className="flex flex-col items-center gap-1">
          {/* Every non-Left/Right action (Continue, Proceed, Pull Over,
              Depart, Arrive, ...) used to fall back to bare text with
              no icon at all, unlike a real left/right turn's own big
              TurnArrow - ActionIcon (icons.tsx) gives each one its own
              glyph instead, same mapping StepRowEditor's row list uses
              admin-side, so a driver and an admin read the same action
              the same way. */}
          <ActionIcon action={step.heading ?? ""} className="h-[clamp(2rem,7vh,4rem)] w-[clamp(2rem,7vh,4rem)]" />
          <h1 className="font-heading text-[clamp(1.25rem,4vh,2.25rem)] font-black tracking-tight">
            {step.heading}
          </h1>
        </div>
      )}

      {step.subheading && (
        <p
          ref={subheadingRef}
          className="font-heading min-h-[2.5em] text-[clamp(1.25rem,4.5vh,2.75rem)] leading-tight font-black tracking-tight"
        >
          <RoadNames subheading={step.subheading} />
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
              "absolute top-[31%] h-[clamp(2.1rem,6.5vh,4rem)] w-[clamp(1.05rem,3.25vh,2rem)] -translate-y-1/2 text-[#d54e48] " +
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
          <RoadNames subheading={step.subheading} />
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
  tripType,
  onRiderTap,
  onAddRider,
  onClose,
}: {
  roster: boolean[];
  /** Only ever used to pick "check in"/"check off" wording below - a
   * dropoff route's own riders all boarded back at the school, so
   * tapping through this same roster at each stop is really marking
   * who's gotten *off* it, not who's freshly on. */
  tripType: TripType;
  onRiderTap: (index: number) => void;
  onAddRider: () => void;
  /** Dismisses the card - the driver still has to tap the step content
   * itself (or Next) to actually advance, same as any other step. */
  onClose: () => void;
}) {
  const isDropoff = tripType === "dropoff";
  // Sized to its own content (a handful of riders shouldn't force a
  // card that fills most of the map, especially on a tablet's much
  // bigger map area) - max-h/max-w only cap it, they don't force it to
  // that size, so useFitGrid only has to shrink anything once a route
  // with a lot of expected riders actually needs more rows than that
  // cap allows at the bubbles' baseline size. Down to a floor past
  // which a bubble would be too small to tap reliably.
  const fitRef = useFitGrid<HTMLDivElement>(roster.length, 0.6);

  // Balances the bubbles across exactly two rows once they'd otherwise
  // wrap, instead of leaving the browser's own left-to-right flex-wrap
  // packing to strand however many are left over (as few as one) alone
  // on the second row. `null` means "render naturally, one row if it
  // fits" - measured fresh (see the layout effects below) rather than
  // computed from container/bubble widths directly, since the bubbles'
  // own size already depends on useFitGrid's --fit-scale above.
  const gridRef = useRef<HTMLDivElement>(null);
  const [split, setSplit] = useState<{ top: number; bottom: number } | null>(null);
  // What `split` was actually computed for - compared against the
  // current roster.length during render (React's own sanctioned
  // alternative to an effect that just resets state on a prop change:
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-state-based-on-a-prop)
  // so a previous split computed for a differently-sized roster (or
  // before a rider was added) doesn't linger into a render it no
  // longer applies to.
  const [splitForLength, setSplitForLength] = useState(roster.length);
  if (splitForLength !== roster.length) {
    setSplitForLength(roster.length);
    setSplit(null);
  }

  // Runs after every render but only does real work while `split` is
  // still null - once it computes and sets a split, this same effect
  // fires again for the render that follows, sees `split` is no longer
  // null, and bails immediately, so this converges in at most two
  // passes rather than looping. Deps cover everything the body reads
  // apart from the ref itself.
  useLayoutEffect(() => {
    if (split !== null) return;
    const grid = gridRef.current;
    if (!grid || grid.children.length === 0) return;
    const children = Array.from(grid.children) as HTMLElement[];
    const firstTop = children[0].offsetTop;
    const wraps = children.some((child) => child.offsetTop !== firstTop);
    if (!wraps) return;

    let top = Math.ceil(roster.length / 2);
    let bottom = roster.length - top;
    // The plain half/half (or half-minus-one) split still strands a
    // lone bubble on row 2 for exactly one case - an odd count whose
    // "one less than half" rounds all the way down to 1 (only ever
    // happens at roster.length === 3). Shift one bubble down from row
    // 1 so row 2 reads as a real (if shorter) row instead.
    if (bottom === 1 && top > 1) {
      top -= 1;
      bottom += 1;
    }
    setSplit({ top, bottom });
  }, [split, roster.length]);

  // A width change (rotating the tablet, say) can just as easily let a
  // previously-wrapped roster fit back on one line - re-measuring from
  // scratch on resize (rather than only ever re-checking the split
  // already in place) is what lets it un-split again.
  useEffect(() => {
    const onResize = () => setSplit(null);
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, []);

  return (
    <div
      ref={fitRef}
      className="animate-popup-pop flex max-h-[78%] max-w-[86%] flex-col items-center justify-center gap-[calc(0.75rem*var(--fit-scale,1))] overflow-hidden rounded-xl border border-zinc-200 bg-[var(--background)] p-3 shadow-lg"
      onClick={(e) => e.stopPropagation()}
    >
      <h2 className="font-heading text-sm font-black tracking-tight text-zinc-700">
        {isDropoff ? "Riders Dropped Off" : "Riders Picked Up"}
      </h2>
      <div
        ref={gridRef}
        className="flex flex-wrap items-start justify-center gap-[calc(0.5rem*var(--fit-scale,1))]"
      >
        {roster.map((checked, i) => (
          <Fragment key={i}>
            {/* Forces flex-wrap to break the line here rather than
                wherever it naturally would have - a zero-height,
                full-width item ends the current row immediately, same
                classic flexbox trick as a manual column break. Only
                inserted once a split's actually been measured/needed
                (see above), and only right after the row-1 count. */}
            {split && i === split.top && <div className="h-0 w-full" aria-hidden="true" />}
            <button
              type="button"
              onClick={() => onRiderTap(i)}
              aria-pressed={checked}
              aria-label={
                isDropoff
                  ? `Check off through rider ${i + 1}${checked ? " (checked off)" : ""}`
                  : `Check in through rider ${i + 1}${checked ? " (checked in)" : ""}`
              }
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
          </Fragment>
        ))}
      </div>

      <div className="flex w-full items-center justify-between gap-2">
        <button
          type="button"
          onClick={onAddRider}
          className="btn-glossy-light font-heading flex items-center gap-1.5 rounded-xl bg-zinc-300 px-3 py-2 text-sm font-semibold text-zinc-900"
        >
          + Add Rider
        </button>
        <button
          type="button"
          onClick={onClose}
          className="btn-glossy-blue font-heading flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white"
        >
          <CheckIcon className="h-4 w-4" />
          {isDropoff ? "Check Off Riders" : "Check in Riders"}
        </button>
      </div>
    </div>
  );
}

/** The "depot" virtual state - before the first real step. The bus sits
 * on the start cul-de-sac (RouteProgressBar) while this generic content
 * shows in place of any actual turn/stop, so step 0's own directions
 * only appear once "Start" is tapped. */
function DepotContent({ route, departing }: { route: Route; departing: boolean }) {
  return (
    <>
      <p className="font-heading text-[clamp(1.5rem,5vh,2.5rem)] font-black tracking-tight text-blue-600">
        {route.departureTime}
      </p>
      {/* animate-bus-depart plays once, on the way out - see
          StepScreen's own handleStart, which holds off the real
          onAdvance (and the StepTransition swap that comes with it)
          until this finishes, so the bus is still fully on screen for
          the whole slide instead of getting cut off mid-exit. */}
      <Image
        src="/assets/bus.png"
        alt=""
        width={780}
        height={465}
        className={`h-[clamp(3.25rem,12vh,8rem)] w-auto drop-shadow-sm ${
          departing ? "animate-bus-depart" : ""
        }`}
      />
      <h1 className="font-heading text-[clamp(1.5rem,5vh,2.75rem)] font-black tracking-tight">
        Ready to Depart
      </h1>
      {/* Its own tighter gap (half of the gap-2 every other sibling here
          shares, via StepTransition's own flex column) - just between
          the school name and its address, not the bus/title above. */}
      <div className="flex flex-col items-center gap-1">
        <p className="flex items-center justify-center gap-1.5 text-[clamp(0.875rem,2.5vh,1.25rem)] font-semibold text-zinc-700">
          {/* Dropoff: the bus is leaving *from* the school - the arrow
              trails off after the name, pointing away. Pickup and a
              one-off field trip both default to heading *to* the
              school instead (not "pickup only" - a fieldtrip route
              would otherwise get no arrow at all, having matched
              neither branch) - the arrow leads into the name. Same
              rightward TriangleIcon either way, just placed on
              whichever side reads as the right direction of travel. */}
          {route.tripType !== "dropoff" && (
            <TriangleIcon direction="right" className="h-[0.7em] w-[0.7em] shrink-0 text-blue-500" />
          )}
          {route.tripType === "dropoff" ? "From " : "To "}
          {route.schoolName}
          {route.tripType === "dropoff" && (
            <TriangleIcon direction="right" className="h-[0.7em] w-[0.7em] shrink-0 text-blue-500" />
          )}
        </p>
        <p className="flex items-center gap-1 text-[clamp(0.875rem,2.5vh,1.25rem)] text-zinc-500">
          <MapPinIcon className="h-[0.9em] w-[0.9em] shrink-0 text-blue-500" />
          {addressWithoutZip(route.schoolAddress)}
        </p>
      </div>
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
