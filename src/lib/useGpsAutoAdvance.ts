"use client";

import { useEffect, useRef } from "react";
import type { NavigationStep, Route } from "./types";
import { distanceBetweenWaypoints, SAME_INTERSECTION_METERS } from "./useNavigationPrompts";
import type { LiveRouteProgress } from "./useLiveRouteProgress";
import type { StepPhase } from "./useRouteStepper";
import {
  advanceStepPhase,
  initialStepPhaseState,
  isPastWaypoint,
  type StepPhaseState,
} from "./gpsStepPhase";

/**
 * Advances the current step automatically once live GPS shows the bus
 * has actually cleared it - the "drive the route hands-free" half of
 * the GPS story useNavigationPrompts.ts only ever half-built (that hook
 * speaks an early heads-up but never itself calls onAdvance - see its
 * own doc comment for why that was left for later).
 *
 * The *current* step's own phase (Upcoming/Approaching/Action/Completed)
 * is tracked with gpsStepPhase.ts's shared reducer, one persistent
 * StepPhaseState per step (phaseStateRef below, reset the moment
 * `route.steps[currentIndex].id` changes underneath it) - see that
 * file's own doc comment for the full Upcoming->Approaching->Action->
 * Completed model and why a stop now needs both low speed *and* GPS
 * proximity (STOP_ARRIVAL_RADIUS_METERS) before it can ever fire
 * `arrived` or complete via `stopAndGo`.
 *
 * Two different completion signals fall out of that reducer, depending
 * on the step's own kind:
 *
 *  - A "stop" step's own primary signal is a real, radius-gated stop-
 *    and-go (`stopAndGo`) - the bus actually halted at the real stop
 *    long enough to be boarding/dropping off riders, then pulled away
 *    again. That's a far more direct signal this stop is genuinely done
 *    than "the live fix's projection now reads some arbitrary distance
 *    past it," and advances immediately, one step at a time - never
 *    folded into the multi-step catch-up scan below, since a stop-and-go
 *    is only ever tracked for the step that's actually current right
 *    now. Falls back to the same plain-distance clear every other step
 *    uses (the reducer's own `skipped` event) if the bus never actually
 *    comes to a real, radius-gated stop at all - riders expected or not,
 *    a stop the bus simply drives through fires `onStopSkipped` instead
 *    of `onStopAndGoDetected` and still advances, rather than leaving
 *    the trip stuck on a stop GPS shows the bus is already well past.
 *  - Every other step (turn/depart/arrive) advances purely on distance
 *    (the reducer's own `cleared` event) - a turn doesn't necessarily
 *    involve a real stop at all (a wide, rolling turn), so there's no
 *    stop-and-go to key off for one.
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
 * `onStopSkipped` - called instead, right before that same
 * `onAdvance`/`onCatchUp`, whenever a *stop* step is the one that
 * actually clears via the plain distance fallback rather than a real
 * stop-and-go - the one case that really is "skipped" (a turn/depart/
 * arrive step clearing via distance is just its own normal, only way to
 * clear, not a skip of anything). StepScreen's own implementation is
 * what actually tells the driver.
 *
 * `onCatchUp` - the resync path: once the *current* step itself clears
 * (`skipped`/`cleared`, never a `stopAndGo` - see above), this also
 * scans forward from the step right after it, looking for the *furthest*
 * step the live fix already reads past too - a stateless check
 * (gpsStepPhase.ts's own `isPastWaypoint`, no stop-and-go semantics: a
 * stop folded into a catch-up jump is a real skip, not something to
 * retroactively credit with a stop-and-go it was never tracked for).
 * Ordinarily that's still just the current step alone (one tick, one
 * step, same as ever - onAdvance handles that, unchanged), but a fix
 * that already clears one or more *later* steps too - after a spell
 * paused/off-route, a stop-and-go window that came and went unnoticed,
 * or simply a live fix arriving in bursts - means the trip has fallen
 * behind where the bus actually is, not that each of those intermediate
 * steps individually needs its own satisfied trigger. This fires instead
 * of onAdvance for that case, naming the last index the live fix has
 * already cleared, so the caller can jump straight there (RouteApp's own
 * jumpTo/onSeek, the same thing a manual progress-bar scrub already
 * uses) rather than being stuck re-checking a step GPS shows the bus has
 * already left behind. Every stop step folded into that jump still gets
 * its own onStopSkipped first, in route order, exactly as if each had
 * cleared on its own.
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
 * closes rather than waiting on the phase reducer or catch-up scan
 * below to notice - there's no real distance between the two to wait
 * through, and a driver who's already dealt with the riders has no
 * reason to sit listening to a stop's own instruction repeat while GPS
 * eventually catches up. Every other stop (no next step this close) is
 * entirely unaffected - still cleared the ordinary way, by a real
 * stop-and-go or the distance fallback.
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
  /** Fired the instant gpsStepPhase.ts's reducer reports `arrived` for
   * the *current* stop step - the moment it's both within
   * STOP_ARRIVAL_RADIUS_METERS and reads a fresh below-STOPPED_SPEED_MPS
   * speed. This is "the bus has physically stopped here," not "the stop
   * is done" (onStopAndGoDetected's own job, once it's held long enough
   * and moving again) - StepScreen's own implementation uses it to
   * finally let that stop's own full arrival announcement speak, which
   * it otherwise holds back the instant this step becomes current (see
   * useRouteStepper.ts's own arrivedStopId doc comment for why:
   * becoming "current" only ever means the *previous* step cleared, not
   * that the bus has actually reached this one yet). */
  onStopArrived: (stepId: number) => void,
): void {
  const { onRoute, speedMps, distanceToWaypoint, waypointDistances } = progress;

  // Which step's own waypoint this has already advanced past - guards
  // against firing again on every later GPS tick while the live fix
  // keeps reading past the same step, right up until currentIndex
  // itself actually changes underneath it (a different step.id, which
  // this ref no longer matches). -1 is the "nothing advanced yet"
  // sentinel - a real stepId is always >= 0.
  const advancedForStepIdRef = useRef(-1);

  // The current step's own live phase state (gpsStepPhase.ts) - reset
  // implicitly the moment `stepId` no longer matches the current step,
  // so a new step always starts fresh rather than inheriting whatever
  // the previous step's own tracker last read.
  const phaseStateRef = useRef<{ stepId: number; state: StepPhaseState }>({
    stepId: -1,
    state: initialStepPhaseState,
  });

  useEffect(() => {
    if (phase !== "step" || paused) return;
    if (!onRoute || speedMps == null) return;

    const step = route.steps[currentIndex];
    if (!step || advancedForStepIdRef.current === step.id) return;
    const isStop = step.kind === "stop";

    // The dismissed-stop shortcut - see dismissedStopId's own doc
    // comment above. Checked before the phase reducer below so a
    // same-corner pairing never waits on it at all, stopped or rolling
    // either way.
    if (isStop && dismissedStopId === step.id) {
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

    if (phaseStateRef.current.stepId !== step.id) {
      phaseStateRef.current = { stepId: step.id, state: initialStepPhaseState };
    }

    const isFinalStep = currentIndex === route.steps.length - 1;
    const { next: nextPhaseState, events } = advanceStepPhase(phaseStateRef.current.state, {
      distanceMeters: distanceToWaypoint(step.id),
      speedMps,
      onRoute,
      // Approach-warning staging is useNavigationPrompts.ts's own job
      // for the *upcoming* step - this hook only cares about the
      // current step's Action/Completed transitions, so sameCorner:
      // true skips that branch entirely rather than tracking an
      // approachStage nothing here ever reads.
      sameCorner: true,
      isStop,
      isFinalStep,
      nowMs: Date.now(),
    });
    phaseStateRef.current = { stepId: step.id, state: nextPhaseState };

    if (events.includes("arrived")) onStopArrived(step.id);

    if (events.includes("stopAndGo")) {
      advancedForStepIdRef.current = step.id;
      onStopAndGoDetected(step.id);
      onAdvance();
      return;
    }

    if (!events.includes("skipped") && !events.includes("cleared")) return;

    if (isStop) onStopSkipped(step.id);
    else if (step.direction) onTurnCompleted(step);

    // Scans forward from the step right after the current one (already
    // accounted for above) rather than only ever stopping there - see
    // onCatchUp's own doc comment above for why. Stateless: none of
    // these later steps have been "current" long enough to have their
    // own live stop-and-go tracked, so a stop among them just checks
    // plain distance, same as any other step.
    let clearedThroughIndex = currentIndex;
    for (let i = currentIndex + 1; i < route.steps.length; i++) {
      const distanceMeters = distanceToWaypoint(route.steps[i].id);
      if (!isPastWaypoint(distanceMeters, i === route.steps.length - 1)) break;
      clearedThroughIndex = i;
    }

    advancedForStepIdRef.current = route.steps[clearedThroughIndex].id;
    if (clearedThroughIndex === currentIndex) {
      onAdvance();
      return;
    }
    for (let i = currentIndex + 1; i <= clearedThroughIndex; i++) {
      const cleared = route.steps[i];
      if (cleared.kind === "stop") onStopSkipped(cleared.id);
      else if (cleared.direction) onTurnCompleted(cleared);
    }
    onCatchUp(clearedThroughIndex);
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
    onStopArrived,
  ]);
}
