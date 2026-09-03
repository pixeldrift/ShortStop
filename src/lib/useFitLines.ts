"use client";

import { useLayoutEffect, useRef } from "react";

/** Shrinks an element's font-size down from its CSS baseline just enough to
 * keep its content within `maxLines` lines - so ordinary-length content
 * stays at full baseline size, and only an unusually long combination of
 * words gets scaled down. Re-measures on resize/orientation change since
 * that's what changes how much text wraps. */
export function useFitLines<T extends HTMLElement>(
  text: string | undefined,
  maxLines: number,
  minScale = 0.55,
) {
  const ref = useRef<T>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const fit = () => {
      el.style.fontSize = "";
      const baseSize = parseFloat(getComputedStyle(el).fontSize);
      const lineHeight = parseFloat(getComputedStyle(el).lineHeight);
      const maxHeight = lineHeight * maxLines + 1;

      let scale = 1;
      while (el.scrollHeight > maxHeight && scale > minScale) {
        scale = Math.max(minScale, scale - 0.05);
        el.style.fontSize = `${baseSize * scale}px`;
      }
    };

    fit();
    window.addEventListener("resize", fit);
    window.addEventListener("orientationchange", fit);
    return () => {
      window.removeEventListener("resize", fit);
      window.removeEventListener("orientationchange", fit);
    };
  }, [text, maxLines, minScale]);

  return ref;
}
