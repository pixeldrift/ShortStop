"use client";

import { useEffect, useRef } from "react";
import { titleCaseAction } from "./parseRouteCsv";
import { speakRoadNames } from "./speech";
import { speak } from "./speechQueue";
import type { NavigationStep, Route } from "./types";
import { MOVING_THRESHOLD_MPS } from "./useLiveRouteProgress";
import type { LiveRouteProgress } from "./useLiveRouteProgress";
import type { StepPhase } from "./useRouteStepper";
import {
  advanceStepPhase,
  initialStepPhaseState,
  type StepPhaseState,
} from "./gpsStepPhase";

/** How close together (route meters) two consecutive waypoints have to
 * be before this treats them as "the same intersection" - a stop
 * immediately followed by a turn at that same corner, say. Neither an
 * approach warning nor a plain distance-led preview is worth speaking
 * for a gap this short: there's no real travel time to warn across, and
 * "in 20 feet, turn left" reads as noise, not help. A pair this close
 * instead gets immediateNextActionPhrase (below) - a `useGpsAutoAdvance`
 * same-corner pairing also reuses this exact constant (re-exported here)
 * so both files agree on what "the same corner" means. ~65 feet - short
 * enough that this never swallows a genuinely close pair of real,
 * separate waypoints on a tight residential block. Conservative default
 * (never skip) whenever the gap can't be measured yet (route geometry
 * hasn't loaded) - see distanceBetweenWaypoints' own doc comment. */
export const SAME_INTERSECTION_METERS = 20;

const METERS_TO_FEET = 3.28084;
const METERS_PER_MILE = 1609.34;
/** Above this, a distance reads better in miles than feet - "1.2
 * miles," not "6,300 feet." ~0.25 mile, about where a real driver's own
 * mental math already starts preferring miles. */
const MILES_THRESHOLD_METERS = 400;

/** Lowercases just the first character - for splicing a step's own
 * announcement[0] (which starts capitalized, being the start of its
 * *own* sentence normally - "Turn around.") into the middle of a
 * different sentence ("After that, you will turn around.") without the
 * mid-sentence capital reading like a typo. Not
 * spoken-aloud significant (TTS doesn't care about case), purely for
 * whatever also reads the on-screen alert/log text this feeds. */
function lowerFirst(text: string): string {
  return text.length > 0 ? text[0].toLowerCase() + text.slice(1) : text;
}

/** Rounded to the nearest 50 feet - "in 500 feet," not "in 483 feet,"
 * matching how every real turn-by-turn system phrases a lead
 * distance. Never negative (a maneuver that's technically already
 * slightly behind the live fix, from GPS jitter, still reads as
 * "right here" rather than a nonsensical negative distance). */
function roundedFeet(meters: number): number {
  return Math.max(0, Math.round((meters * METERS_TO_FEET) / 50) * 50);
}

/** Feet for a short distance, miles (to the nearest tenth) once it's
 * long enough that feet would read as an unwieldy quadruple-digit
 * number - a first stop a mile out from the depot, say. Shared by
 * nextActionPreviewPhrase below (a route-geometry distance between two
 * waypoints, not a live GPS lead time - advanceStagePhrase's own feet-
 * only phrasing stays as it was, since ADVANCE_LEAD_SECONDS' own short
 * lead time never produces a distance long enough to need miles). */
function roundedFeetOrMiles(meters: number): string {
  if (meters >= MILES_THRESHOLD_METERS) {
    const miles = Math.round((meters / METERS_PER_MILE) * 10) / 10;
    return `${miles} mile${miles === 1 ? "" : "s"}`;
  }
  return `${roundedFeet(meters)} feet`;
}

/** The short, close-range phrase, for whichever kind of step is coming
 * up next. A stop's own is just "Stop ahead." - short and immediate,
 * not the stop's own multi-part arrival announcement (number, address,
 * side, rider count) which wouldn't fit this close-range cue at all.
 * Every other kind reuses the same all-caps on-screen heading
 * StepContent already builds (stepHeading, parseRouteCsv.ts: "TURN
 * RIGHT", "PROCEED", "DEPART", ...) rather than a separate wording
 * table, just title-cased for speech instead of shouted. */
