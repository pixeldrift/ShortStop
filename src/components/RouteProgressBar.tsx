"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { TurnArrow } from "./icons";
import type { NavigationStep } from "@/lib/types";

/** Fixed spacing between adjacent markers, so a long route just makes the
 * track longer (scrolled/faded into view) instead of crowding markers
 * together. */
const PX_PER_STEP = 48;
const EDGE_FADE_PX = 28;

function pixelFor(index: number): number {
  return index * PX_PER_STEP;
}

/** Builds the left/right fade as a CSS mask - only on whichever edge(s)
 * actually have hidden content, so a route that fits with no scrolling
 * needed shows no fade at all. */
function buildFadeMask(showLeft: boolean, showRight: boolean): string | undefined {
  if (!showLeft && !showRight) return undefined;
  const left = showLeft ? `transparent, black ${EDGE_FADE_PX}px` : "black 0px";
  const right = showRight
    ? `black calc(100% - ${EDGE_FADE_PX}px), transparent`
    : "black 100%";
  return `linear-gradient(to right, ${left}, ${right})`;
}

export function RouteProgressBar({
  steps,
  currentIndex,
}: {
  steps: NavigationStep[];
  currentIndex: number;
}) {
  const total = steps.length;
  const trackWidth = Math.max(pixelFor(total - 1), 1);
  const currentPx = pixelFor(currentIndex);

  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      setContainerWidth(entries[0].contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Keep the current position roughly centered in the visible window,
  // clamped so we never scroll past either end of the track.
  const { offset, showLeftFade, showRightFade } = useMemo(() => {
    if (containerWidth === 0 || trackWidth <= containerWidth) {
      return { offset: 0, showLeftFade: false, showRightFade: false };
    }
    const minOffset = containerWidth - trackWidth; // negative
    const idealOffset = containerWidth / 2 - currentPx;
    const clamped = Math.min(0, Math.max(minOffset, idealOffset));
    return {
      offset: clamped,
      showLeftFade: clamped < -0.5,
      showRightFade: clamped > minOffset + 0.5,
    };
  }, [containerWidth, trackWidth, currentPx]);

  const maskImage = buildFadeMask(showLeftFade, showRightFade);

  // The bus icon is wide enough that letting it sit exactly at the
  // track's own start/end would push part of it past the track edge -
  // keep it a little inside.
  const busPx = Math.min(trackWidth - 12, Math.max(12, currentPx));

  return (
    <div
      ref={containerRef}
      className="w-full overflow-hidden px-5 pt-1"
      style={{ WebkitMaskImage: maskImage, maskImage }}
    >
      <div
        className="relative h-24 transition-transform duration-300 ease-out"
        style={{ width: trackWidth, transform: `translateX(${offset}px)` }}
      >
        {/* Turn/stop markers - raised a bit higher above the road */}
        {steps.map((step, index) => {
          if (step.kind !== "turn" && step.kind !== "stop") return null;
          return (
            <div
              key={step.id}
              className="absolute bottom-7 -translate-x-1/2"
              style={{ left: pixelFor(index) }}
            >
              {step.kind === "stop" ? (
                <Image
                  src="/assets/pin.png"
                  alt=""
                  width={350}
                  height={548}
                  className="h-5 w-auto drop-shadow-sm"
                />
              ) : (
                step.direction && <TurnArrow direction={step.direction} className="h-5 w-5" />
              )}
            </div>
          );
        })}

        {/* The road */}
        <div
          className="absolute bottom-0 h-4 rounded-full border-2 border-zinc-600 bg-zinc-400 dark:border-zinc-500 dark:bg-zinc-600"
          style={{ width: trackWidth }}
        >
          <div className="absolute inset-x-2 top-1/2 -translate-y-1/2 border-t-2 border-dashed border-white/90" />

          {/* Cul-de-sacs: a circle a little larger than the road's own
              height, straddling each true end of the route. The
              container's px-5 leaves enough room that the half of each
              circle hanging past the track's edge is never clipped. */}
          <div className="absolute top-1/2 left-0 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-zinc-600 bg-zinc-400 dark:border-zinc-500 dark:bg-zinc-600" />
          <div className="absolute top-1/2 left-full h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-zinc-600 bg-zinc-400 dark:border-zinc-500 dark:bg-zinc-600" />
        </div>

        {/* Bus - overlaid directly on top of the road at the current
            position, rather than hovering above it with a caret. */}
        <div
          className="absolute bottom-2 z-10 -translate-x-1/2 -translate-y-1/2 transition-[left] duration-300 ease-out"
          style={{ left: busPx }}
        >
          <Image
            src="/assets/bus.png"
            alt=""
            width={780}
            height={465}
            className="h-[1.5rem] w-auto drop-shadow-md sm:h-[1.875rem]"
          />
        </div>
      </div>
    </div>
  );
}
