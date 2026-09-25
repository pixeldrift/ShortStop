"use client";

import { useEffect, useRef } from "react";
import { titleCaseAction } from "./parseRouteCsv";
import type { NavigationStep, Route } from "./types";
import type { LiveRouteProgress } from "./useLiveRouteProgress";
import type { StepPhase } from "./useRouteStepper";

/** ~12 seconds before the maneuver - a real navigation system's own
 * "advance notice" window (5-10s for a passenger car), lengthened for
 * a school bus: it takes longer to stop, and the driver is more
 * likely to be mid-conversation with the riders than a solo driver
 * would be. */
const ADVANCE_LEAD_SECONDS = 12;
/** ~4 seconds before the maneuver - the short, immediate confirmation
 * right as the turn arrives, same reasoning as ADVANCE_LEAD_SECONDS
 * above for why this runs a little longer than a typical passenger-car
 * app's own close-range cue. */
const TURN_LEAD_SECONDS = 4;
/** Below this, there's no meaningful "time" to warn ahead of - time-
 * to-maneuver = distance / speed only means something once speed is
 * actually nonzero-ish. This is the one gate this whole hook's own
 * graceful-fallback story rests on: below it (or with no usable GPS at
 * all - see LiveRouteProgress's own onRoute), every effect below
 * simply returns without speaking anything, and
 * useRouteStepper's own existing per-step announcement - unchanged,
 * fires in full the instant a step becomes current regardless of GPS -
 * is the only thing a driver or someone reviewing a route (testing at
 * a desk, stepping through manually with the bus not actually moving)
 * ever hears, exactly like before this hook existed. ~2 mph. */
const MOVING_THRESHOLD_MPS = 0.9;

const METERS_TO_FEET = 3.28084;

/** Rounded to the nearest 50 feet - "in 500 feet," not "in 483 feet,"
 * matching how every real turn-by-turn system phrases a lead
 * distance. Never negative (a maneuver that's technically already
 * slightly behind the live fix, from GPS jitter, still reads as
 * "right here" rather than a nonsensical negative distance). */
function roundedFeet(meters: number): number {
  return Math.max(0, Math.round((meters * METERS_TO_FEET) / 50) * 50);
}

/** The short, close-range phrase - reuses the same all-caps on-screen
 * heading StepContent already builds (stepHeading, parseRouteCsv.ts:
 * "TURN RIGHT", "PROCEED", "DEPART", ...) rather than a separate
 * wording table, just title-cased for speech instead of shouted. */
function turnStagePhrase(step: NavigationStep): string {
  return `${titleCaseAction(step.heading ?? "Continue")}.`;
}

/** The longer, early-warning phrase - reuses the step's own already-
 * built full announcement (buildRouteFromRows, parseRouteCsv.ts) as
 * the maneuver description, just prefixed with a live distance and
 * stripped of its own trailing period first. Deliberately not a
 * separate hand-written template: a turn with a street name typed in
 * naturally produces "In 500 feet, turn right onto Main Street" (the
 * complex-turn phrasing), one with no location typed produces "In 300
 * feet, turn right" (the simple-turn phrasing) - the same distinction
 * this app's own data already carries, not a second classification to
 * keep in sync with it. Falls back to the terse turn-stage phrase
 * outright once the lead distance itself rounds under 50 feet - "in 0
 * feet" is never worth saying. */
function advanceStagePhrase(step: NavigationStep, distanceMeters: number): string {
  const feet = roundedFeet(distanceMeters);
  if (feet < 50) return turnStagePhrase(step);
  const maneuver = (step.announcement[0] ?? turnStagePhrase(step)).replace(/\.\s*$/, "");
  return `In ${feet} feet, ${maneuver}.`;
}

function speak(text: string): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
}

