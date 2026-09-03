"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

const EXIT_DURATION_MS = 300;

/**
 * Swaps its children with a slide+bounce transition instead of an instant
 * switch, whenever `transitionKey` changes - the new content (icon + street
 * name/signage together, as one block) scrolls up from below with a small
 * overshoot, while the previous content scrolls up and out on top of it.
 *
 * The incoming content stays in normal document flow (so it's still what
 * determines this element's rendered height - the min-height guarantee
 * that keeps the map from letting the footer clip a two-line street name
 * still depends on that). Only the outgoing content is pulled out of flow
 * (absolutely positioned over it) for the moment it takes to animate away.
 */
export function StepTransition({
  transitionKey,
  className,
  children,
}: {
  transitionKey: string;
  className?: string;
  children: ReactNode;
}) {
  const prevRef = useRef<{ key: string; node: ReactNode }>({
    key: transitionKey,
    node: children,
  });
  const [exiting, setExiting] = useState<{ key: string; node: ReactNode } | null>(null);
  const timeoutRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (prevRef.current.key !== transitionKey) {
      setExiting(prevRef.current);
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = window.setTimeout(() => setExiting(null), EXIT_DURATION_MS);
    }
    prevRef.current = { key: transitionKey, node: children };
  }, [transitionKey, children]);

  useEffect(() => () => window.clearTimeout(timeoutRef.current), []);

  return (
    <div className={`relative ${className ?? ""}`}>
      <div key={transitionKey} className="animate-step-enter flex flex-col items-center gap-2">
        {children}
      </div>
      {exiting && (
        <div
          aria-hidden="true"
          className="animate-step-exit pointer-events-none absolute inset-0 flex flex-col items-center gap-2"
        >
          {exiting.node}
        </div>
      )}
    </div>
  );
}
