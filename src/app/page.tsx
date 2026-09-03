"use client";

import { StartScreen } from "@/components/StartScreen";
import { StepScreen } from "@/components/StepScreen";
import { sampleRoute } from "@/lib/sampleRoute";
import { useRouteStepper } from "@/lib/useRouteStepper";

export default function Home() {
  const {
    currentStep,
    currentIndex,
    totalSteps,
    isFirstStep,
    isLastStep,
    totalStops,
    currentStopNumber,
    started,
    start,
    advance,
    goBack,
  } = useRouteStepper(sampleRoute);

  if (!started) {
    return <StartScreen route={sampleRoute} onStart={start} />;
  }

  return (
    <StepScreen
      step={currentStep}
      stepNumber={currentIndex + 1}
      totalSteps={totalSteps}
      stopNumber={currentStopNumber}
      totalStops={totalStops}
      isFirstStep={isFirstStep}
      isLastStep={isLastStep}
      onAdvance={advance}
      onBack={goBack}
    />
  );
}
