import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";

/**
 * Custom drag-to-reorder for a vertical list of rows keyed by their own
 * real index into the array being reordered (not their position among
 * whatever's currently visible - see `visibleIndices` below). Replaces
 * the old `elementFromPoint`-plus-`setPointerCapture` approach (buggy:
 * hit-testing only worked while the pointer sat exactly over a row's own
 * DOM node, and a browser silently dropping pointer capture mid-drag -
 * common enough on touch, e.g. across a scroll - left the drag stuck
 * dimmed with no pointerup ever reaching it) with the standard pattern
 * for this: global window listeners for the duration of the drag (so
 * losing capture can't happen, there's nothing to lose) plus geometric
 * midpoint hit-testing against each row's own live `getBoundingClientRect`
 * (so hovering *between* rows, over a gap's own dashed divider, or past
 * either end of the list all resolve to a real, sensible drop gap - not
 * just whatever row happens to be directly underneath). A `pointermove`
 * handler only ever records the latest Y; a `requestAnimationFrame` loop
 * does the actual gap recompute and auto-scroll every frame, decoupled
 * from however fast pointer events actually arrive - this is what makes
 * both the drop indicator and the auto-scroll track smoothly instead of
 * jumping between whatever coarse steps individual events happened to
 * land on.
 *
 * A "gap" is a real index 0..count (never a `visibleIndices` position) -
 * gap `g` means "insert before the row currently at real index `g`" (or
 * append, when `g === count`). This is exactly the value every
 * AddStepButton divider already keyed its own `dropTarget` off before
 * this rewrite (0 for the very first one, `index + 1` for the one after
 * each row), so callers don't need to change how they read it.
 */