/**
 * Time-based advance warning for the upcoming turn-by-turn maneuver -
 * "In 500 feet, turn right onto Main Street," then a terse "Turn
 * right." right before it - timed off live GPS speed and distance
 * (useLiveRouteProgress), not a fixed distance: a bus covers very
 * different ground in the same lead time on a 25 mph neighborhood
 * street versus a 45 mph county road, so a fixed "300 feet" either
 * comes too late at speed or too early crawling through a
 * neighborhood. See ADVANCE_LEAD_SECONDS/TURN_LEAD_SECONDS above for
 * the actual lead times this implements.
 *
 * Purely additive - never replaces or suppresses useRouteStepper's own
 * existing announcement, which still fires in full the instant a step
 * actually becomes current, exactly as it always has for every driver
 * relying on the remote/manual controls alone. This hook only ever
 * adds an early heads-up on top of that, and only when live GPS shows
 * the bus genuinely moving toward the next maneuver; whenever it
 * isn't - no GPS permission, testing/reviewing a route at a desk,
 * off-route, stopped at a light, or the remote being used with the bus
 * not physically moving - this hook is a complete no-op and the app
 * behaves exactly as it did before this existed. See
 * MOVING_THRESHOLD_MPS above for the one gate that decides that.
 *
 * Scoped to "turn"-kind steps only for now (a real driving maneuver -
 * literal left/right turns, but also Depart/Proceed/Arrive/etc.,
 * anything that isn't a Stop). A Stop's own approach warning
 * ("Approaching Stop 7 in 300 feet") is a natural extension of this
 * exact same distance/speed math with different phrasing, not built
 * yet - a Stop's full announcement is multi-part (number, address,
 * side, rider count, notes) in a way the terse turn-stage phrase
 * doesn't fit.
 *
 * Not wired into StepScreen yet - `progress` needs a real route-line
 * projection (useLiveRouteProgress) fed by the same road geometry
 * RouteMap.tsx already fetches for itself; sharing that fetch, rather
 * than this hook or its caller re-requesting the same geometry a
 * second time, is the next integration step.
 */
export function useNavigationPrompts(
  route: Route,
  currentIndex: number,
  phase: StepPhase,
  started: boolean,
  paused: boolean,
  progress: LiveRouteProgress,
): void {
  // Which upcoming step's stages have already been spoken - reset the
  // moment the upcoming step itself changes (a different stepId), so
  // advancing past one always starts the next fresh rather than
  // carrying over stale "already spoken" state from whatever used to be
  // next. Keyed by stepId (NavigationStep.id), not waypointKey - the
  // shared cache-key text can repeat for two different real steps (a
  // loop road crossing the same other road twice - RouteMap.tsx's own
  // StopMarker doc comment has the full story), which would otherwise
  // make this treat the *second* one as already spoken the moment it
  // became upcoming, and skip its own turn warning entirely. -1 is the
  // "nothing spoken yet" sentinel - a real stepId is always >= 0.
  const spokenRef = useRef<{ key: number; advance: boolean; turn: boolean }>({
    key: -1,
    advance: false,
    turn: false,
  });

  const { onRoute, speedMps, distanceToWaypoint } = progress;

  useEffect(() => {
    if (!started || paused || phase !== "step") return;
    // The graceful-fallback gate - see MOVING_THRESHOLD_MPS's own doc
    // comment above.
    if (!onRoute || speedMps == null || speedMps < MOVING_THRESHOLD_MPS) return;

    const upcoming = route.steps[currentIndex + 1];
    if (!upcoming || upcoming.kind !== "turn") return;

    if (spokenRef.current.key !== upcoming.id) {
      spokenRef.current = { key: upcoming.id, advance: false, turn: false };
    }
    const spoken = spokenRef.current;
    if (spoken.advance && spoken.turn) return;

    const distanceMeters = distanceToWaypoint(upcoming.id);
    if (distanceMeters == null || distanceMeters <= 0) return;

    const timeToManeuverSeconds = distanceMeters / speedMps;

    // Checked closest-stage-first, not in lead-time order - a fix
    // that lands the bus already inside the turn-stage window (a GPS
    // gap, or a maneuver too close to have ever crossed the advance
    // threshold on its own) should go straight to the terse phrase
    // rather than an "In 50 feet, turn right" advance warning a
    // half-second before the turn itself.
    if (!spoken.turn && timeToManeuverSeconds <= TURN_LEAD_SECONDS) {
      spoken.advance = true;
      spoken.turn = true;
      speak(turnStagePhrase(upcoming));
    } else if (!spoken.advance && timeToManeuverSeconds <= ADVANCE_LEAD_SECONDS) {
      spoken.advance = true;
      speak(advanceStagePhrase(upcoming, distanceMeters));
    }
  }, [route, currentIndex, phase, started, paused, onRoute, speedMps, distanceToWaypoint]);
}
