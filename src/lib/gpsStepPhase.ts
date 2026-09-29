/**
 * The one shared GPS-phase model every step in a route moves through,
 * live: Upcoming -> Approaching -> Action -> Completed. Consolidates
 * three things that used to be computed independently, from the same
 * raw `distanceToWaypoint`/`speedMps` feed, by three different files
 * (useNavigationPrompts.ts's own spokenRef lead-time bookkeeping,
 * useGpsAutoAdvance.ts's own stopTrackerRef/advancedForStepIdRef, and
 * useRouteStepper.ts's own arrivedStopId gate) into one pure,
 * framework-agnostic reducer - same reasoning routeProgress.ts's own
 * doc comment gives for keeping the geometry math itself framework-
 * agnostic: trivial to sanity-check by hand or from a plain script,
 * unlike a hook.
 *
 * "Upcoming" is the default, silent state - nothing worth telling a
 * driver yet, and nothing to advance. "Approaching" is the pre-arrival
 * warning window (`enteredApproachFar`/`enteredApproachNear` events -
 * useNavigationPrompts.ts's own "In 700 feet, stop at..."/"Stop ahead."
 * pair), timed off live speed and distance where there's real speed to
 * time against (a bus covers very different ground in the same lead
 * time at 25 mph versus 45 mph), falling back to a plain distance floor
 * (ADVANCE_DISTANCE_METERS/TERSE_DISTANCE_METERS and their own STOP_*
 * counterparts) whenever there isn't - a bus creeping toward an
 * address-only stop below MOVING_THRESHOLD_MPS the whole way still
 * gets both cues on approach, not silence until it's already arrived.
 * "Action" is the real-world moment a stop step is
 * physically being dealt with - GPS confirms both close enough
 * (STOP_ARRIVAL_RADIUS_METERS) and actually stopped
 * (STOPPED_SPEED_MPS), the `arrived` event (useGpsAutoAdvance.ts's own
 * onStopArrived - what finally lets a stop's full arrival announcement
 * speak, per useRouteStepper.ts's own stopArrivalPending gate). A
 * turn/depart/arrive/proceed step has no real Action to pause on - it
 * collapses straight through into Completed the instant it clears,
 * same as today. "Completed" is a step's own real done-ness: a stop
 * that held long enough and is moving again (`stopAndGo`), a stop that
 * never actually stopped at all and simply rolled past
 * (`skipped` - a real "skip," worth telling the driver, not silently
 * treating it the same as a genuine stop-and-go), or any other step
 * simply read far enough past its own waypoint (`cleared`).
 *
 * The one genuinely new behavior this reducer adds, versus the three
 * files it replaces: a stop only ever enters Action - and so only ever
 * fires `arrived` or can go on to fire `stopAndGo` - when the live fix
 * is *also* within STOP_ARRIVAL_RADIUS_METERS of that stop's own real
 * waypoint, not on sustained low speed alone. Before this, a bus
 * stopped at a red light or in traffic anywhere on the leg leading up
 * to a stop step would read as "arrived" (speaking that stop's full
 * announcement) and, once moving again, as a completed stop-and-go
 * (advancing straight past a stop the bus hadn't physically reached
 * yet) - exactly the "stop detection doesn't require physical
 * proximity" bug this exists to fix. A stop the bus is nowhere near
 * yet, read as stopped, now just... waits, silently, same as being
 * stopped anywhere else that isn't a real trigger for anything -
 * nothing regresses for the genuine "actually at the stop" case, which
 * already sits well inside this radius by the time a real driver stops
 * there.
 */

import { MOVING_THRESHOLD_MPS } from "./useLiveRouteProgress";

/** ~15 seconds before a turn/depart/arrive maneuver - a real navigation
 * system's own "advance notice" window (5-10s for a passenger car),
 * lengthened for a school bus: it takes longer to stop, and the driver
 * is more likely to be mid-conversation with the riders than a solo
 * driver would be. */
export const ADVANCE_LEAD_SECONDS = 15;
/** Longer than ADVANCE_LEAD_SECONDS above - a stop means actually
 * coming to a full halt, not just a turn of the wheel, and a bus needs
 * real extra distance to do that safely once loaded. */
export const STOP_ADVANCE_LEAD_SECONDS = 20;
/** ~4 seconds before a turn/depart/arrive maneuver - the short,
 * immediate confirmation right as it arrives, same reasoning as
 * ADVANCE_LEAD_SECONDS above for why this runs a little longer than a
 * typical passenger-car app's own close-range cue. */
export const TERSE_LEAD_SECONDS = 4;
/** Same idea as STOP_ADVANCE_LEAD_SECONDS above, for the close-range
 * cue - a bus committing to a full stop needs a little more of this
 * final window too, not just the earlier advance notice. */
