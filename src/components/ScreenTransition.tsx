"use client";

import { useEffect, useState, type ReactNode } from "react";

const TRANSITION_DURATION_MS = 320;

type Direction = "forward" | "backward";

interface TransitionState {
  key: string;
  direction: Direction;
  exiting: { key: string; node: ReactNode; direction: Direction } | null;
}

/**
 * Swaps its children with a horizontal push instead of an instant
 * switch, whenever `screenKey` changes - the outgoing screen slides
 * fully off to one side while the incoming one slides in from the
 * other, both absolutely positioned over this element's own bounds so
 * neither affects its size mid-transition. `direction` says which way:
 * "forward" (out to the left, in from the right) for every dive deeper
 * into the app - List -> a route's own info screen, that screen's own
 * "Start Route" into turn-by-turn driving, List -> Add Route/Edit
 * Route - "backward" (the reverse) for every Cancel/Back/"Exit Route"
 * that unwinds one of those. Set by the caller alongside whatever
 * setState actually changes `screenKey` (page.tsx's own `navigate`
 * helper, or RouteApp's own local `started` flip below), not inferred
 * here from the key change itself.
 *
 * Capturing the outgoing screen has to happen *during* the same render
 * that swaps to the new one, not in a `useEffect` afterward - an effect
 * only runs after that render has already committed and painted, by
 * which point the old content (keyed under the old `screenKey`) has
 * already been unmounted with nothing left to animate out. This uses
 * React's supported "adjust state while rendering" pattern instead
 * (calling `setState` mid-render when a prop changed since the last
 * one) so the very first commit that shows the new screen already has
 * the old one captured alongside it, both animating in the same paint.
 *
 * The settled (non-exiting) side renders `children` directly on every
 * render, never a snapshot held in state - `screenKey` can stay the
 * same across many renders whose `children` still change underneath it
 * (RouteApp's own "step" key covers the whole trip, but `StepScreen`
 * still needs every `phase`/`currentStep` update along the way as the
 * driver advances - an earlier version of this component froze
 * `children` in state the moment `screenKey` first settled and never
 * looked at it again, which left the whole driving screen stuck on its
 * very first paint ("Ready to Depart") with every later click on
 * Start/the progress bar updating state that nothing ever rendered).
 *
 * `lastSettled` tracks the most recently rendered children for whatever
 * key is currently active, kept in sync with the same "adjust state
 * while rendering" trick as `state` itself (not a ref - reading or
 * writing a ref mid-render is banned by this repo's lint rules; not a
 * `useEffect` either, since a ref/state update that only lands *after*
 * paint would still be one commit too late to capture the true "last
 * screen" the moment `screenKey` changes) so that whenever `screenKey`
 * *does* change, the exiting snapshot is genuinely "whatever was last
 * on screen" for the outgoing key, not whatever happened to be there
 * the first time that key ever mounted.
 */
export function ScreenTransition({
  screenKey,
  direction,
  children,
}: {
  screenKey: string;
  direction: Direction;
  children: ReactNode;
}) {
  const [state, setState] = useState<TransitionState>({
    key: screenKey,
    direction,
    exiting: null,
  });
  const [lastSettled, setLastSettled] = useState<{ key: string; node: ReactNode }>({
    key: screenKey,
    node: children,
  });

  if (state.key !== screenKey) {
    setState({
      key: screenKey,
      direction,
      // This transition's own `direction` (the prop), not `state.direction`
      // (the *previous* transition's, still sitting in `state` at this
      // point) - the exiting and entering screens need to move together
      // (both left for "forward", both right for "backward"), and using
      // the stale value here had them moving in opposite directions
      // instead whenever a transition's direction actually differed from
      // the one before it (any real forward-then-back sequence).
      exiting: { key: lastSettled.key, node: lastSettled.node, direction },
    });
  }

  if (lastSettled.key !== screenKey || lastSettled.node !== children) {
    setLastSettled({ key: screenKey, node: children });
  }

  useEffect(() => {
    if (!state.exiting) return;
    const timeout = window.setTimeout(() => {
      setState((prev) => (prev.exiting ? { ...prev, exiting: null } : prev));
    }, TRANSITION_DURATION_MS);
    return () => window.clearTimeout(timeout);
  }, [state.exiting]);

  return (
    <div className="relative flex flex-1 overflow-hidden">
      {state.exiting && (
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute inset-0 flex flex-col ${
            state.exiting.direction === "forward" ? "animate-screen-exit-forward" : "animate-screen-exit-backward"
          }`}
        >
          {state.exiting.node}
        </div>
      )}
      <div
        key={state.key}
        className={`absolute inset-0 z-10 flex flex-col ${
          // No animation at all when there's nothing exiting alongside it -
          // covers both this component's very first mount ever (nothing to
          // push in from anywhere) and, critically, a *nested* ScreenTransition
          // (RouteApp's own start/step one) mounting fresh as part of a
          // larger outer push that's already animating it in - without this,
          // that inner instance played its own enter animation on top of the
          // outer one moving it, so the incoming content visibly moved twice
          // (once via the outer transform, again via its own), never actually
          // looking like one rigid screen sliding in align with the one
          // sliding out.
          state.exiting == null
            ? ""
            : state.direction === "forward"
              ? "animate-screen-enter-forward"
              : "animate-screen-enter-backward"
        }`}
      >
        {children}
      </div>
    </div>
  );
}
