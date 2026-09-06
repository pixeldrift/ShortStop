"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

const TRANSITION_DURATION_MS = 320;

type Direction = "forward" | "backward";

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
 * Modeled on StepTransition's own outgoing-absolute/incoming-in-flow
 * approach, but simpler: every screen used here already fills its own
 * `flex-1` box at a fixed size (this element's own, via the `flex-1`
 * below), so there's no odometer-style height measurement to do - both
 * the incoming and outgoing screen are absolutely positioned for the
 * whole transition, and this wrapper's own size never depends on
 * either one.
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
  const prevRef = useRef<{ key: string; node: ReactNode; direction: Direction }>({
    key: screenKey,
    node: children,
    direction,
  });
  const [exiting, setExiting] = useState<{
    key: string;
    node: ReactNode;
    direction: Direction;
  } | null>(null);
  const timeoutRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (prevRef.current.key !== screenKey) {
      setExiting(prevRef.current);
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = window.setTimeout(() => setExiting(null), TRANSITION_DURATION_MS);
    }
    prevRef.current = { key: screenKey, node: children, direction };
  }, [screenKey, children, direction]);

  useEffect(() => () => window.clearTimeout(timeoutRef.current), []);

  return (
    <div className="relative flex flex-1 overflow-hidden">
      <div
        key={screenKey}
        className={`absolute inset-0 flex flex-col ${
          direction === "forward" ? "animate-screen-enter-forward" : "animate-screen-enter-backward"
        }`}
      >
        {children}
      </div>
      {exiting && (
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute inset-0 flex flex-col ${
            exiting.direction === "forward" ? "animate-screen-exit-forward" : "animate-screen-exit-backward"
          }`}
        >
          {exiting.node}
        </div>
      )}
    </div>
  );
}
