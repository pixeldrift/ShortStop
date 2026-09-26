"use client";

import { useEffect, useRef } from "react";
import type { Route } from "./types";
import { MOVING_THRESHOLD_MPS } from "./useLiveRouteProgress";
import type { LiveRouteProgress } from "./useLiveRouteProgress";
import type { StepPhase } from "./useRouteStepper";

/** How far past a step's own waypoint (route meters, negative once
 * behind the live fix - see LiveRouteProgress's own distanceToWaypoint
 * doc comment) the live fix has to read before this actually advances -
 * a small buffer past the exact crossing point, not the instant it
 * reads negative at all, so one noisy fix that barely dips past zero
 * then immediately reads positive again doesn't fire a premature
 * advance a moment before the bus has actually cleared it. Every
 * turn/depart/arrive step's own real trigger; a "stop" step only ever
 * falls back to this (see the stop-and-go detection below for its own,
 * more direct primary signal) - a stop the bus simply rolls through
 * without ever fully halting (no expected riders, say) still eventually
 * clears this way instead of waiting forever for a real stop-and-go
 * that isn't coming. */
const PAST_WAYPOINT_METERS = -15;

/** The route's own last step is a special case: the road-geometry line
 * itself always ends exactly at that final waypoint (a real routing
 * provider's own route terminates at the destination it was asked for,
 * same as this app's mocked-geometry test fixture), so a live fix's
 * own nearest-point-on-line projection (projectOntoRoute,
 * routeProgress.ts) clamps to that same endpoint the moment the bus
 * reaches or passes it - there's no further segment for the fix to
 * project past. distanceToWaypoint for that one step can genuinely
 * never read more negative than 0 as a result, so PAST_WAYPOINT_METERS'
 * own buffer above (which every *other* step reaches because the line
 * keeps going past it) would leave this one waiting forever. Zero
 * buffer here instead - "at or past the endpoint" is already as far
 * "past" as this step's own distance value can ever show. */
const PAST_FINAL_WAYPOINT_METERS = 0;

/** Below this, live GPS speed reads as "actually stopped," not just
 * "slow" - deliberately below MOVING_THRESHOLD_MPS above rather than
 * sharing one threshold, so a speed reading that hovers right around
 * either value on its own (ordinary GPS jitter at a near-stop crawl)
 * can't flap between "stopped" and "moving" tick to tick: it has to
 * actually cross this lower line to count as freshly stopped, and
 * actually cross MOVING_THRESHOLD_MPS to count as freshly moving again,
 * with a dead zone in between where this hook simply doesn't change its
 * mind either way. ~1 mph. */
const STOPPED_SPEED_MPS = 0.5;

/** How long live speed has to read continuously below STOPPED_SPEED_MPS
 * before this counts as a real stop for boarding/dropoff, not just a
 * momentary near-stop crawl (a tight turn, easing up to a stop sign
 * short of the actual stop). A few seconds is long enough that an
 * ordinary rolling slowdown never reads as "stopped" at all, but short
 * enough that it's already satisfied well before a driver's actually
 * finished waiting on riders - it's resuming *speed*, not this delay,
 * that actually gates the advance below. */
const STOP_HOLD_MS = 3000;

/**
 * Advances the current step automatically once live GPS shows the bus
 * has actually cleared it - the "drive the route hands-free" half of
 * the GPS story useNavigationPrompts.ts only ever half-built (that hook
 * speaks an early heads-up but never itself calls onAdvance - see its
 * own doc comment for why that was left for later).
 *
 * Two different signals, depending on the step's own kind:
 *
 *  - A "stop" step's own primary signal is a real stop-and-go: live
 *    speed reads below STOPPED_SPEED_MPS continuously for at least
 *    STOP_HOLD_MS (the bus actually halted, long enough to be
 *    boarding/dropping off riders - not just slowing for the turn into
 *    it), then climbs back above MOVING_THRESHOLD_MPS (pulling away
 *    again). That's a real school bus's own actual physical behavior at
 *    every stop it ever makes, and a far more direct signal that this
 *    stop is genuinely done than "the live fix's projection now reads
 *    some arbitrary distance past it" - a bus can legitimately sit at a
 *    stop for a long time with a live fix parked well behind the stop's
 *    own waypoint the whole while, and distance alone can't tell "still
 *    loading" from "just hasn't started rolling yet." Falls back to the
 *    same distance check every other step uses (below) if the bus never
 *    actually comes to a real stop at all - riders expected or not, a
 *    stop the bus simply drives through fires `onStopSkipped` instead of
 *    `onStopAndGoDetected` and still advances, rather than leaving the
 *    trip stuck on a stop GPS shows the bus is already well past. A
 *    driver who genuinely blew through a stop needs to be told that
 *    loudly, not have the app silently freeze waiting for a dismiss that
 *    was never coming.
 *  - Every other step (turn/depart/arrive) advances purely on distance:
 *    once the live fix's own distanceToWaypoint reads far enough past
 *    it (PAST_WAYPOINT_METERS, or PAST_FINAL_WAYPOINT_METERS for the
 *    route's own last step) - a turn doesn't necessarily involve a real
 *    stop at all (a wide, rolling turn), so there's no stop-and-go to
 *    key off for one.
 *
 * Purely additive: every manual input (footer Next/Back, tap-to-advance,
 * Bluetooth remote, keyboard) keeps working exactly as before, and this
 * is a complete no-op under the same conditions useNavigationPrompts
 * already treats as "nothing to act on" - no GPS permission, testing a
 * route at a desk, or off-route.
 *
 * `onStopAndGoDetected` - called the instant a stop-and-go completes,
 * right before `onAdvance` itself - StepScreen's own implementation
 * closes that step's rider check-in box (if it's the one currently
 * showing) so the box is never still sitting open across the step
 * transition that follows immediately after.
 *
 * `onStopSkipped` - called instead, right before that same `onAdvance`,
 * whenever a *stop* step is the one that actually clears via the plain
 * distance fallback rather than a real stop-and-go - the one case that
 * really is "skipped" (a turn/depart/arrive step clearing via distance
 * is just its own normal, only way to clear, not a skip of anything).
 * StepScreen's own implementation is what actually tells the driver.
 */
