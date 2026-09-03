"use client";

import { useLayoutEffect, useRef } from "react";

/** Shrinks a `--fit-scale` CSS custom property from 1 down to `minScale`
 * just enough that the ref'd element's content fits within its own
 * rendered box instead of overflowing - the same idea as useFitLines,
 * but for a 2D grid (the rider check-in bubbles) whose overflow is about
 * running out of rows, not text wrapping. Consumers read `--fit-scale`
 * via `calc()` on whatever should shrink (bubble size, icon size, label
 * text, gaps). Re-measures on resize/orientation change and whenever
 * `itemCount` changes. */
export function useFitGrid<T extends HTMLElement>(itemCount: number, minScale = 0.55) {
  const ref = useRef<T>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const fit = () => {
      el.style.setProperty("--fit-scale", "1");
      let scale = 1;
      while (
        (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth) &&
        scale > minScale
      ) {
        scale = Math.max(minScale, scale - 0.05);
        el.style.setProperty("--fit-scale", String(scale));
      }
    };

    fit();
    window.addEventListener("resize", fit);
    window.addEventListener("orientationchange", fit);
    return () => {
      window.removeEventListener("resize", fit);
      window.removeEventListener("orientationchange", fit);
    };
  }, [itemCount, minScale]);

  return ref;
}
