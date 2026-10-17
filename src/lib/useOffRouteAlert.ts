"use client";

import { useEffect, useRef } from "react";
import type { StepPhase } from "./useRouteStepper";

/** How long `onRoute` has to read false *continuously* before this
 * treats it as a genuine departure from the route, not one noisy/
 * imprecise GPS fix or a routed line that runs a little wide of the
 * real road for a stretch (MAX_ON_ROUTE_METERS' own doc comment already
 * flags that threshold as "not tuned against real driving data yet").
 * Before this, a single bad tick paused the whole trip - and everything
 * gated on `paused` along with it, including useNavigationPrompts' own
 * approach warning and useGpsAutoAdvance's own auto-advance - right in
 * the middle of a genuine, on-road approach to a stop, until GPS
 * happened to read back on-route again (often not until right at the
 * stop itself, which reads as "nothing told me when to stop, but
 * arrival still worked"). ~8 seconds - past ordinary GPS-fix noise
 * (fixes land every ~1-5s under enableHighAccuracy), short enough that
 * a real, sustained wrong turn is still caught within a block or two at
 * ordinary residential speed. */
const OFF_ROUTE_CONFIRM_MS = 8000;

/**
 * Fires once `onRoute` has read false continuously for
 * OFF_ROUTE_CONFIRM_MS - genuinely left the route it was confirmed to
 * be on, not the instant a fix simply hasn't arrived yet
 * (LiveRouteProgress's own `onRoute` starts false before the first
 * usable fix, same as "off route," but there was never an "on route"
 * state to lose in that case), and not again on every later tick while
 * still off it. `onOffRoute` is StepScreen's own real reaction (pause
 * the trip, announce it) - this hook only ever detects the confirmed
 * true->false transition and hands off to that, the same "detect here,
 * react in StepScreen" split useGpsAutoAdvance's own onStopAndGoDetected
 * uses.
 *
 * Naturally quiets itself once `onOffRoute` actually pauses the trip
 * (the real caller's own implementation) - `paused` becoming true is
 * itself one of this hook's own gates, so a bus that stays off-route
 * for a while doesn't get re-alerted on every subsequent fix, only once
 * per genuine departure from the route. Resuming (still off-route) and
 * drifting back on then off again later is a fresh departure, and does
 * fire again (its own fresh OFF_ROUTE_CONFIRM_MS wait included).
 */
export function useOffRouteAlert(
  phase: StepPhase,
  started: boolean,
  paused: boolean,
  onRoute: boolean,
  onOffRoute: () => void,
): void {
  const wasOnRouteRef = useRef(false);

  useEffect(() => {
    const wasOnRoute = wasOnRouteRef.current;
    wasOnRouteRef.current = onRoute;
    if (phase !== "step" || !started || paused) return;
    if (!wasOnRoute || onRoute) return;
    // Just transitioned true -> false this tick - wait for it to hold
    // before treating it as real. Cleanup (a re-render with a different
    // onRoute/paused/etc. before the timer fires) cancels this exactly
    // like a fresh fix reading back on-route should.
    const timer = setTimeout(onOffRoute, OFF_ROUTE_CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [phase, started, paused, onRoute, onOffRoute]);
}
