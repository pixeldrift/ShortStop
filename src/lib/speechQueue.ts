/**
 * The one authoritative owner of window.speechSynthesis - every other
 * file in this app that wants to say something out loud goes through
 * one of the three functions below instead of ever touching
 * speechSynthesis/SpeechSynthesisUtterance directly. Before this
 * existed, useRouteStepper.ts's own per-step announcement effect ran
 * its own hand-rolled cancel()+speak() dance independently of this
 * file's own plain speak() (used everywhere else) - two systems
 * hitting the same browser singleton with no coordination, which is
 * exactly what let a step change's own cancel() wipe out an unrelated
 * utterance (a GPS-confirmed "Turned right onto Main Street.") that
 * happened to still be mid-speech at that instant.
 *
 * The fix isn't "nothing ever cancels" - useRouteStepper.ts's own
 * step-to-step transition is a genuine, intentional exception (a
 * driver who's rapid-tapped through several steps manually should hear
 * only wherever they actually landed, not every step they passed
 * through stacked up and read back minutes later) - it's that only
 * *that one* transition cancels, through its own dedicated
 * announceStep(), and it takes an explicit `parts` array precisely so
 * any GPS-completion phrase that belongs with this exact transition
 * (a turn-completion/stop-and-go ack) can be folded into the very same
 * cancel-then-speak call rather than left as an independent, separately-
 * timed speak() call for that cancel to steamroll. Every other caller
 * (approach warnings, next-action previews, alerts) uses the plain
 * speak()/announce() below, which only ever appends - exactly the
 * "each speak() call is independent, but nothing tramples another"
 * behavior this file's own predecessor already had for everything
 * except useRouteStepper's own cancel.
 *
 * The `generation` counter is what keeps a stale onDone from firing
 * after the group it belonged to has itself been superseded (by a
 * later announceStep() or an explicit interrupt()) - the same "don't
 * let an old attempt's completion secretly satisfy a newer one"
 * property useRouteStepper.ts's own effect-cleanup used to get for
 * free from React (removing the old utterance's event listeners every
 * time its own effect re-ran), now provided here instead since the
 * cancel/speak logic itself lives in this file, not in that effect
 * body.
 */

let generation = 0;

function synth(): SpeechSynthesis | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  return window.speechSynthesis;
}

/** Speaks every part of `parts` back-to-back as one group - the same
 * "several short utterances with an audible pause between them, not
 * one run-on sentence" shape useRouteStepper.ts's own per-step
 * announcement has always used - and calls `onDone` once the last one
 * finishes (or errors, or 8s pass with neither - the same generous
 * fallback the old hand-rolled version used, for a TTS engine that
 * never fires either event). Purely additive: whatever's already
 * queued or speaking keeps going, this just appends after it. */
export function announce(parts: string[], onDone?: () => void): void {
  const engine = synth();
  generation += 1;
  const myGeneration = generation;
  const markDone = () => {
    if (myGeneration !== generation) return;
    onDone?.();
  };

  if (!engine || parts.length === 0) {
    // No TTS available, or genuinely nothing to say - still resolve
    // `onDone` asynchronously (never synchronously inside a caller's
    // own render) so a consumer waiting on it (announcementDone, the
    // roster auto-open gate) doesn't wait forever.
    if (onDone) window.setTimeout(markDone, 0);
    return;
  }

  const utterances = parts.map((part) => new SpeechSynthesisUtterance(part));
  const last = utterances[utterances.length - 1];
  if (onDone) {
    last.addEventListener("end", markDone);
    last.addEventListener("error", markDone);
    window.setTimeout(markDone, 8000);
  }
  for (const utterance of utterances) {
    engine.speak(utterance);
  }
}

/** One utterance, no completion callback - the ordinary case for
 * everything that isn't useRouteStepper's own per-step announcement
 * (approach warnings, next-action previews, alerts, waypoint-
 * completion acks). */
export function speak(text: string): void {
  announce([text]);
}

/** useRouteStepper.ts's own step-transition announcement, and only
 * that - the one place in this app that deliberately replaces whatever
 * is still queued/speaking instead of adding to it. Any phrase that
 * belongs with this exact transition (a turn-completion/stop-and-go
 * ack queued via useRouteStepper's own pending-announcement buffer)
 * must already be folded into `parts`, ahead of the step's own
 * announcement - queued as a separate speak()/announce() call instead,
 * it would just be one more casualty of this very cancel. */
export function announceStep(parts: string[], onDone?: () => void): void {
  interrupt();
  announce(parts, onDone);
}

/** Cancels whatever's queued/speaking right now, with nothing to
 * replace it - pausing the route, ending it, going off-route, exiting
 * mid-trip. Bumps `generation` first so a still-in-flight onDone from
 * whatever this interrupted can never fire afterward. */
export function interrupt(): void {
  generation += 1;
  synth()?.cancel();
}
