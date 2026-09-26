"use client";

import { useEffect, useRef } from "react";
import { titleCaseAction } from "./parseRouteCsv";
import { speak, speakRoadNames } from "./speech";
import type { NavigationStep, Route } from "./types";
import { MOVING_THRESHOLD_MPS } from "./useLiveRouteProgress";
import type { LiveRouteProgress } from "./useLiveRouteProgress";
import type { StepPhase } from "./useRouteStepper";

/** ~15 seconds before a turn/depart/arrive maneuver - a real navigation
 * system's own "advance notice" window (5-10s for a passenger car),
 * lengthened for a school bus: it takes longer to stop, and the driver
 * is more likely to be mid-conversation with the riders than a solo
 * driver would be. */
const ADVANCE_LEAD_SECONDS = 15;
/** Longer than ADVANCE_LEAD_SECONDS above - a stop means actually
 * coming to a full halt, not just a turn of the wheel, and a bus needs
 * real extra distance to do that safely once loaded. */
const STOP_ADVANCE_LEAD_SECONDS = 20;
/** ~4 seconds before a turn/depart/arrive maneuver - the short,
 * immediate confirmation right as it arrives, same reasoning as
 * ADVANCE_LEAD_SECONDS above for why this runs a little longer than a
 * typical passenger-car app's own close-range cue. */
const TERSE_LEAD_SECONDS = 4;
/** Same idea as STOP_ADVANCE_LEAD_SECONDS above, for the close-range
 * cue - a bus committing to a full stop needs a little more of this
 * final window too, not just the earlier advance notice. */
const STOP_TERSE_LEAD_SECONDS = 6;

/** How close together (route meters) two consecutive waypoints have to
 * be before this treats them as "the same intersection" - a stop
 * immediately followed by a turn at that same corner, say. Neither an
 * approach warning nor a next-action preview is worth speaking for a
 * gap this short: there's no real travel time to warn across, and a
 * "your next turn will be..." preview spoken in the same breath as the
 * stop's own arrival announcement just reads as noise, not help. ~65
 * feet - short enough that this never swallows a genuinely close pair
 * of real, separate waypoints on a tight residential block.
 * Conservative default (never skip) whenever the gap can't be measured
 * yet (route geometry hasn't loaded) - see distanceBetweenWaypoints'
 * own doc comment. */
const SAME_INTERSECTION_METERS = 20;

const METERS_TO_FEET = 3.28084;

/** Rounded to the nearest 50 feet - "in 500 feet," not "in 483 feet,"
 * matching how every real turn-by-turn system phrases a lead
 * distance. Never negative (a maneuver that's technically already
 * slightly behind the live fix, from GPS jitter, still reads as
 * "right here" rather than a nonsensical negative distance). */