function terseStagePhrase(step: NavigationStep): string {
  if (step.kind === "stop") return "Stop ahead.";
  return `${titleCaseAction(step.heading ?? "Continue")}.`;
}

/** The longer, early-warning phrase. A stop's own names its own cross-
 * streets ("In 500 feet, stop at Main Street and Oak Avenue.") rather
 * than reusing its full arrival announcement, which is deliberately
 * multi-part (number, address, side, rider count, notes) in a way this
 * single early-warning line was never meant to carry. Every other kind
 * reuses the step's own already-built full announcement
 * (buildRouteFromRows, parseRouteCsv.ts) as the maneuver description,
 * just prefixed with a live distance and stripped of its own trailing
 * period first - deliberately not a separate hand-written template: a
 * turn with a street name typed in naturally produces "In 500 feet,
 * turn right onto Main Street" (the complex-turn phrasing), one with no
 * location typed produces "In 300 feet, turn right" (the simple-turn
 * phrasing), the same distinction this app's own data already carries.
 * Falls back to the terse stage phrase outright once the lead distance
 * itself rounds under 50 feet - "in 0 feet" is never worth saying. */
function advanceStagePhrase(step: NavigationStep, distanceMeters: number): string {
  const feet = roundedFeet(distanceMeters);
  if (feet < 50) return terseStagePhrase(step);
  if (step.kind === "stop") {
    const location = step.subheading ? ` at ${speakRoadNames(step.subheading)}` : "";
    return `In ${feet} feet, stop${location}.`;
  }
  const maneuver = (step.announcement[0] ?? terseStagePhrase(step)).replace(/\.\s*$/, "");
  return `In ${feet} feet, ${maneuver}.`;
}

/** The immediate, no-distance preview for a next step that sits within
 * SAME_INTERSECTION_METERS of the one that just became current -
 * spoken right in the same breath as that step's own arrival
 * announcement (the instant it finishes), not gated on GPS movement or
 * a rider-roster dismissal the way nextActionPreviewPhrase's own stop
 * case is below: there's no real travel between the two to wait
 * through, so there's nothing to gain by waiting. Deliberately never
 * "Next up" or "Next stop" - both start with the same word and read as
 * near-identical fragments in a synthesized voice, easy to mistake one
 * for the other in the half-second before the rest of the sentence
 * lands. "After that, you will be turning..."/"After that, you will
 * stop at..." reads unambiguously distinct even at a glance, let alone
 * spoken. */
function immediateNextActionPhrase(nextStep: NavigationStep): string {
  if (nextStep.kind === "stop") {
    return nextStep.subheading
      ? `After that, you will stop at ${speakRoadNames(nextStep.subheading)}.`
      : "After that, you will make another stop.";
  }
  if (nextStep.direction) {
    const street = nextStep.subheading ? ` onto ${speakRoadNames(nextStep.subheading)}` : "";
    return `After that, you will be turning ${nextStep.direction}${street}.`;
  }
  const detail = lowerFirst(
    (nextStep.announcement[0] ?? terseStagePhrase(nextStep)).replace(/\.\s*$/, ""),
  );
  return `After that, you will ${detail}.`;
}

/** The forward-looking preview of whatever's coming up *after* the step
 * that's current right now - "Your next stop will be at Main Street and
 * Oak Avenue, in 0.4 miles," "Then in 500 feet, turn right onto Elm
 * Street" - not the full detail that step's own arrival announcement
 * will speak once actually reached (a stop's own rider count, say),
 * just enough that an unfamiliar driver who can't glance at the map
 * knows roughly what to expect next and how far off it still is.
 * `distanceMeters` is the real route-geometry gap to it (distanceBetween
 * Waypoints below, not a live GPS lead time), omitted from the phrase
 * entirely whenever it isn't known yet (route geometry still loading) -
 * every non-stop, non-turn action (Proceed, Pull Over, Turn Around,
 * Return, Depart, Arrive) reuses that step's own already-built
 * announcement text rather than a separate hand-written phrasing for
 * each, same reasoning advanceStagePhrase's own doc comment gives for
 * reusing it there. */