export function useGpsAutoAdvance(
  route: Route,
  currentIndex: number,
  phase: StepPhase,
  paused: boolean,
  progress: LiveRouteProgress,
  onAdvance: () => void,
  onStopAndGoDetected: (stepId: number) => void,
  onStopSkipped: (stepId: number) => void,
): void {
  const { onRoute, speedMps, distanceToWaypoint } = progress;

  // Which step's own waypoint this has already advanced past - guards
  // against firing again on every later GPS tick while the live fix
  // keeps reading past the same step, right up until currentIndex
  // itself actually changes underneath it (a different step.id, which
  // this ref no longer matches). -1 is the "nothing advanced yet"
  // sentinel - a real stepId is always >= 0.
  const advancedForStepIdRef = useRef(-1);

  // The stop-and-go tracker's own state: which step it's currently
  // timing a stop for, and when that stop last freshly began (null
  // while not currently reading as stopped at all). Reset implicitly
  // the moment `stepId` no longer matches the current step - a new
  // step always starts this fresh rather than inheriting a previous
  // stop's own timing.
  const stopTrackerRef = useRef<{ stepId: number; stoppedSinceMs: number | null }>({
    stepId: -1,
    stoppedSinceMs: null,
  });

  useEffect(() => {
    if (phase !== "step" || paused) return;
    if (!onRoute || speedMps == null) return;

    const step = route.steps[currentIndex];
    if (!step || advancedForStepIdRef.current === step.id) return;
    const isStop = step.kind === "stop";

    if (isStop) {
      const tracker = stopTrackerRef.current;
      if (tracker.stepId !== step.id) {
        stopTrackerRef.current = { stepId: step.id, stoppedSinceMs: null };
      }

      if (speedMps < STOPPED_SPEED_MPS) {
        if (stopTrackerRef.current.stoppedSinceMs == null) {
          stopTrackerRef.current = { stepId: step.id, stoppedSinceMs: Date.now() };
        }
        // Actually stopped right now - no speed to fall through and
        // check the plain distance path with either.
        return;
      }

      if (speedMps >= MOVING_THRESHOLD_MPS) {
        const { stoppedSinceMs } = stopTrackerRef.current;
        const stoppedLongEnough =
          stoppedSinceMs != null && Date.now() - stoppedSinceMs >= STOP_HOLD_MS;
        // Moving again either way - a resumed-but-too-brief stop starts
        // timing fresh from here rather than keeping a stale
        // stoppedSinceMs that would let a *later*, shorter pause falsely
        // inherit however long ago the first one started.
        stopTrackerRef.current = { stepId: step.id, stoppedSinceMs: null };
        if (stoppedLongEnough) {
          advancedForStepIdRef.current = step.id;
          onStopAndGoDetected(step.id);
          onAdvance();
          return;
        }
        // Moving, but never actually came to a real stop first (or
        // didn't hold it long enough) - falls through to the same
        // distance fallback every other step uses below, so a "stop"
        // step the bus simply rolls through without ever fully halting
        // (no expected riders, say, or just a rolling stop) still
        // eventually advances instead of waiting forever for a real
        // stop-and-go that isn't coming.
      }
      // Between the two thresholds is genuinely ambiguous (easing off a
      // stop, or easing back up to speed) - leave the tracker as-is and
      // fall through to the same distance check below too, gated by
      // its own speedMps < MOVING_THRESHOLD_MPS bail-out just past this
      // block, so this ambiguous zone doesn't itself trigger anything.
    }

    if (speedMps < MOVING_THRESHOLD_MPS) return;

    const distanceMeters = distanceToWaypoint(step.id);
    const threshold =
      currentIndex === route.steps.length - 1 ? PAST_FINAL_WAYPOINT_METERS : PAST_WAYPOINT_METERS;
    if (distanceMeters == null || distanceMeters > threshold) return;

    advancedForStepIdRef.current = step.id;
    if (isStop) onStopSkipped(step.id);
    onAdvance();
  }, [
    route,
    currentIndex,
    phase,
    paused,
    onRoute,
    speedMps,
    distanceToWaypoint,
    onAdvance,
    onStopAndGoDetected,
    onStopSkipped,
  ]);
}