export const STOP_TERSE_LEAD_SECONDS = 6;

/** A plain-distance floor for the advance-warning stage, independent of
 * current speed - see the approach-stage classification's own doc
 * comment below for why a lead time alone isn't enough. ~500 ft -
 * roughly what ADVANCE_LEAD_SECONDS covers at a typical residential
 * driving speed, so this rarely changes anything for a bus actually
 * moving at speed (the lead-time check already fires first); it only
 * matters once speed drops too low to trust the time math at all. */
export const ADVANCE_DISTANCE_METERS = 150;
/** Same idea as ADVANCE_DISTANCE_METERS, for the close-range stage.
 * ~80 ft - close enough that "the turn is right here" is true
 * regardless of why the bus is going slowly. */
export const TERSE_DISTANCE_METERS = 25;
/** ADVANCE_DISTANCE_METERS' own stop counterpart - longer, matching
 * STOP_ADVANCE_LEAD_SECONDS' own longer lead. ~700 ft - deliberately
 * the same distance the very first design pass for this feature used
 * as its own worked example ("In 700 feet, stop at..."). */
export const STOP_ADVANCE_DISTANCE_METERS = 215;
/** TERSE_DISTANCE_METERS' own stop counterpart. ~100 ft - inside the
 * "GPS within ~50-75 ft" window STOP_ARRIVAL_RADIUS_METERS itself is
 * already tuned around, so "Stop ahead" always has a moment to land
 * before arrival actually gates the stop's own full announcement. */
export const STOP_TERSE_DISTANCE_METERS = 30;

/** Below this, live GPS speed reads as "actually stopped," not just
 * "slow" - deliberately below MOVING_THRESHOLD_MPS rather than sharing
 * one threshold, so a speed reading that hovers right around either
 * value on its own (ordinary GPS jitter at a near-stop crawl) can't
 * flap between "stopped" and "moving" tick to tick: it has to actually
 * cross this lower line to count as freshly stopped, and actually
 * cross MOVING_THRESHOLD_MPS to count as freshly moving again, with a
 * dead zone in between where this reducer simply doesn't change its
 * mind either way. ~1 mph. */
export const STOPPED_SPEED_MPS = 0.5;

/** How close (route meters) the live fix has to read to a stop's own
 * waypoint before a low-speed reading counts as "arrived here," not
 * just "stopped somewhere on the way" - a red light, a stop sign, or
 * ordinary traffic well short of the real stop no longer falsely
 * triggers arrival/completion (see this file's own doc comment above).
 * ~65 ft - inside the "GPS within ~50-75 ft" window a real stop is
 * expected to be read at, generous enough that ordinary GPS noise right
 * at the stop itself doesn't fall just outside it. */
export const STOP_ARRIVAL_RADIUS_METERS = 20;

/** How long live speed has to read continuously below STOPPED_SPEED_MPS
 * before this counts as a real stop for boarding/dropoff, not just a
 * momentary near-stop crawl (a tight turn, easing up to a stop sign
 * short of the actual stop). A few seconds is long enough that an
 * ordinary rolling slowdown never reads as "stopped" at all, but short
 * enough that it's already satisfied well before a driver's actually
 * finished waiting on riders - it's resuming *speed*, not this delay,
 * that actually gates completion. */
export const STOP_HOLD_MS = 3000;

/** How far past a step's own waypoint (route meters, negative once
 * behind the live fix) the live fix has to read before this counts as
 * cleared - a small buffer past the exact crossing point, not the
 * instant it reads negative at all, so one noisy fix that barely dips
 * past zero then immediately reads positive again doesn't fire a
 * premature clear a moment before the bus has actually passed it.
 * Every turn/depart/arrive step's own real trigger; a stop only ever
 * falls back to this when it never comes to a real, radius-gated stop
 * at all. */
export const PAST_WAYPOINT_METERS = -15;

/** The route's own last step is a special case: the road-geometry line
 * itself always ends exactly at that final waypoint, so a live fix's
 * own nearest-point-on-line projection clamps to that same endpoint the
 * moment the bus reaches or passes it - there's no further segment for
 * the fix to project past, so distanceToWaypoint for that one step can
 * genuinely never read more negative than 0. Zero buffer here instead -
 * "at or past the endpoint" is already as far "past" as this step's own
 * distance value can ever show. */
export const PAST_FINAL_WAYPOINT_METERS = 0;

export type StepGpsPhase = "upcoming" | "approaching" | "action" | "completed";
export type ApproachStage = "far" | "near" | null;

