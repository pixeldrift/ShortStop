"use client";

import { useEffect, useRef } from "react";

// Only a touch/drag starting within this many px of the screen's own
// left edge counts - matching iOS's own edge-swipe-back convention,
// and deliberately narrow so this never fights a gesture meant for
// something else further into the screen (a scrollable list, a drag-
// to-reorder handle, a horizontally-scrolling row) - none of those
// start a touch right at the very edge.
const EDGE_ZONE_PX = 32;
// How far right a swipe has to travel to count as "back", not an
// accidental brush near the edge.
const SWIPE_MIN_DISTANCE_PX = 60;
// How much vertical drift is still tolerated - rules out a scroll
// gesture that happened to start near the edge.
const SWIPE_MAX_VERTICAL_PX = 50;
// Has to be a quick flick, not a slow drag - rules out e.g. a driver
// resting a finger near the edge while scrolling something else.
const SWIPE_MAX_DURATION_MS = 600;

/**
 * A right-swipe-to-go-back gesture, matching iOS's own edge-swipe-back
 * convention - attach the returned ref to whatever element already
 * contains this screen's own "Back"/"Cancel" button, and a swipe
 * starting near that element's own left edge, moving right at least
 * SWIPE_MIN_DISTANCE_PX within SWIPE_MAX_DURATION_MS and without too
 * much vertical drift, calls the same `onBack` that button already
 * does. Pointer events (not touchstart/touchmove) so a mouse drag
 * works too, not just a real touchscreen - this app targets tablets,
 * but development happens on a mouse.
 *
 * Deliberately not wired up everywhere a "Back"/"Cancel"/close button
 * exists - only the handful of top-level screens with one clear, single
 * way back (StartScreen, StepScreen, SchoolListScreen, RouteListScreen's
 * school-scoped reuse). EditRouteScreen's own Cancel/Back buttons are
 * left out: it already has its own pointer-based drag-to-reorder
 * gesture (the Waypoints list's own drag handle) that a screen-wide
 * swipe listener could end up fighting, and it has more than one
 * "back" target depending on which of its own sub-screens is showing -
 * neither risk is worth taking on for a gesture this
 * secondary. Likewise skipped for modals/popups (StepRowEditor's own
 * close X, ConfirmModal, ...) - a swipe reads as page navigation, not
 * "dismiss this popup," so wiring it there would be surprising more
 * often than it'd be convenient.
 *
 * `onBack` is read fresh on every gesture (a ref, not a dependency) so
 * a caller's own inline handler doesn't need to be memoized to avoid
 * re-attaching listeners on every render. stopPropagation on a
 * completed swipe keeps a nested useSwipeBack (there isn't one today,
 * but nothing stops a future caller from nesting screens) from also
 * firing its own outer onBack for the same gesture.
 */
export function useSwipeBack<T extends HTMLElement>(onBack: (() => void) | undefined) {
  const ref = useRef<T>(null);
  const onBackRef = useRef(onBack);
  useEffect(() => {
    onBackRef.current = onBack;
  }, [onBack]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let startX = 0;
    let startY = 0;
    let startTime = 0;
    let tracking = false;

    function handlePointerDown(e: PointerEvent) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (e.clientX - rect.left > EDGE_ZONE_PX) return;
      startX = e.clientX;
      startY = e.clientY;
      startTime = Date.now();
      tracking = true;
    }

    function handlePointerUp(e: PointerEvent) {
      if (!tracking) return;
      tracking = false;
      const dx = e.clientX - startX;
      const dy = Math.abs(e.clientY - startY);
      const dt = Date.now() - startTime;
      if (dx >= SWIPE_MIN_DISTANCE_PX && dy <= SWIPE_MAX_VERTICAL_PX && dt <= SWIPE_MAX_DURATION_MS) {
        e.stopPropagation();
        onBackRef.current?.();
      }
    }

    function handlePointerCancel() {
      tracking = false;
    }

    el.addEventListener("pointerdown", handlePointerDown);
    el.addEventListener("pointerup", handlePointerUp);
    el.addEventListener("pointercancel", handlePointerCancel);
    return () => {
      el.removeEventListener("pointerdown", handlePointerDown);
      el.removeEventListener("pointerup", handlePointerUp);
      el.removeEventListener("pointercancel", handlePointerCancel);
    };
  }, []);

  return ref;
}
