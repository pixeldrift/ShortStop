"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

const TRANSITION_DURATION_MS = 320;

/** How much of the box's bottom edge fades to transparent, so the
 * incoming step doesn't just appear/disappear across a hard clipped
 * line as it slides up into (or out through) that edge. */
const BOTTOM_FADE_PX = 24;
const BOTTOM_FADE_MASK = `linear-gradient(to bottom, black calc(100% - ${BOTTOM_FADE_PX}px), transparent 100%)`;

/**
 * Swaps its children with an odometer-style roll instead of an instant
 * switch, whenever `transitionKey` changes: the outgoing content slides
 * straight up and out while the incoming content slides straight up and
 * in from below, both clipped to this element's own bounds instead of
 * spilling past them.
 *
 * The incoming content stays in normal document flow (so it's still what
 * determines this element's rendered height - the min-height guarantee
 * that keeps the map from letting the footer clip a two-line street name
 * still depends on that). Only the outgoing content is pulled out of
 * flow (absolutely positioned on top) for the moment it takes to animate
 * away.
 *
 * Clipping this element (`overflow-hidden`) would normally break that
 * height guarantee on its own: per the flex spec, a flex item's
 * *automatic* minimum size (`min-height: auto`) is zero once its own
 * overflow isn't visible, which would let this collapse instead of
 * forcing the map to shrink first. So the incoming content's own
 * measured height is re-applied here as an *explicit* min-height (via a
 * CSS custom property, not inline `min-height` directly, so
 * `landscape:min-h-0` from the caller can still win in landscape) -
 * unlike `auto`, an explicit length isn't zeroed by that rule.
 *
 * The box's own bottom edge fades to transparent (a `mask-image`, same
 * technique as the progress bar's left/right edge fades) rather than
 * clipping with a hard line - the incoming step slides up through that
 * edge from below, and a sharp cutoff there read as an abrupt pop-in
 * right as it crossed it. The top edge stays a hard clip on purpose:
 * this box has no gap above it (its caller sits it flush against the
 * progress bar), so an *outgoing* step disappearing at that edge reads
 * as sliding under the bar, not fading into empty space.
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
      timeoutRef.current = window.setTimeout(() => setExiting(null), TRANSITION_DURATION_MS);
    }
    prevRef.current = { key: transitionKey, node: children };
  }, [transitionKey, children]);

  useEffect(() => () => window.clearTimeout(timeoutRef.current), []);

  const contentRef = useRef<HTMLDivElement>(null);
  const [minHeight, setMinHeight] = useState<number>();

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const measure = () => setMinHeight(el.scrollHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [transitionKey]);

  return (
    <div
      className={`relative overflow-hidden min-h-[var(--step-min-h)] landscape:min-h-0 ${className ?? ""}`}
      style={
        {
          "--step-min-h": minHeight != null ? `${minHeight}px` : "0px",
          WebkitMaskImage: BOTTOM_FADE_MASK,
          maskImage: BOTTOM_FADE_MASK,
        } as CSSProperties
      }
    >
      <div key={transitionKey} ref={contentRef} className="animate-step-enter flex flex-col items-center gap-2">
        {children}
      </div>
      {exiting && (
        <div
          aria-hidden="true"
          className="animate-step-exit pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2"
        >
          {exiting.node}
        </div>
      )}
    </div>
  );
}
