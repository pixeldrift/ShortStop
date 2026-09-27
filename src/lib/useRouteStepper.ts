"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { speakRouteNumber } from "./speech";
import { SILENT_LOOP_DATA_URI } from "./silence";
import { parse24HourTimeToMinutes } from "./time";
import type { Route } from "./types";

/** Within this many minutes either way of route.departureTime, the
 * depot announcement's own schedule callout just says "Right on time" -
 * a driver who left within a couple minutes of the scheduled departure
 * hasn't meaningfully deviated from it, and reporting "1 minute behind
 * schedule" as though it mattered would read as needless precision, not
 * useful information. */
const ON_TIME_THRESHOLD_MINUTES = 2;

/** The depot announcement's own schedule callout - "Right on time,"
 * "3 minutes behind schedule," "2 minutes ahead of schedule" - comparing
 * `actualStartMs` (real wall-clock time, captured the instant start()
 * below actually ran) against route.departureTime (the route's own
 * scheduled start, "HH:MM:SS" 24-hour - EditRouteScreen's own Start
 * Time field, standardized to this shape on save). Null whenever
 * departureTime doesn't parse (parse24HourTimeToMinutes's own Infinity
 * sentinel) - nothing to compare against, so nothing gets said, same
 * graceful "no data, no callout" fallback the rest of this app already
 * gives missing schedule/GPS data. The ±720-minute correction below
 * handles a route scheduled right around midnight, where a literal
 * subtraction could otherwise read a few real minutes late as nearly a
 * full day early (or the reverse) - a bus is never actually that far
 * off its own scheduled start, so whichever wrap reads closer to zero
 * is always the right one. */
function schedulePhrase(departureTime: string, actualStartMs: number): string | null {
  const scheduledMinutes = parse24HourTimeToMinutes(departureTime);
  if (scheduledMinutes === Infinity) return null;

  const actual = new Date(actualStartMs);
  const actualMinutes = actual.getHours() * 60 + actual.getMinutes() + actual.getSeconds() / 60;
  let diff = actualMinutes - scheduledMinutes;
  if (diff > 720) diff -= 1440;
  else if (diff < -720) diff += 1440;

  const rounded = Math.round(diff);
  if (Math.abs(rounded) <= ON_TIME_THRESHOLD_MINUTES) return "Right on time.";
  const minutes = Math.abs(rounded);
  const unit = minutes === 1 ? "minute" : "minutes";
  return rounded > 0 ? `${minutes} ${unit} behind schedule.` : `${minutes} ${unit} ahead of schedule.`;
}

/** How long a stop's own full arrival announcement waits on real GPS
 * confirmation (arrivedStopId, below) before speaking anyway - see that
 * state's own doc comment for the full reasoning on why this is so much
 * longer than this file's other timeouts. */
const STOP_ARRIVAL_FALLBACK_MS = 60000;

/**
 * The bus's position in the route is one of three phases:
 *  - "depot": before the first real step - the bus sits on the start
 *    cul-de-sac, generic "ready to depart" content shows, and the footer
 *    button reads "Start".
 *  - "step": on one of route.steps[0..totalSteps-1] - ordinary
 *    turn-by-turn content, footer button always reads "Next" (even on
 *    the very last step - see "arrived" below).
 *  - "arrived": after the last real step - the bus stays visually on the
 *    end cul-de-sac (pixelFor(totalSteps-1) already equals the track's
 *    own width, so no special-casing is needed in RouteProgressBar),
 *    generic "all stops complete" content shows, and the footer button
 *    reads "End". Only tapping that button (not "Next" again) actually
 *    ends the route - see endRoute below.
 */
export type StepPhase = "depot" | "step" | "arrived";

/** Where a tap/scrub on RouteProgressBar wants to land - "step" carries
 * which of route.steps[], the other two are the virtual depot/arrived
 * states (see StepPhase above), which aren't indices into that array. */
export type SeekTarget = { phase: "depot" } | { phase: "arrived" } | { phase: "step"; index: number };

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
 *
 * `resumeAtStepIndex` - set only when RouteApp is remounting fresh
 * after an admin's quick waypoint edit (page.tsx's own "trip" screen
 * `resumeAt` field) - skips straight to that step, already started,
 * instead of landing back at the depot the way every other fresh mount
 * of this hook does. See the mount effect right below the return value
 * for what actually drives that jump - it can't happen through this
 * hook's own initial useState values alone, since `start()` (which
 * also sets up the silent audio loop Media Session actions need) has
 * to actually run, not just have `started` read true from the first
 * render.
 */
