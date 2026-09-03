"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Route } from "./types";
import { SILENT_LOOP_DATA_URI } from "./silence";

/**
 * Drives the step-through UI: current step, advance/back, and every input
 * path that should move it forward or back.
 *
 * Primary input: a Bluetooth media remote (the bike/handlebar-style
 * rewind/play-pause/fast-forward clickers linked in the project doc).
 * Those use the standard AVRCP media-control profile, which the browser
 * surfaces as the Media Session API - not as keyboard events. Fallback
 * input: arrow/space/enter keys, in case a specific device pairs as a
 * keyboard instead.
 */
export function useRouteStepper(route: Route) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [started, setStarted] = useState(false);
  const [paused, setPaused] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pausedRef = useRef(false);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  const togglePause = useCallback(() => {
    setPaused((p) => !p);
  }, []);

  const currentStep = route.steps[currentIndex];
  const totalSteps = route.steps.length;
  const isFirstStep = currentIndex === 0;
  const isLastStep = currentIndex === totalSteps - 1;

  const stopSteps = useMemo(
    () => route.steps.filter((s) => s.kind === "stop"),
    [route.steps],
  );
  const totalStops = stopSteps.length;
  const currentStopNumber =
    currentStep.kind === "stop"
      ? stopSteps.findIndex((s) => s.id === currentStep.id) + 1
      : null;

  const advance = useCallback(() => {
    setCurrentIndex((i) => (i < totalSteps - 1 ? i + 1 : i));
  }, [totalSteps]);

  const goBack = useCallback(() => {
    setCurrentIndex((i) => (i > 0 ? i - 1 : i));
  }, []);

  // Speak the announcement for whatever step is current - but not while paused.
  useEffect(() => {
    if (
      !started ||
      paused ||
      typeof window === "undefined" ||
      !("speechSynthesis" in window)
    ) {
      return;
    }
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(currentStep.announcement));
  }, [currentStep, started, paused]);

  // Cancel any in-progress announcement the moment the route is paused.
  useEffect(() => {
    if (paused && typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  }, [paused]);

  // Bluetooth media-remote handling via the Media Session API.
  useEffect(() => {
    if (!started || typeof navigator === "undefined" || !("mediaSession" in navigator)) {
      return;
    }
    const session = navigator.mediaSession;
    session.metadata = new MediaMetadata({ title: route.name });
    session.setActionHandler("nexttrack", () => {
      if (!pausedRef.current) advance();
    });
    session.setActionHandler("previoustrack", () => {
      if (!pausedRef.current) goBack();
    });
    session.setActionHandler("play", () => {
      if (!pausedRef.current) advance();
    });
    session.playbackState = "playing";

    return () => {
      session.setActionHandler("nexttrack", null);
      session.setActionHandler("previoustrack", null);
      session.setActionHandler("play", null);
    };
  }, [started, advance, goBack, route.name]);

  // Keyboard fallback, in case a specific remote pairs as a keyboard.
  useEffect(() => {
    if (!started) return;
    const handleKey = (e: KeyboardEvent) => {
      if (pausedRef.current) return;
      if (["ArrowRight", "ArrowDown", " ", "Enter"].includes(e.key)) {
        e.preventDefault();
        advance();
      } else if (["ArrowLeft", "ArrowUp", "Backspace"].includes(e.key)) {
        e.preventDefault();
        goBack();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [started, advance, goBack]);

  // Media Session action handlers only fire while a media element is
  // actively playing, so keep a silent one looping for the whole trip.
  // Starting it here (from the Start Route tap) also satisfies browser
  // autoplay policy, which requires a user gesture.
  const start = useCallback(() => {
    if (started) return;
    setStarted(true);
    const audio = new Audio(SILENT_LOOP_DATA_URI);
    audio.loop = true;
    audio.volume = 0.02;
    void audio.play().catch(() => {});
    audioRef.current = audio;
  }, [started]);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
    };
  }, []);

  return {
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
    paused,
    togglePause,
  };
}