function nextActionPreviewPhrase(nextStep: NavigationStep, distanceMeters: number | null): string {
  const distancePhrase = distanceMeters != null ? roundedFeetOrMiles(distanceMeters) : null;
  if (nextStep.kind === "stop") {
    const location = nextStep.subheading ? ` at ${speakRoadNames(nextStep.subheading)}` : "";
    if (!location) return "Your next stop is coming up.";
    return distancePhrase
      ? `Your next stop will be${location}, in ${distancePhrase}.`
      : `Your next stop will be${location}.`;
  }
  if (nextStep.direction) {
    const street = nextStep.subheading ? ` onto ${speakRoadNames(nextStep.subheading)}` : "";
    return distancePhrase
      ? `Then in ${distancePhrase}, turn ${nextStep.direction}${street}.`
      : `Your next turn will be ${nextStep.direction}${street}.`;
  }
  const detail = lowerFirst((nextStep.announcement[0] ?? "").replace(/\.\s*$/, ""));
  if (!detail) return "Your next stop is coming up.";
  return distancePhrase ? `Then in ${distancePhrase}, ${detail}.` : `Coming up next: ${detail}.`;
}

/** How far apart two waypoints actually sit along the route, in real
 * route meters - not as the crow flies, and not derived from a fresh
 * geometry search of its own (see WaypointProgress's own doc comment,
 * routeProgress.ts, for why that's never safe for a route that doubles
 * back). Null whenever either waypoint's own distance isn't known yet
 * (route geometry hasn't finished loading) - every caller here treats
 * that the same permissive way the rest of this app already treats "no
 * data yet": assume they're far apart rather than silently skipping a
 * warning or preview it has no real basis to skip. Exported for
 * useGpsAutoAdvance.ts's own same-corner check (a rider-roster
 * dismissal immediately advancing past a stop with no real turn to
 * wait through) - re-deriving this same geometry lookup a second way
 * there would risk the two files quietly disagreeing on what "the same
 * corner" means. */
export function distanceBetweenWaypoints(
  waypointDistances: LiveRouteProgress["waypointDistances"],
  aId: number,
  bId: number,
): number | null {
  const a = waypointDistances.find((w) => w.key === aId);
  const b = waypointDistances.find((w) => w.key === bId);
  if (!a || !b) return null;
  return Math.abs(b.distanceAlongRoute - a.distanceAlongRoute);
}

/**
 * The spoken narrative around each waypoint, on top of useRouteStepper's
 * own unconditional per-step arrival announcement (unchanged - still
 * fires in full the instant a step actually becomes current, GPS or
 * not). Two additional, purely additive pieces this hook adds:
 *
 *  - An early approach warning for the *upcoming* step - "In 500 feet,
 *    turn right onto Main Street," then a terse "Turn right." right
 *    before it (or a stop's own "In 500 feet, stop at ..." then "Stop
 *    ahead.") - timed off live GPS speed and distance
 *    (useLiveRouteProgress), not a fixed distance: a bus covers very
 *    different ground in the same lead time on a 25 mph neighborhood
 *    street versus a 45 mph county road. Timing itself lives in
 *    gpsStepPhase.ts's shared reducer (ADVANCE_LEAD_SECONDS/
 *    TERSE_LEAD_SECONDS and their own longer STOP_* counterparts) -
 *    this hook only reacts to the enteredApproachFar/enteredApproachNear
 *    events it emits for the upcoming step. Never spoken at all for a step
 *    within SAME_INTERSECTION_METERS of the current one - nothing to
 *    count down across a gap that short.
 *  - A forward-looking preview of that same upcoming step, naming
 *    roughly what's coming without its full detail - "Your next stop
 *    will be at ..., in N miles" / "Then in 500 feet, turn right onto
 *    ...". A step within SAME_INTERSECTION_METERS instead gets
 *    immediateNextActionPhrase's own no-distance wording, spoken the
 *    instant the current step's own arrival announcement finishes
 *    (`announcementDone`) - a driver who just checked in riders at a
 *    stop with a turn right there at the same corner needs to hear
 *    that turn now, not have it silently skipped the way this used to
 *    treat every same-corner pair. Otherwise: a turn/depart/arrive
 *    current step previews GPS-independently, same "we just made the
 *    turn" instant - but a *stop* only previews once either
 *    `dismissedStopId` names this same step (StepScreen's own signal
 *    that its rider check-in box was just checked in or dismissed) or
 *    live GPS shows the bus moving again, whichever comes first -
 *    matching "tell us the next thing the moment we're done with this
 *    stop," not "wait for us to have physically pulled away" the way
 *    this used to require unconditionally. Testing/reviewing a route at
 *    a desk (no GPS, so `dismissedStopId` never arrives either) simply
 *    never hears a stop's own preview, same graceful "nothing to speak
 *    of" fallback this hook already gives every GPS-dependent piece.
 *
 * The approach warning is a complete no-op under the same conditions:
 * no GPS permission, testing/reviewing a route at a desk, off-route,
 * stopped (see MOVING_THRESHOLD_MPS's own doc comment,
 * useLiveRouteProgress.ts) - whenever true, useRouteStepper's own
 * existing per-step announcement is the only thing a driver or someone
 * reviewing a route ever hears for it, exactly like before this hook
 * existed.
 */
