import Image from "next/image";
import { ChevronDownIcon, DirectionArrow } from "./icons";
import type { NavigationStep } from "@/lib/types";

/** Minimum spacing between rendered markers, as a percent of the bar's
 * width. With a route dense enough to put several markers within this
 * gap (e.g. six stops in a row), only some render - see markersToShow. */
const MIN_MARKER_GAP_PCT = 7;

function percentFor(index: number, total: number): number {
  if (total <= 1) return 0;
  return (index / (total - 1)) * 100;
}

function markersToShow(steps: NavigationStep[], currentIndex: number) {
  const total = steps.length;
  const shown: { step: NavigationStep; pct: number }[] = [];
  let lastPct = -Infinity;

  steps.forEach((step, index) => {
    if (step.kind !== "turn" && step.kind !== "stop") return;
    const pct = percentFor(index, total);
    const mustShow = index === currentIndex || index === 0 || index === total - 1;
    if (mustShow || pct - lastPct >= MIN_MARKER_GAP_PCT) {
      shown.push({ step, pct });
      lastPct = pct;
    }
  });

  return shown;
}

export function RouteProgressBar({
  steps,
  currentIndex,
}: {
  steps: NavigationStep[];
  currentIndex: number;
}) {
  const total = steps.length;
  const progressPct = percentFor(currentIndex, total);
  // The bus icon is wide enough that centering it at true 0%/100% would
  // push it past the screen edge - keep it well inside the bar's ends.
  const busPct = Math.min(90, Math.max(10, progressPct));

  return (
    <div className="w-full px-8 pt-14">
      <div className="relative">
        {/* Bus position indicator, riding above the road */}
        <div
          className="absolute bottom-full flex -translate-x-1/2 flex-col items-center transition-[left] duration-300 ease-out"
          style={{ left: `${busPct}%` }}
        >
          <Image
            src="/assets/bus.png"
            alt=""
            width={677}
            height={462}
            className="h-10 w-auto drop-shadow-md sm:h-12"
          />
          <ChevronDownIcon className="-mt-1 h-3 w-4 text-zinc-700 dark:text-zinc-300" />
        </div>

        {/* The road */}
        <div className="relative h-4 w-full rounded-full border-2 border-zinc-600 bg-zinc-400 dark:border-zinc-500 dark:bg-zinc-600">
          <div className="absolute inset-x-2 top-1/2 border-t-2 border-dashed border-white/90" />
        </div>

        {/* Step markers along the road (thinned so they stay legible) */}
        {markersToShow(steps, currentIndex).map(({ step, pct }) => (
          <div
            key={step.id}
            className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${pct}%` }}
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
              <div className="flex h-4 w-4 items-center justify-center rounded-full bg-blue-600 ring-2 ring-white dark:ring-zinc-900">
                {step.direction && (
                  <DirectionArrow direction={step.direction} className="h-2.5 w-2.5 text-white" />
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