export function useRouteStepper(route: Route, resumeAtStepIndex?: number) {
  // Lazy initializers (not a mount effect) for the resume case - the
  // react-hooks lint rule (set-state-in-effect) flags a setState call
  // synchronously inside a useEffect body, which calling start()/
  // jumpTo() from a mount effect would be (both are useCallbacks
  // defined right in this same file, so the linter's own data-flow
  // analysis traces straight through to the setStarted/setPhase/
  // setCurrentIndex calls inside them - unlike page.tsx's own identical-
  // looking `if (autoStart) start()` mount effect, which the linter
  // can't see through since `start` there is just an opaque value
  // destructured from this hook's return, not a local function). Seeding
  // the initial state directly here sidesteps that separately from
  // being the right fix regardless: `started` seeded straight to `true`
  // for a resume also means start() itself would early-return as a no-op
  // if this called it (see its own `if (started) return` guard) - it can
  // only ever run the very first time `started` flips true, which this
  // resume case now already handles here.
  const [currentIndex, setCurrentIndex] = useState(() =>
    resumeAtStepIndex != null
      ? Math.min(Math.max(resumeAtStepIndex, 0), route.steps.length - 1)
      : 0,
  );
  const [phase, setPhase] = useState<StepPhase>(() =>
    resumeAtStepIndex != null ? "step" : "depot",
  );
  const [started, setStarted] = useState(() => resumeAtStepIndex != null);
  const [paused, setPaused] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pausedRef = useRef(false);
  // The real wall-clock moment start() (below) actually ran - the depot
  // announcement's own schedulePhrase reads this, not Date.now() at
  // whatever later moment the announcement effect happens to run, so a
  // driver who taps Start and then pauses to check the roster before
  // ever hearing the depot announcement still gets an accurate "how
  // close to on-time did we actually leave," not one that keeps
  // drifting later the longer that announcement is delayed. Stays null
  // for a resumed session (resumeAtStepIndex - start() is never called
  // for one, see its own doc comment above), where the depot phase
  // itself is skipped entirely, so there's no announcement this would
  // ever feed anyway.
  const actualStartMsRef = useRef<number | null>(null);

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

  // Which stop's own full arrival announcement is actually clear to
  // speak - StepScreen's own onStopArrived prop (below) sets this the
  // instant live GPS confirms the bus has physically stopped there
  // (useGpsAutoAdvance's own onStopArrived - see its own doc comment).
  // A stop step becoming *current* only ever means the *previous* step
  // cleared, not that the bus has actually reached this one yet (a
  // stop several minutes' drive past the last turn shouldn't have its
  // own rider count read out the instant it becomes the on-screen
  // step) - so the announcement effect below holds a stop's own speech
  // back until this matches its id, unlike every other step kind,
  // which still speaks the moment it's current exactly as before this
  // existed. On-screen content is entirely unaffected either way - the
  // step itself, its map pin, its heading/subheading text, all still
  // update immediately on becoming current; only the *spoken* arrival
  // announcement waits.
  const [arrivedStopId, setArrivedStopId] = useState<number | null>(null);
  // The one exception: forced through anyway once STOP_ARRIVAL_FALLBACK_MS
  // has passed with no real GPS confirmation - reviewing a route at a
  // desk via the footer's own Next button (no GPS at all, so
  // arrivedStopId can never update on its own) would otherwise leave
  // every stop permanently silent. Deliberately much longer than any
  // of this file's other timeouts: the common case for a stop that's
  // simply a normal multi-minute leg away from wherever the *previous*
  // step cleared is exactly the same "still waiting, not stuck" state
  // as the "GPS never confirms" case this actually exists to protect
  // against, so a short timeout would speak the arrival announcement
  // early on a perfectly ordinary route far more often than it would
  // ever rescue a genuinely broken one.
  const [forcedStopId, setForcedStopId] = useState<number | null>(null);
  useEffect(() => {
    if (phase !== "step" || currentStep.kind !== "stop" || arrivedStopId === currentStep.id) {
      return;
    }
    const id = window.setTimeout(() => setForcedStopId(currentStep.id), STOP_ARRIVAL_FALLBACK_MS);
    return () => window.clearTimeout(id);
  }, [phase, currentStep, arrivedStopId]);
  // A stop step is waiting on GPS (or the fallback above) before its own
  // announcement can speak - see arrivedStopId's own doc comment. Every
  // other phase/step kind is never pending at all.
  const stopArrivalPending =
    phase === "step" &&
    currentStep.kind === "stop" &&
    arrivedStopId !== currentStep.id &&
    forcedStopId !== currentStep.id;

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

  // currentIndex already sits at 0 while in "depot" and at totalSteps-1
  // while "arrived" (see below), so neither transition needs to touch it
  // beyond what's written here - RouteProgressBar's bus position is
  // driven straight off currentIndex in every phase.
  const advance = useCallback(() => {
    if (phase === "depot") {
      setPhase("step");
      setCurrentIndex(0);
      return;
    }
    if (phase === "step") {
      if (currentIndex < totalSteps - 1) {
        setCurrentIndex((i) => i + 1);
      } else {
        setPhase("arrived");
      }
      return;
    }
    // "arrived": advancing again does nothing - only the dedicated "End"
    // button (onEndRoute) is allowed to leave this phase, so a driver
    // can't accidentally end the route with the same button/remote
    // gesture used to step through it.
  }, [phase, currentIndex, totalSteps]);

  const goBack = useCallback(() => {
    if (phase === "arrived") {
      setPhase("step");
      setCurrentIndex(totalSteps - 1);
      return;
    }
    if (phase === "step") {
      if (currentIndex === 0) {
        setPhase("depot");
      } else {
        setCurrentIndex((i) => i - 1);
      }
      return;
    }
    // "depot": nothing before it.
  }, [phase, currentIndex, totalSteps]);

  // Direct jump for RouteProgressBar's tap-a-step/scrub gesture - unlike
  // advance/goBack, this can land on any step in either direction, not
  // just the adjacent one. Left ungated by `paused` here (StepScreen
  // itself decides whether to let the gesture reach this at all, same
  // as it does for onAdvance/onBack) so this stays a plain "go here",
  // matching what a route mid-scrub actually wants.
  const jumpTo = useCallback(
    (target: SeekTarget) => {
      if (target.phase === "depot") {
        setPhase("depot");
        setCurrentIndex(0);
        return;
      }
      if (target.phase === "arrived") {
        setPhase("arrived");
        setCurrentIndex(totalSteps - 1);
        return;
      }
      setPhase("step");
      setCurrentIndex(Math.min(Math.max(target.index, 0), totalSteps - 1));
    },
    [totalSteps],
  );

  // Speak the announcement for whatever's current - but not while paused.
  // Each part (stop number / location / rider count) is queued as its
  // own utterance rather than joined into one string, so there's an
  // audible pause between them instead of one run-on sentence.
  //
  // The route-number/school preamble ("Starting route 125 from LaVergne
  // Lake Elementary.") is now the *entire* depot-phase announcement,
  // rather than being prepended to step 0's own announcement - since
  // depot is its own phase, it gets its own turn to speak instead of
  // stacking onto the first real step. The "arrived" phase similarly
  // gets its own short announcement the moment its screen appears
  // ("All stops completed.") - separate from "Route ended.", which
  // still only fires from endRoute() below, when "End" is actually
  // tapped.
  //
  // announcementDone tracks whether the *last* queued utterance for the
  // current announcement attempt has finished (or errored/timed out) -
  // StepScreen uses it to hold off popping up the rider check-in card
  // until the driver has actually heard the stop announcement, rather
  // than it appearing over top of still-playing speech.
  //
  // Derived as a key comparison (attemptKey === completedKey) rather
  // than an effect calling setState(false) up front and setState(true)
  // once speech ends: since resumeCount/phase/currentStep already change
  // reactively on their own, attemptKey naturally goes stale - and so
  // announcementDone naturally reads false - the moment a new attempt
  // starts, with no explicit "reset" call needed. Every setState call
  // below happens inside a callback that responds to an external event
  // (the utterance ending, or a timeout), never synchronously in the
  // effect body itself.
  const attemptKey =
    phase === "depot"
      ? `depot-${resumeCount}`
      : phase === "arrived"
        ? `arrived-${resumeCount}`
        : `${currentStep.id}-${resumeCount}`;
  const [completedKey, setCompletedKey] = useState<string | null>(null);
  const announcementDone = completedKey === attemptKey;

  useEffect(() => {
    if (!started || paused) return;
    // Genuinely nothing to speak or mark done yet - not the same as the
    // "no parts" fallback just below (an arrived phase with nothing to
    // say, say), which always marks the attempt done immediately.
    // completedKey must stay stale here so announcementDone stays false
    // for as long as this stop is still waiting - see arrivedStopId's
    // own doc comment for what that gates (the roster box's own auto-
    // open, useNavigationPrompts' own preview).
    if (stopArrivalPending) return;

    const parts =
      phase === "depot"
        ? [
            `Starting route ${speakRouteNumber(route.routeNumber)} ${
              // Pickup and a field trip both default to "to" (heading
              // there); only dropoff actually starts "from" the school.
              route.tripType === "dropoff" ? "from" : "to"
            } ${route.schoolName}.`,
            // schedulePhrase's own doc comment above has the full
            // reasoning - null whenever there's nothing to report
            // (departureTime doesn't parse, or this is a resumed
            // session with no real actualStartMsRef to read).
            ...(actualStartMsRef.current != null
              ? [schedulePhrase(route.departureTime, actualStartMsRef.current)].filter(
                  (p): p is string => p != null,
                )
              : []),
          ]
        : phase === "arrived"
          ? ["All stops completed."]
          : [...currentStep.announcement];

    if (parts.length === 0 || typeof window === "undefined" || !("speechSynthesis" in window)) {
      const id = setTimeout(() => setCompletedKey(attemptKey), 0);
      return () => clearTimeout(id);
    }

    window.speechSynthesis.cancel();
    const utterances = parts.map((part) => new SpeechSynthesisUtterance(part));
    const last = utterances[utterances.length - 1];
    const markDone = () => setCompletedKey(attemptKey);
    last.addEventListener("end", markDone);
    last.addEventListener("error", markDone);
    const fallback = window.setTimeout(markDone, 8000);
    for (const utterance of utterances) {
      window.speechSynthesis.speak(utterance);
    }

    return () => {
      last.removeEventListener("end", markDone);
      last.removeEventListener("error", markDone);
      window.clearTimeout(fallback);
    };
  }, [
    phase,
    currentStep,
    started,
    paused,
    stopArrivalPending,
    attemptKey,
    route.routeNumber,
    route.departureTime,
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
    actualStartMsRef.current = Date.now();
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

  // resumeAtStepIndex's own remaining piece, now that currentIndex/
  // phase/started above already seed straight into the resumed step
  // (see their own doc comment for why that's a lazy initializer, not
  // this effect) - the silent audio loop Media Session actions need
  // still has to actually be created and started, the one part of
  // start() that's a real side effect rather than just setState, so a
  // ref assignment here (not a setState call) is exactly what this
  // lint rule allows inside an effect body. Runs once, right as this
  // mount begins - every ordinary "Start Route" still goes through
  // start() directly, from a real tap, never through this effect.
  // audio.play()'s own autoplay-policy gesture requirement (see
  // start()'s own comment) isn't guaranteed satisfied here - this mount
  // happens after a screen navigation, not synchronously inside the tap
  // that triggered it - so the silent loop can silently fail to
  // actually start playing (already caught, same as start() itself);
  // worst case, a Bluetooth remote's nexttrack/previoustrack needs one
  // ordinary on-screen tap first before it starts responding again,
  // same as if the device paired mid-route for the first time.
  useEffect(() => {
    if (resumeAtStepIndex == null) return;
    const audio = new Audio(SILENT_LOOP_DATA_URI);
    audio.loop = true;
    audio.volume = 0.02;
    void audio.play().catch(() => {});
    audioRef.current = audio;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Shared by endRoute and exitTrip below: resets everything (index/
  // phase/pause/silent audio) so a subsequent "Start Route" begins
  // clean - this doesn't unmount the hook (RouteApp keeps calling it
  // regardless of `started`), so that reset has to happen explicitly
  // here rather than relying on the unmount cleanup above.
  const resetTrip = useCallback(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    setPaused(false);
    setPhase("depot");
    setCurrentIndex(0);
    setStarted(false);
    // Stop ids are just this route's own row indexes (parseRouteCsv.ts),
    // not unique per real-world trip - a fresh run of the *same* route
    // after this reset reuses every one of them, so a stale
    // arrivedStopId/forcedStopId surviving from the run just ended would
    // wrongly read as "already arrived" the instant that same stop
    // becomes current again.
    setArrivedStopId(null);
    setForcedStopId(null);
  }, []);

  // Tapping "End Route" in the confirmation modal from the "arrived"
  // phase: announce that the route ended, then reset.
  const endRoute = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(new SpeechSynthesisUtterance("Route ended."));
    }
    resetTrip();
  }, [resetTrip]);

  // Tapping the logo mid-route: back to the route list immediately, no
  // "Route ended." announcement - unlike endRoute, this isn't a
  // deliberate "we finished" moment, just a navigation shortcut, so it
  // stays quiet (still cancels whatever announcement was mid-speech,
  // same as pausing does, just without speaking a new one over it).
  const exitTrip = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    resetTrip();
  }, [resetTrip]);

  return {
    currentStep,
    currentIndex,
    totalSteps,
    phase,
    totalStops,
    currentStopNumber,
    stopProgressNumber,
    started,
    start,
    advance,
    goBack,
    jumpTo,
    paused,
    togglePause,
    endRoute,
    exitTrip,
    announcementDone,
    setArrivedStopId,
  };
}