export interface StepPhaseState {
  phase: StepGpsPhase;
  /** Which approach-warning stage has already fired - never resets
   * once set, mirroring useNavigationPrompts' own spokenRef today (a
   * stage, once spoken, should never speak again for this same step). */
  approachStage: ApproachStage;
  /** When this step's own stop was first read as stopped *within
   * STOP_ARRIVAL_RADIUS_METERS* - null whenever not currently reading
   * that way, regardless of whether it's ever held long enough to
   * count as a real stop-and-go. Meaningless for a non-stop step. */
  stoppedSinceMs: number | null;
}

export const initialStepPhaseState: StepPhaseState = {
  phase: "upcoming",
  approachStage: null,
  stoppedSinceMs: null,
};

export interface StepPhaseInput {
  /** Route-distance from the live fix to this step's own waypoint,
   * meters (LiveRouteProgress's own distanceToWaypoint(stepId)) -
   * negative once the live fix already reads past it. Null whenever
   * there's no fix/route trust yet to measure from. */
  distanceMeters: number | null;
  /** Smoothed current speed, m/s (LiveRouteProgress's own speedMps). */
  speedMps: number | null;
  onRoute: boolean;
  /** True whenever this step's own waypoint sits within the same-
   * corner threshold of the step immediately before it - no real
   * distance to warn or gate arrival across, so approach warnings are
   * skipped outright (the caller's own same-corner shortcut, e.g.
   * dismissedStopId, owns that case instead). */
  sameCorner: boolean;
  isStop: boolean;
  /** Whether this is the route's own very last step - see
   * PAST_FINAL_WAYPOINT_METERS' own doc comment above. */
  isFinalStep: boolean;
  nowMs: number;
}

export type StepPhaseEvent =
  | "enteredApproachFar"
  | "enteredApproachNear"
  | "arrived"
  | "stopAndGo"
  | "skipped"
  | "cleared";

/** Advances one step's own phase state by exactly one GPS tick's worth
 * of input, returning the new state plus whichever events actually
 * fired this tick (usually none, or one - never more than the genuine
 * set of transitions a single tick's own numbers can trigger). Pure:
 * same inputs always produce the same outputs, nothing here reads a
 * clock or an external ref itself - `nowMs` is handed in, not read via
 * Date.now(), specifically so this stays trivially testable by feeding
 * it a scripted sequence of fixes with known timestamps. */
