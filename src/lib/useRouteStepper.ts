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

  // Bumped on every resume (not on pausing itself) - part of the
  // announcement-completion key below, so a re-announcement after
  // resuming is tracked as a fresh attempt rather than reusing whatever
  // the *previous* attempt on this same step had already completed.
  const [resumeCount, setResumeCount] = useState(0);
  const togglePause = useCallback(() => {
    if (pausedRef.current) setResumeCount((c) => c + 1);
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

  // Which stop number to show at each step: the stop itself while on it,
  // otherwise the next stop still ahead (capped at the last one) - so a
  // turn between stop 1 and stop 2 reads as "Stop 2 of N", not a raw
  // instruction count.
  const stopNumberByIndex = useMemo(() => {
    const result: number[] = [];
    route.steps.reduce((passed, s) => {
      const nowPassed = s.kind === "stop" ? passed + 1 : passed;
      result.push(s.kind === "stop" ? nowPassed : Math.min(nowPassed + 1, totalStops || 1));
      return nowPassed;
    }, 0);
    return result;
  }, [route.steps, totalStops]);

  const stopProgressNumber = stopNumberByIndex[currentIndex];
  const currentStopNumber = currentStep.kind === "stop" ? stopProgressNumber : null;

  const advance = useCallback(() => {
    setCurrentIndex((i) => (i < totalSteps - 1 ? i + 1 : i));
  }, [totalSteps]);

  const goBack = useCallback(() => {
    setCurrentIndex((i) => (i > 0 ? i - 1 : i));
  }, []);

  // Speak the announcement for whatever step is current - but not while
  // paused. Each part (stop number / location / rider count) is queued
  // as its own utterance rather than joined into one string, so there's
  // an audible pause between them instead of one run-on sentence. The
  // very first announcement after the route starts is prefaced with the
  // route number and school ("Starting route 125 from Lavergne Lake
  // Elementary." - "from" for a dropoff route, since the bus departs the
  // school; "to" for a pickup route, since the school is the
  // destination), and the last step's is followed by "Route completed."
  // - both queued alongside the step's own parts so a pause-triggered
  // cancel() (below) can't wipe one out before it plays.
  //
  // announcementDone tracks whether the *last* queued utterance for the
  // current announcement attempt has finished (or errored/timed out) -
  // StepScreen uses it to hold off popping up the rider check-in card
  // until the driver has actually heard the stop announcement, rather
  // than it appearing over top of still-playing speech.
  //
  // Derived as a key comparison (attemptKey === completedKey) rather
  // than an effect calling setState(false) up front and setState(true)
  // once speech ends: since resumeCount/currentStep already change
  // reactively on their own, attemptKey naturally goes stale - and so
  // announcementDone naturally reads false - the moment a new attempt
  // starts, with no explicit "reset" call needed. Every setState call
  // below happens inside a callback that responds to an external event
  // (the utterance ending, or a timeout), never synchronously in the
  // effect body itself.
  const announcedStartRef = useRef(false);
  const attemptKey = `${currentStep.id}-${resumeCount}`;
  const [completedKey, setCompletedKey] = useState<string | null>(null);
  const announcementDone = completedKey === attemptKey;

  useEffect(() => {
    if (!started || paused) return;

    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      const id = setTimeout(() => setCompletedKey(attemptKey), 0);
      return () => clearTimeout(id);
    }

    window.speechSynthesis.cancel();
    const parts = [...currentStep.announcement];
    if (!announcedStartRef.current) {
      const preposition = route.tripType === "dropoff" ? "from" : "to";
      parts.unshift(`Starting route ${route.routeNumber} ${preposition} ${route.schoolName}.`);
      announcedStartRef.current = true;
    }
    if (isLastStep) {
      parts.push("Route completed.");
    }

    const utterances = parts.map((part) => new SpeechSynthesisUtterance(part));
    const last = utterances[utterances.length - 1];
    const markDone = () => setCompletedKey(attemptKey);
    let fallback: number;
    if (last) {
      last.addEventListener("end", markDone);
      last.addEventListener("error", markDone);
      fallback = window.setTimeout(markDone, 8000);
    } else {
      fallback = window.setTimeout(markDone, 0);
    }
    for (const utterance of utterances) {
      window.speechSynthesis.speak(utterance);
    }

    return () => {
      last?.removeEventListener("end", markDone);
      last?.removeEventListener("error", markDone);
      window.clearTimeout(fallback);
    };
  }, [
    currentStep,
    started,
    paused,
    isLastStep,
    attemptKey,
    route.routeNumber,
    route.schoolName,
    route.tripType,
  ]);

  // Cancel any in-progress announcement the moment the route is paused.
  useEffect(() => {
    if (paused && typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  }, [paused]);

  // Bluetooth media-remote handling via the Media Session API. Most of
  // these remotes have a single play/pause button, not separate play and
  // pause buttons - the OS decides which action to send based on the
  // *reported* playbackState, so keeping that in sync (below) is what
  // makes the same physical button correctly resume a paused route
  // instead of silently doing nothing.
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
      // Sent when the OS believes playback is currently paused - since
      // that's our own paused state (synced below), this is "resume",
      // not "advance". Otherwise it's the same forward gesture as
      // nexttrack/fast-forward.
      if (pausedRef.current) {
        setPaused(false);
      } else {
        advance();
      }
    });
    session.setActionHandler("pause", () => {
      setPaused(true);
    });

    return () => {
      session.setActionHandler("nexttrack", null);
      session.setActionHandler("previoustrack", null);
      session.setActionHandler("play", null);
      session.setActionHandler("pause", null);
    };
  }, [started, advance, goBack, route.name]);

  // Keep playbackState in sync with our own paused state - see above.
  useEffect(() => {
    if (!started || typeof navigator === "undefined" || !("mediaSession" in navigator)) {
      return;
    }
    navigator.mediaSession.playbackState = paused ? "paused" : "playing";
  }, [started, paused]);

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

  // Tapping "End" on the last step: announce completion, then return to
  // the start screen. Resets everything (index/pause/announcement-start
  // flag, silent audio) so a subsequent "Start Route" begins clean -
  // this doesn't unmount the hook (RouteApp keeps calling it regardless
  // of `started`), so that reset has to happen explicitly here rather
  // than relying on the unmount cleanup above.
  const endRoute = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(new SpeechSynthesisUtterance("Route ended."));
    }
    audioRef.current?.pause();
    audioRef.current = null;
    announcedStartRef.current = false;
    setPaused(false);
    setCurrentIndex(0);
    setStarted(false);
  }, []);

  return {
    currentStep,
    currentIndex,
    totalSteps,
    isFirstStep,
    isLastStep,
    totalStops,
    currentStopNumber,
    stopProgressNumber,
    started,
    start,
    advance,
    goBack,
    paused,
    togglePause,
    endRoute,
    announcementDone,
  };
}
