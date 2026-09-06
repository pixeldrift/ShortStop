"use client";

import { useEffect, useState, type ReactNode } from "react";

const TRANSITION_DURATION_MS = 320;

type Direction = "forward" | "backward";

interface TransitionState {
  key: string;
  node: ReactNode;
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
 * into the app from the route list (Add Route, Edit Route, a selected
 * route's own trip flow), "backward" (the reverse) for every Cancel/
 * Back that returns to wherever that dive started from - set by the
 * caller alongside whatever setState actually changes `screenKey`
 * (page.tsx's own `navigate` helper), not inferred here from the key
 * change itself.
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
    node: children,
    direction,
    exiting: null,
  });

  if (state.key !== screenKey) {
    setState({
      key: screenKey,
      node: children,
      direction,
      exiting: { key: state.key, node: state.node, direction: state.direction },
    });
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
          state.direction === "forward" ? "animate-screen-enter-forward" : "animate-screen-enter-backward"
        }`}
      >
        {state.node}
      </div>
    </div>
  );
}
