"use client";

import { useEffect, useRef } from "react";
import type { NavigationStep, Route } from "./types";
import { distanceBetweenWaypoints, SAME_INTERSECTION_METERS } from "./useNavigationPrompts";
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
 *
 * `onCatchUp` - the resync path: the plain distance fallback (below)
 * doesn't just check the current step any more, it scans forward from
 * it looking for the *furthest* step the live fix already reads past.
 * Ordinarily that's still just the current step itself (one tick, one
 * step, same as ever - onAdvance handles that, unchanged), but a fix
 * that already clears one or more *later* steps too - after a spell
 * paused/off-route, a stop-and-go tracker whose window came and went
 * unnoticed, or simply a live fix arriving in bursts - means the trip
 * has fallen behind where the bus actually is, not that each of those
 * intermediate steps individually needs its own satisfied trigger. This
 * fires instead of onAdvance for that case, naming the last index the
 * live fix has already cleared, so the caller can jump straight there
 * (RouteApp's own jumpTo/onSeek, the same thing a manual progress-bar
 * scrub already uses) rather than being stuck re-checking a step GPS
 * shows the bus has already left behind. Every stop step folded into
 * that jump still gets its own onStopSkipped first, in route order,
 * exactly as if each had cleared on its own.
 *
 * `onTurnCompleted` - called for every real left/right turn step
 * (`direction` set - a depart/arrive/proceed/etc. step never gets this,
 * only a genuine compass turn) the instant live GPS confirms it's been
 * cleared, right alongside (before) `onAdvance`/`onCatchUp`/
 * `onStopSkipped`'s own calls for it - StepScreen's own implementation
 * speaks a short "Turned left onto Weakly Street" reassurance, distinct
 * from whatever gets announced for the step that becomes current next.
 * Without this, GPS confirming a turn was silent by itself - only ever
 * audible secondhand, through whatever instruction *followed* it -
 * which is exactly the "does it actually know where I am" doubt a
 * driver has no way to resolve mid-turn.
 *
 * `dismissedStopId` - StepScreen's own signal that a stop's rider
 * check-in box was just checked in (every rider tapped) or dismissed
 * (its own X) - the same signal useNavigationPrompts.ts takes for its
 * own next-action preview. When that stop's *very next* step sits
 * within SAME_INTERSECTION_METERS of it (a turn right at the same
 * corner, say), this advances straight to it the instant the box
 * closes rather than waiting on the stop-and-go tracker or distance
 * fallback below to notice - there's no real distance between the two
 * to wait through, and a driver who's already dealt with the riders
 * has no reason to sit listening to a stop's own instruction repeat
 * while GPS eventually catches up. Every other stop (no next step this
 * close) is entirely unaffected - still cleared the ordinary way, by a
 * real stop-and-go or the distance fallback below.
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
  onCatchUp: (targetIndex: number) => void,
  onTurnCompleted: (step: NavigationStep) => void,
  dismissedStopId: number | null,
): void {
  const { onRoute, speedMps, distanceToWaypoint, waypointDistances } = progress;

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
      // The dismissed-stop shortcut - see dismissedStopId's own doc
      // comment above. Checked before the stop-and-go tracker below so
      // a same-corner pairing never waits on it at all, stopped or
      // rolling either way.
      if (dismissedStopId === step.id) {
        const next = route.steps[currentIndex + 1];
        const gapMeters = next
          ? distanceBetweenWaypoints(waypointDistances, step.id, next.id)
          : null;
        if (next && gapMeters != null && gapMeters < SAME_INTERSECTION_METERS) {
          advancedForStepIdRef.current = step.id;
          onAdvance();
          return;
        }
      }

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

    // Scans forward from the current step (inclusive) rather than only
    // ever checking it alone - see onCatchUp's own doc comment above for
    // why. Stops at the first step the live fix *doesn't* clear yet, so
    // this always finds the furthest contiguous run starting right here,
    // never a later step past some gap the fix hasn't actually reached.
    let clearedThroughIndex = -1;
    for (let i = currentIndex; i < route.steps.length; i++) {
      const distanceMeters = distanceToWaypoint(route.steps[i].id);
      const threshold =
        i === route.steps.length - 1 ? PAST_FINAL_WAYPOINT_METERS : PAST_WAYPOINT_METERS;
      if (distanceMeters == null || distanceMeters > threshold) break;
      clearedThroughIndex = i;
    }
    if (clearedThroughIndex === -1) return;

    advancedForStepIdRef.current = route.steps[clearedThroughIndex].id;
    for (let i = currentIndex; i <= clearedThroughIndex; i++) {
      const cleared = route.steps[i];
      if (cleared.kind === "stop") onStopSkipped(cleared.id);
      // A real left/right turn (direction set) - see onTurnCompleted's
      // own doc comment above for why only this subset, and why it
      // fires before onAdvance/onCatchUp below rather than after.
      else if (cleared.direction) onTurnCompleted(cleared);
    }
    if (clearedThroughIndex === currentIndex) {
      onAdvance();
    } else {
      onCatchUp(clearedThroughIndex);
    }
  }, [
    route,
    currentIndex,
    phase,
    paused,
    onRoute,
    speedMps,
    distanceToWaypoint,
    waypointDistances,
    dismissedStopId,
    onAdvance,
    onTurnCompleted,
    onStopAndGoDetected,
    onStopSkipped,
    onCatchUp,
  ]);
}
