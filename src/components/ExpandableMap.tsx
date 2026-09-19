"use client";

import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import { CloseIcon, ExpandIcon } from "./icons";

/**
 * Wraps any one map box (RouteMap, WaypointPreviewMap, ...) with a
 * small expand button in its own top-right corner - tapping it opens a
 * *second*, independent instance of the same map, full-screen, with an
 * X in that same corner to close it again.
 *
 * Deliberately a second instance, not the original map resized in
 * place - neither RouteMap.tsx nor WaypointPreviewMap.tsx currently
 * tells Leaflet/MapLibre to re-measure its container after a resize
 * (no ResizeObserver, no invalidateSize()/resize() call anywhere in
 * either file), because nothing before this ever needed to: every map
 * box on screen today is a fixed size for its own whole mounted
 * lifetime. Growing the *existing* map's own container to fill the
 * screen would silently leave both engines still measuring against
 * their old, small size (cropped/blank tiles) unless that plumbing got
 * added and tested against both engines - a second instance sidesteps
 * that entirely by being born at full size from its very first paint,
 * which is exactly the size it's ever asked to render at.
 *
 * Portaled to document.body rather than rendered in place - a plain
 * `fixed inset-0` can still end up boxed inside whatever ancestor
 * happens to hold it (this screen's own slide-transition wrapper sets
 * a CSS transform while animating, which creates a containing block
 * for any `fixed` descendant even after the animation settles back to
 * an identity transform) - a portal guarantees this always covers the
 * true viewport regardless of where in the tree it's mounted from.
 */
export function ExpandableMap({
  renderMap,
  className,
}: {
  /** Renders one map instance, sized to fill whatever `className` this
   * is handed - called once for the normal inline box, and again for a
   * second, independent instance when expanded (`isExpanded` tells
   * which is which, e.g. to drop a rounded-corner/border treatment
   * that only makes sense on the small inline box, not filling the
   * whole screen edge to edge). */
  renderMap: (className: string, isExpanded: boolean) => React.ReactNode;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);

  // Nothing else on screen should still be reachable while a
  // full-screen map covers it - same "trap Escape/scroll while this is
  // the only thing on screen" reasoning any full-screen overlay in this
  // app would want, kept here rather than relying on every future
  // caller to remember it.
  useEffect(() => {
    if (!expanded) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setExpanded(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [expanded]);

  return (
    <div className={`relative ${className ?? ""}`}>
      {renderMap("h-full w-full", false)}
      <button
        type="button"
        onClick={() => setExpanded(true)}
        aria-label="Expand map to full screen"
        className="btn-glossy-light absolute top-2 right-2 z-20 flex h-8 w-8 items-center justify-center rounded-lg bg-white/90 text-zinc-900"
      >
        <ExpandIcon className="h-4 w-4" />
      </button>
      {expanded &&
        createPortal(
          <div className="fixed inset-0 z-50 bg-black">
            {renderMap("h-full w-full", true)}
            <button
              type="button"
              onClick={() => setExpanded(false)}
              aria-label="Close full-screen map"
              className="btn-glossy-light absolute top-2 right-2 z-20 flex h-8 w-8 items-center justify-center rounded-lg bg-white/90 text-zinc-900"
            >
              <CloseIcon className="h-4 w-4" />
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}