function roundedFeet(meters: number): number {
  return Math.max(0, Math.round((meters * METERS_TO_FEET) / 50) * 50);
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

/** The short forward-looking preview of whatever's coming up *after*
 * the step that's current right now - "Your next stop will be at Main
 * Street and Oak Avenue," "Your next turn will be right onto Elm
 * Street" - not the full detail that step's own arrival announcement
 * will speak once actually reached (a stop's own rider count, say),
 * just enough that an unfamiliar driver who can't glance at the map
 * knows roughly what to expect next. Every non-stop, non-turn action
 * (Proceed, Pull Over, Turn Around, Return, Depart, Arrive) reuses that
 * step's own already-built announcement text rather than a separate
 * hand-written phrasing for each, same reasoning advanceStagePhrase's
 * own doc comment gives for reusing it there. */
function nextActionPreviewPhrase(nextStep: NavigationStep): string {
  if (nextStep.kind === "stop") {
    return nextStep.subheading
      ? `Your next stop will be at ${speakRoadNames(nextStep.subheading)}.`
      : "Your next stop is coming up.";
  }
  if (nextStep.direction) {
    return nextStep.subheading
      ? `Your next turn will be ${nextStep.direction} onto ${speakRoadNames(nextStep.subheading)}.`
      : `Your next turn will be to the ${nextStep.direction}.`;
  }
  const detail = (nextStep.announcement[0] ?? "").replace(/\.\s*$/, "");
  return detail ? `Coming up next: ${detail}.` : "Your next stop is coming up.";
}

/** How far apart two waypoints actually sit along the route, in real
 * route meters - not as the crow flies, and not derived from a fresh
 * geometry search of its own (see WaypointProgress's own doc comment,
 * routeProgress.ts, for why that's never safe for a route that doubles
 * back). Null whenever either waypoint's own distance isn't known yet
 * (route geometry hasn't finished loading) - every caller here treats
 * that the same permissive way the rest of this app already treats "no
 * data yet": assume they're far apart rather than silently skipping a
 * warning or preview it has no real basis to skip. */
function distanceBetweenWaypoints(
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
 *    street versus a 45 mph county road. See ADVANCE_LEAD_SECONDS/
 *    TERSE_LEAD_SECONDS (and their own longer STOP_* counterparts)
 *    above for the actual lead times.
 *  - A short forward-looking preview of that same upcoming step,
 *    naming roughly what's coming without its full detail - "Your next
 *    stop will be at ..." / "Your next turn will be ...". Spoken once
 *    per step, right as the *previous* maneuver is actually finished:
 *    immediately once the current step's own arrival announcement has
 *    finished speaking (`announcementDone`) for a turn/depart/arrive
 *    step - GPS-independent, matching "we just made the turn" - or, for
 *    a stop, only once live GPS shows the bus moving again afterward -
 *    matching "we're beginning to move again after a stop," since
 *    there's no reason to narrate what's next while still loading
 *    riders. Neither the warning nor the preview is spoken at all when
 *    the current and upcoming waypoints sit within
 *    SAME_INTERSECTION_METERS of each other (a stop immediately
 *    followed by a turn at that same corner, say) - nothing useful to
 *    warn about or preview across a gap that short.
 *
 * Both pieces are a complete no-op under the same conditions: no GPS
 * permission, testing/reviewing a route at a desk, off-route, stopped
 * (for the approach warning and a stop's own preview alike - see
 * MOVING_THRESHOLD_MPS's own doc comment, useLiveRouteProgress.ts).
 * Whenever either is true, useRouteStepper's own existing per-step
 * announcement is the only thing a driver or someone reviewing a route
 * ever hears, exactly like before this hook existed.
 */
export function useNavigationPrompts(
  route: Route,
  currentIndex: number,
  phase: StepPhase,
  started: boolean,
  paused: boolean,
  announcementDone: boolean,
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
  // became upcoming, and skip its own warning entirely. -1 is the
  // "nothing spoken yet" sentinel - a real stepId is always >= 0.
  const spokenRef = useRef<{ key: number; advance: boolean; terse: boolean }>({
    key: -1,
    advance: false,
    terse: false,
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

    if (spokenRef.current.key !== upcoming.id) {
      spokenRef.current = { key: upcoming.id, advance: false, terse: false };
    }
    const spoken = spokenRef.current;
    if (spoken.advance && spoken.terse) return;

    const distanceMeters = distanceToWaypoint(upcoming.id);
    if (distanceMeters == null || distanceMeters <= 0) return;

    const timeToManeuverSeconds = distanceMeters / speedMps;
    const terseLead = upcoming.kind === "stop" ? STOP_TERSE_LEAD_SECONDS : TERSE_LEAD_SECONDS;
    const advanceLead = upcoming.kind === "stop" ? STOP_ADVANCE_LEAD_SECONDS : ADVANCE_LEAD_SECONDS;

    // Checked closest-stage-first, not in lead-time order - a fix that
    // lands the bus already inside the terse-stage window (a GPS gap,
    // or a maneuver too close to have ever crossed the advance
    // threshold on its own) should go straight to the terse phrase
    // rather than an "In 50 feet, turn right" advance warning a half-
    // second before the maneuver itself.
    if (!spoken.terse && timeToManeuverSeconds <= terseLead) {
      spoken.advance = true;
      spoken.terse = true;
      speak(terseStagePhrase(upcoming));
    } else if (!spoken.advance && timeToManeuverSeconds <= advanceLead) {
      spoken.advance = true;
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

    const gapMeters = distanceBetweenWaypoints(waypointDistances, current.id, next.id);
    if (gapMeters != null && gapMeters < SAME_INTERSECTION_METERS) {
      previewSpokenForStepIdRef.current = current.id;
      return;
    }

    // Never before the current step's own arrival announcement
    // (useRouteStepper.ts) has actually finished speaking, for either
    // kind - a preview of what's *next* has no business cutting in
    // front of the announcement for where the bus already is.
    if (!announcementDone) return;

    if (current.kind !== "stop") {
      // GPS-independent otherwise - matching "we just made the turn."
      previewSpokenForStepIdRef.current = current.id;
      speak(nextActionPreviewPhrase(next));
      return;
    }

    // A stop - deferred until live GPS shows the bus actually moving
    // again, matching "we're beginning to move again after a stop." A
    // complete no-op without GPS, same graceful-fallback story as the
    // approach warning above - there's no "moving again" to speak of at
    // a desk.
    if (!onRoute || speedMps == null || speedMps < MOVING_THRESHOLD_MPS) return;
    previewSpokenForStepIdRef.current = current.id;
    speak(nextActionPreviewPhrase(next));
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
  ]);
}
