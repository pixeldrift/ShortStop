import type { NavigationStep } from "@/lib/types";

export function StepScreen({
  step,
  stepNumber,
  totalSteps,
  stopNumber,
  totalStops,
  isFirstStep,
  isLastStep,
  onAdvance,
  onBack,
}: {
  step: NavigationStep;
  stepNumber: number;
  totalSteps: number;
  stopNumber: number | null;
  totalStops: number;
  isFirstStep: boolean;
  isLastStep: boolean;
  onAdvance: () => void;
  onBack: () => void;
}) {
  const heading =
    step.kind === "stop" && stopNumber
      ? `STOP ${stopNumber} OF ${totalStops}`
      : (step.heading ?? "");

  return (
    <div
      className="flex flex-1 touch-manipulation flex-col items-center justify-between gap-6 p-6 select-none"
      onClick={onAdvance}
    >
      <p className="text-sm font-semibold tracking-wide text-zinc-500">
        {stepNumber} of {totalSteps}
      </p>

      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <h1 className="text-4xl font-black tracking-tight sm:text-5xl">{heading}</h1>

        {step.subheading && <p className="text-2xl">{step.subheading}</p>}

        {step.distance && <p className="text-xl text-zinc-500">{step.distance}</p>}

        {step.studentCount != null && (
          <p className="text-xl">
            {step.studentCount} Student{step.studentCount === 1 ? "" : "s"}
            {step.pickupOrDropoff && ` · ${step.pickupOrDropoff}`}
          </p>
        )}

        {step.sideOfRoad && (
          <p className="text-zinc-500">Stop on {step.sideOfRoad} side</p>
        )}

        {step.specialInstruction && (
          <p className="rounded-lg bg-yellow-400/20 px-3 py-2 text-base">
            {step.specialInstruction}
          </p>
        )}
      </div>

      <div className="flex w-full max-w-md gap-4" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={onBack}
          disabled={isFirstStep}
          className="flex-1 rounded-xl border border-zinc-300 py-4 text-lg font-semibold disabled:opacity-40 dark:border-zinc-700"
        >
          ← Back
        </button>
        <button
          type="button"
          onClick={onAdvance}
          disabled={isLastStep}
          className="flex-1 rounded-xl bg-blue-600 py-4 text-lg font-semibold text-white disabled:opacity-40"
        >
          Next →
        </button>
      </div>
    </div>
  );
}
