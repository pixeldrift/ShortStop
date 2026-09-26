"use client";

import { useEffect, useRef } from "react";
import type { StepPhase } from "./useRouteStepper";

/**
 * Fires once, the instant live GPS shows the bus has genuinely left the
 * route it was confirmed to be on - not the instant a fix simply hasn't
 * arrived yet (LiveRouteProgress's own `onRoute` starts false before the
 * first usable fix, same as "off route," but there was never an "on
 * route" state to lose in that case), and not again on every later tick
 * while still off it. `onOffRoute` is StepScreen's own real reaction
 * (pause the trip, announce it) - this hook only ever detects the one
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
 * fire again.
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
    if (phase === "step" && started && !paused && wasOnRouteRef.current && !onRoute) {
      onOffRoute();
    }
    wasOnRouteRef.current = onRoute;
  }, [phase, started, paused, onRoute, onOffRoute]);
}