export function advanceStepPhase(
  prev: StepPhaseState,
  input: StepPhaseInput,
): { next: StepPhaseState; events: StepPhaseEvent[] } {
  if (prev.phase === "completed") {
    // Terminal for this step - once cleared, nothing further to track.
    return { next: prev, events: [] };
  }

  const events: StepPhaseEvent[] = [];
  let phase: StepGpsPhase = prev.phase;
  let approachStage = prev.approachStage;
  let stoppedSinceMs = prev.stoppedSinceMs;

  const { distanceMeters, speedMps, onRoute, sameCorner, isStop, isFinalStep, nowMs } = input;
  const moving = speedMps != null && speedMps >= MOVING_THRESHOLD_MPS;
  const clearThreshold = isFinalStep ? PAST_FINAL_WAYPOINT_METERS : PAST_WAYPOINT_METERS;

  // --- Approach-stage classification (Upcoming/Approaching-far -> Approaching-near) ---
  // Never for a same-corner pair - no real distance to count down
  // across - and never once this step has already moved past
  // Approaching into Action/Completed (checked again just below, but
  // cheap to gate here too since there's nothing left to classify).
  // Deliberately NOT gated on `moving`: a lead time is only meaningful
  // while there's real speed to divide by, but a bus can - and
  // routinely does - approach an address-only stop well under
  // MOVING_THRESHOLD_MPS the whole way (creeping along scanning house
  // numbers for a stop that isn't at an obvious intersection, easing
  // off well before a stop sign). Gating this whole block on `moving`
  // used to mean that a bus never fast enough to cross the time-based
  // threshold got no warning at all - silence right up until arrival
  // itself, which is exactly "I could drive right by it because
  // nothing told me when to stop." The ADVANCE_DISTANCE_METERS/
  // TERSE_DISTANCE_METERS floors below exist for exactly that case:
  // once close enough in plain distance, the cue fires regardless of
  // speed, while a bus actually moving at speed still gets the same
  // lead-time-based warning it always did (time-to-maneuver crosses
  // its own threshold well before the distance floor would).
  if (!sameCorner && phase !== "action" && onRoute && distanceMeters != null && distanceMeters > 0) {
    const timeToManeuverSeconds = moving ? distanceMeters / (speedMps as number) : Infinity;
    const terseLead = isStop ? STOP_TERSE_LEAD_SECONDS : TERSE_LEAD_SECONDS;
    const advanceLead = isStop ? STOP_ADVANCE_LEAD_SECONDS : ADVANCE_LEAD_SECONDS;
    const terseDistance = isStop ? STOP_TERSE_DISTANCE_METERS : TERSE_DISTANCE_METERS;
    const advanceDistance = isStop ? STOP_ADVANCE_DISTANCE_METERS : ADVANCE_DISTANCE_METERS;

    // Closest-stage-first, not lead-time order - a fix that lands the
    // bus already inside the terse-stage window (a GPS gap, or a
    // maneuver too close to have ever crossed the advance threshold on
    // its own) should go straight to the terse phrase rather than an
    // "In 50 feet, turn right" advance warning a half-second before the
    // maneuver itself.
    if (approachStage !== "near" && (timeToManeuverSeconds <= terseLead || distanceMeters <= terseDistance)) {
      // Closest-stage-first means a fix that lands here straight from
      // null (never having crossed the advance-lead threshold on its
      // own - a GPS gap, or a maneuver too close to ever reach it)
      // speaks *only* the terse phrase, exactly as today - not both,
      // which would read as a redundant "In 50 feet..." a half-second
      // before "Stop ahead." itself.
      approachStage = "near";
      phase = "approaching";
      events.push("enteredApproachNear");
    } else if (
      approachStage == null &&
      (timeToManeuverSeconds <= advanceLead || distanceMeters <= advanceDistance)
    ) {
      approachStage = "far";
      phase = "approaching";
      events.push("enteredApproachFar");
    }
  }

  // --- Action / Completed ---
  if (isStop) {
    const withinArrivalRadius = distanceMeters != null && distanceMeters <= STOP_ARRIVAL_RADIUS_METERS;
    if (speedMps != null && speedMps < STOPPED_SPEED_MPS) {
      if (withinArrivalRadius) {
        if (stoppedSinceMs == null) {
          stoppedSinceMs = nowMs;
          phase = "action";
          events.push("arrived");
        }
      } else {
        // Stopped somewhere that isn't the actual stop (a red light, a
        // stop sign, ordinary traffic short of it) - not a real
        // arrival, and never something a later resumed-moving tick
        // should credit as "this stop is done." Reset so a later,
        // genuine approach still times fresh.
        stoppedSinceMs = null;
      }
      return { next: { phase, approachStage, stoppedSinceMs }, events };
    }
    if (moving) {
      const heldLongEnough =
        stoppedSinceMs != null && nowMs - stoppedSinceMs >= STOP_HOLD_MS;
      // Moving again either way - a resumed-but-too-brief stop starts
      // timing fresh from here rather than keeping a stale
      // stoppedSinceMs that would let a *later*, shorter pause falsely
      // inherit however long ago the first one started.
      stoppedSinceMs = null;
      if (heldLongEnough) {
        phase = "completed";
        events.push("stopAndGo");
        return { next: { phase, approachStage, stoppedSinceMs }, events };
      }
      // Moving, but never actually came to a real, radius-gated stop
      // first (or didn't hold it long enough) - falls through to the
      // same plain distance fallback every other step uses, so a
      // "stop" step the bus simply rolls through without ever fully
      // halting there still eventually clears instead of waiting
      // forever for a real stop-and-go that isn't coming.
      if (distanceMeters != null && distanceMeters <= clearThreshold) {
        phase = "completed";
        events.push("skipped");
      }
    }
    // Between the two speed thresholds is genuinely ambiguous (easing
    // off a stop, or easing back up to speed) - leave everything as-is,
    // no fallback check either, same as today.
    return { next: { phase, approachStage, stoppedSinceMs }, events };
  }

  // Turn/depart/arrive/proceed - pure distance-past-waypoint, no stop
  // concept at all.
  if (moving && distanceMeters != null && distanceMeters <= clearThreshold) {
    phase = "completed";
    events.push("cleared");
  }
  return { next: { phase, approachStage, stoppedSinceMs }, events };
}

/** A one-shot, stateless "is this step already behind us" check with no
 * stop-and-go semantics at all - useGpsAutoAdvance.ts's own catch-up
 * scan (a live fix that already reads past more than one step at once)
 * uses this for every step *beyond* the current one, since none of
 * those have been "current" long enough to have their own live
 * stop-and-go tracked - a stop folded into a catch-up jump is a real
 * skip (see PAST_WAYPOINT_METERS' own doc comment), not something to
 * retroactively credit with a stop-and-go it was never tracked for. */
export function isPastWaypoint(distanceMeters: number | null, isFinalStep: boolean): boolean {
  const threshold = isFinalStep ? PAST_FINAL_WAYPOINT_METERS : PAST_WAYPOINT_METERS;
  return distanceMeters != null && distanceMeters <= threshold;
}
