"use client";

import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";

// Matches globals.css's own .animate-tooltip-fade duration - the label
// unmounts right as that animation finishes, rather than tracking a
// separate "exiting" state to fade it back out on close.
const TOOLTIP_VISIBLE_MS = 1800;

/**
 * Wraps an icon (TripTypeIcon/SchoolLevelIcon today, wherever either
 * pairs with a route number - RouteListScreen, StartScreen,
 * EditRouteScreen, TopBar) with a tap-to-reveal, auto-fading text label.
 * Neither icon carries its own text (no "AM"/"PM" caption, no school-
 * level word - see TripTypeIcon.tsx's own doc comment for why), so
 * there was previously no way for a driver unfamiliar with the app to
 * confirm what either glyph actually means.
 *
 * `as="span"` for a caller whose icon already sits inside another
 * tappable element (a RouteListScreen row, say) - a real <button>
 * nested inside another interactive element is invalid HTML, and would
 * also fight that outer element's own tap target. The span still gets
 * its own role/tabIndex/keyboard handling so it behaves like a button
 * without literally being one. Either way this always calls
 * stopPropagation on its own tap, so revealing the tooltip never also
 * triggers whatever the surrounding row/button does (selecting a route,
 * say) - but it can only stop *this* tap from bubbling, so a caller
 * whose icon sits inside something else tappable still needs `as`
 * set to "span" rather than relying on stopPropagation alone (a
 * `<button>` inside a `<button>` is invalid regardless of whether the
 * click ever actually reaches the outer one).
 */
export function IconTooltip({
  label,
  as = "button",
  className,
  children,
}: {
  label: string;
  as?: "button" | "span";
  className?: string;
  children: ReactNode;
}) {
  // 0 means hidden; any other value both shows the tooltip and (via key)
  // restarts its fade animation from scratch on a repeat tap, rather
  // than the repeat tap doing nothing while one's already fading out.
  const [visibleKey, setVisibleKey] = useState(0);
  const timeoutRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    return () => window.clearTimeout(timeoutRef.current);
  }, []);

  function reveal(e: MouseEvent | KeyboardEvent) {
    e.stopPropagation();
    window.clearTimeout(timeoutRef.current);
    setVisibleKey((k) => k + 1);
    timeoutRef.current = window.setTimeout(() => setVisibleKey(0), TOOLTIP_VISIBLE_MS);
  }

  const content = (
    <>
      {children}
      {/* aria-hidden - the wrapper's own aria-label below already gives
          screen readers this same text as its accessible name, so the
          floating visual copy would otherwise be announced twice. */}
      {visibleKey > 0 && (
        <span
          key={visibleKey}
          aria-hidden="true"
          className="animate-tooltip-fade pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 -translate-x-1/2 rounded-md bg-zinc-900 px-2 py-1 text-xs font-semibold whitespace-nowrap text-white shadow-lg"
        >
          {label}
        </span>
      )}
    </>
  );

  if (as === "span") {
    return (
      <span
        role="button"
        tabIndex={0}
        aria-label={label}
        onClick={reveal}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") reveal(e);
        }}
        className={`relative inline-flex ${className ?? ""}`}
      >
        {content}
      </span>
    );
  }

  return (
    <button
      type="button"
      aria-label={label}
      onClick={reveal}
      className={`relative inline-flex ${className ?? ""}`}
    >
      {content}
    </button>
  );
}
