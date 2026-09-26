"use client";

import { useEffect, useRef } from "react";
import type { Route } from "./types";
import type { LiveRouteProgress } from "./useLiveRouteProgress";
import type { StepPhase } from "./useRouteStepper";

/** Same "bus is genuinely moving toward it" gate useNavigationPrompts.ts
 * uses for its own heads-up warnings - a stationary or GPS-denied bus
 * should never auto-advance out from under a driver reviewing the route
 * at a desk, or actually stopped mid-route. */
const MOVING_THRESHOLD_MPS = 0.9;

/** How far past a step's own waypoint (route meters, negative once
 * behind the live fix - see LiveRouteProgress's own distanceToWaypoint
 * doc comment) the live fix has to read before this actually advances -
 * a small buffer past the exact crossing point, not the instant it
 * reads negative at all, so one noisy fix that barely dips past zero
 * then immediately reads positive again doesn't fire a premature
 * advance a moment before the bus has actually cleared the stop/turn. */
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

/**
 * Advances the current step automatically once live GPS shows the bus
 * has actually passed it - the "drive the route hands-free" half of the
 * GPS story useNavigationPrompts.ts only ever half-built (that hook
 * speaks an early heads-up but never itself calls onAdvance - see its
 * own doc comment for why that was left for later).
 *
 * Purely additive: every manual input (footer Next/Back, tap-to-advance,
 * Bluetooth remote, keyboard) keeps working exactly as before, and this
 * is a complete no-op under the same conditions useNavigationPrompts
 * already treats as "nothing to act on" - no GPS permission, testing a
 * route at a desk, off-route, or stopped (MOVING_THRESHOLD_MPS above).
 *
 * `holdForRoster` - true while the current step's own rider check-in box
 * still needs a look (a stop with expected riders whose box hasn't been
 * opened, then dismissed, yet). Computed by StepScreen itself, not here -
 * only it tracks the box's own autoOfferedStepId/viewedStepIndex state -
 * so this hook stays a plain "GPS says go" signal that StepScreen can
 * veto for its own reasons, rather than reaching into that state
 * directly. Advancing out from under a still-open (or not-yet-shown)
 * check-in card would skip past it before the driver ever got to mark
 * riders off.
 */
export function useGpsAutoAdvance(
  route: Route,
  currentIndex: number,
  phase: StepPhase,
  paused: boolean,
  holdForRoster: boolean,
  progress: LiveRouteProgress,
  onAdvance: () => void,
): void {
  const { onRoute, speedMps, distanceToWaypoint } = progress;

  // Which step's own waypoint this has already advanced past - guards
  // against firing again on every later GPS tick while the live fix
  // keeps reading past the same step, right up until currentIndex
  // itself actually changes underneath it (a different step.id, which
  // this ref no longer matches). -1 is the "nothing advanced yet"
  // sentinel - a real stepId is always >= 0.
  const advancedForStepIdRef = useRef(-1);

  useEffect(() => {
    if (phase !== "step" || paused || holdForRoster) return;
    if (!onRoute || speedMps == null || speedMps < MOVING_THRESHOLD_MPS) return;

    const step = route.steps[currentIndex];
    if (!step || advancedForStepIdRef.current === step.id) return;

    const distanceMeters = distanceToWaypoint(step.id);
    const threshold =
      currentIndex === route.steps.length - 1 ? PAST_FINAL_WAYPOINT_METERS : PAST_WAYPOINT_METERS;
    if (distanceMeters == null || distanceMeters > threshold) return;

    advancedForStepIdRef.current = step.id;
    onAdvance();
  }, [
    route,
    currentIndex,
    phase,
    paused,
    holdForRoster,
    onRoute,
    speedMps,
    distanceToWaypoint,
    onAdvance,
  ]);
}