export function useDragReorder({
  visibleIndices,
  count,
  onReorder,
  scrollContainerRef,
  disabled,
}: {
  /** Every row's own real index, in the order they're actually
   * rendered - narrower than 0..count-1 whenever a filter (e.g. "Show
   * turns" off, "Unverified only") hides some rows, same as before.
   * Reordering still always resolves to a real index either way - a
   * filtered-out row can't be dragged (it's not rendered, so it has no
   * handle to grab), but it can still be a valid landing gap between
   * two visible ones. */
  visibleIndices: number[];
  /** The full row count - real indices run 0..count-1, gaps 0..count. */
  count: number;
  /** Called once, only for a drop that actually moves something (never
   * for a no-op drop back onto the dragged row's own starting slot). */
  onReorder: (from: number, to: number) => void;
  /** The scrollable region to auto-scroll as the drag nears its top/
   * bottom edge - omit to disable auto-scroll entirely. */
  scrollContainerRef?: RefObject<HTMLElement | null>;
  disabled?: boolean;
}): {
  /** The real index currently being dragged, or null when idle - drive
   * the dragged row's own fade (`opacity-40` or similar) off this. */
  draggingIndex: number | null;
  /** The gap the drag is currently over, or null when idle - compare
   * against 0/`index + 1` exactly as the old `dragOverIndex` was. */
  dropGap: number | null;
  /** Attach to each row's own wrapper element: `ref={rowRef(index)}`.
   * Every visible row needs one - this is how the hook actually
   * measures row positions for its own hit-testing. */
  rowRef: (index: number) => (el: HTMLElement | null) => void;
  /** The drag handle's own `onPointerDown` - starts the drag and shows
   * an immediate drop indicator at the pointer's starting position,
   * rather than waiting for the first move. */
  startDrag: (index: number) => (e: ReactPointerEvent) => void;
} {
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dropGap, setDropGap] = useState<number | null>(null);

  const rowElsRef = useRef(new Map<number, HTMLElement>());
  const pointerYRef = useRef(0);
  const dropGapRef = useRef<number | null>(null);
  const draggingIndexRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  // Mirrored into refs every render (not just while dragging) so the
  // pointermove/pointerup listeners and rAF loop below - all set up
  // once per drag via one effect keyed on `draggingIndex` - always read
  // the current `visibleIndices`/`onReorder`/`count`, even if any of
  // them change mid-drag (a filter toggle, a row added elsewhere),
  // rather than closing over whatever they were when the drag started.
  // The effect (no dependency array - every render) rather than a
  // direct assignment during render itself, since a ref is only ever
  // supposed to be written from an effect or event handler.
  const visibleIndicesRef = useRef(visibleIndices);
  const countRef = useRef(count);
  const onReorderRef = useRef(onReorder);
  useEffect(() => {
    visibleIndicesRef.current = visibleIndices;
    countRef.current = count;
    onReorderRef.current = onReorder;
  });

  const rowRef = useCallback(
    (index: number) => (el: HTMLElement | null) => {
      if (el) rowElsRef.current.set(index, el);
      else rowElsRef.current.delete(index);
    },
    [],
  );

  // Real-index gap the given Y coordinate falls into, by comparing it
  // against each visible row's own live vertical midpoint - see this
  // hook's own doc comment for what a "gap" value means.
  const gapForY = useCallback((clientY: number): number => {
    let gap = 0;
    for (const index of visibleIndicesRef.current) {
      const el = rowElsRef.current.get(index);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) return gap;
      gap = index + 1;
    }
    return gap;
  }, []);

  const updateGap = useCallback(
    (clientY: number) => {
      const gap = gapForY(clientY);
      if (gap !== dropGapRef.current) {
        dropGapRef.current = gap;
        setDropGap(gap);
      }
    },
    [gapForY],
  );

  const startDrag = useCallback(
    (index: number) => (e: ReactPointerEvent) => {
      if (disabled) return;
      pointerYRef.current = e.clientY;
      draggingIndexRef.current = index;
      setDraggingIndex(index);
      updateGap(e.clientY);
    },
    [disabled, updateGap],
  );

  useEffect(() => {
    if (draggingIndex === null) return;

    const EDGE_PX = 56;
    const MAX_SPEED_PX = 14;

    function onPointerMove(e: PointerEvent) {
      pointerYRef.current = e.clientY;
    }

    function finishDrag() {
      const from = draggingIndexRef.current;
      const gap = dropGapRef.current;
      if (from !== null && gap !== null) {
        const to = gap > from ? gap - 1 : gap;
        if (to !== from && to >= 0 && to <= countRef.current - 1) {
          onReorderRef.current(from, to);
        }
      }
      draggingIndexRef.current = null;
      dropGapRef.current = null;
      setDraggingIndex(null);
      setDropGap(null);
    }

    function tick() {
      const container = scrollContainerRef?.current;
      if (container) {
        const rect = container.getBoundingClientRect();
        const y = pointerYRef.current;
        let dy = 0;
        if (y < rect.top + EDGE_PX) {
          dy = -MAX_SPEED_PX * Math.min(1, (rect.top + EDGE_PX - y) / EDGE_PX);
        } else if (y > rect.bottom - EDGE_PX) {
          dy = MAX_SPEED_PX * Math.min(1, (y - (rect.bottom - EDGE_PX)) / EDGE_PX);
        }
        if (dy !== 0) container.scrollTop += dy;
      }
      updateGap(pointerYRef.current);
      rafRef.current = requestAnimationFrame(tick);
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", finishDrag);
    window.addEventListener("pointercancel", finishDrag);
    // Losing window focus mid-drag (an alt-tab, a native share sheet, a
    // browser gesture stealing the touch) has no pointerup/pointercancel
    // of its own - without this, that's exactly the "stuck dimmed,
    // drop never triggers" failure mode reordering used to hit.
    window.addEventListener("blur", finishDrag);
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", finishDrag);
      window.removeEventListener("pointercancel", finishDrag);
      window.removeEventListener("blur", finishDrag);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [draggingIndex, scrollContainerRef, updateGap]);

  return { draggingIndex, dropGap, rowRef, startDrag };
}