export function useNavigationPrompts(
  route: Route,
  currentIndex: number,
  phase: StepPhase,
  started: boolean,
  paused: boolean,
  announcementDone: boolean,
  progress: LiveRouteProgress,
  /** StepScreen's own signal that the rider check-in box for this
   * stepId was just checked in (every rider tapped) or dismissed (the
   * box's own X) - see this hook's own doc comment above for what that
   * unlocks. A stepId that's already been consumed for its own preview
   * is simply ignored (the ref below already tracks that), so
   * StepScreen never needs to clear this back to null itself - a
   * different, later stop's own dismissal always carries a different
   * real stepId of its own. */
  dismissedStopId: number | null,
): void {
  // The upcoming step's own live phase state (gpsStepPhase.ts) - reset
  // the moment the upcoming step itself changes (a different stepId), so
  // advancing past one always starts the next fresh rather than
  // carrying over stale approach-stage state from whatever used to be
  // next. Keyed by stepId (NavigationStep.id), not waypointKey - the
  // shared cache-key text can repeat for two different real steps (a
  // loop road crossing the same other road twice - RouteMap.tsx's own
  // StopMarker doc comment has the full story), which would otherwise
  // make this treat the *second* one as already spoken the moment it
  // became upcoming, and skip its own warning entirely. -1 is the
  // "nothing tracked yet" sentinel - a real stepId is always >= 0.
  const approachStateRef = useRef<{ stepId: number; state: StepPhaseState }>({
    stepId: -1,
    state: initialStepPhaseState,
  });
  // Which *current* step's own next-action preview has already been
  // spoken - same -1 sentinel/reset story as spokenRef above, keyed on
  // the current step (not the upcoming one): the preview is about what
  // comes after the current step, but it's the current step becoming
  // current at all that resets whether this round's own preview has
  // gone out yet.
  const previewSpokenForStepIdRef = useRef(-1);

  const { onRoute, speedMps, distanceToWaypoint, waypointDistances } = progress;

  // The approach warning - see this hook's own doc comment above.
  useEffect(() => {
    if (!started || paused || phase !== "step") return;
    // The graceful-fallback gate - see MOVING_THRESHOLD_MPS's own doc
    // comment, useLiveRouteProgress.ts.
    if (!onRoute || speedMps == null || speedMps < MOVING_THRESHOLD_MPS) return;

    const current = route.steps[currentIndex];
    const upcoming = route.steps[currentIndex + 1];
    if (!current || !upcoming) return;

    const gapMeters = distanceBetweenWaypoints(waypointDistances, current.id, upcoming.id);
    if (gapMeters != null && gapMeters < SAME_INTERSECTION_METERS) return;

    if (approachStateRef.current.stepId !== upcoming.id) {
      approachStateRef.current = { stepId: upcoming.id, state: initialStepPhaseState };
    }

    const distanceMeters = distanceToWaypoint(upcoming.id);
    const isFinalStep = currentIndex + 1 === route.steps.length - 1;
    const { next, events } = advanceStepPhase(approachStateRef.current.state, {
      distanceMeters,
      speedMps,
      onRoute,
      sameCorner: false,
      isStop: upcoming.kind === "stop",
      isFinalStep,
      nowMs: Date.now(),
    });
    approachStateRef.current = { stepId: upcoming.id, state: next };

    // Checked closest-stage-first, not in lead-time order - see
    // gpsStepPhase.ts's own doc comment: a fix that lands the bus
    // already inside the terse-stage window (a GPS gap, or a maneuver
    // too close to have ever crossed the advance threshold on its own)
    // goes straight to the terse phrase rather than an "In 50 feet,
    // turn right" advance warning a half-second before the maneuver
    // itself - the reducer only ever emits one of these two per tick.
    if (events.includes("enteredApproachNear")) {
      speak(terseStagePhrase(upcoming));
    } else if (events.includes("enteredApproachFar") && distanceMeters != null) {
      speak(advanceStagePhrase(upcoming, distanceMeters));
    }
  }, [
    route,
    currentIndex,
    phase,
    started,
    paused,
    onRoute,
    speedMps,
    distanceToWaypoint,
    waypointDistances,
  ]);

  // The next-action preview - see this hook's own doc comment above.
  useEffect(() => {
    if (!started || paused || phase !== "step") return;

    const current = route.steps[currentIndex];
    if (!current || previewSpokenForStepIdRef.current === current.id) return;

    const next = route.steps[currentIndex + 1];
    if (!next) {
      // The route's own last step - nothing to preview.
      previewSpokenForStepIdRef.current = current.id;
      return;
    }

    // Never before the current step's own arrival announcement
    // (useRouteStepper.ts) has actually finished speaking, for any
    // case below - a preview of what's *next* has no business cutting
    // in front of the announcement for where the bus already is.
    if (!announcementDone) return;

    const gapMeters = distanceBetweenWaypoints(waypointDistances, current.id, next.id);

    if (gapMeters != null && gapMeters < SAME_INTERSECTION_METERS) {
      // Same corner - see immediateNextActionPhrase's own doc comment
      // for why this speaks right away instead of the skip this file
      // used to give a pair this close.
      previewSpokenForStepIdRef.current = current.id;
      speak(immediateNextActionPhrase(next));
      return;
    }

    if (current.kind !== "stop") {
      // GPS-independent otherwise - matching "we just made the turn."
      previewSpokenForStepIdRef.current = current.id;
      speak(nextActionPreviewPhrase(next, gapMeters));
      return;
    }

    // A stop - primed the instant its own rider check-in box is
    // checked in/dismissed (dismissedStopId), or, failing that, once
    // live GPS shows the bus actually moving again - matching "tell us
    // the next thing the moment we're done here," with GPS movement as
    // the fallback for whenever a driver never touches the box at all
    // (no riders expected, or they just drive off without dismissing
    // it). See this hook's own doc comment above for the full
    // reasoning; MOVING_THRESHOLD_MPS's own doc comment
    // (useLiveRouteProgress.ts) for why a missing/zero speed reads as
    // "not confirmed moving" rather than blocking this outright.
    const dismissed = dismissedStopId === current.id;
    const movingAgain = onRoute && speedMps != null && speedMps >= MOVING_THRESHOLD_MPS;
    if (!dismissed && !movingAgain) return;
    previewSpokenForStepIdRef.current = current.id;
    speak(nextActionPreviewPhrase(next, gapMeters));
  }, [
    route,
    currentIndex,
    phase,
    started,
    paused,
    announcementDone,
    onRoute,
    speedMps,
    waypointDistances,
    dismissedStopId,
  ]);
}
