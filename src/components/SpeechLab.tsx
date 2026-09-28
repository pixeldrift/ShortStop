import React, { useCallback, useEffect, useMemo, useState } from "react";

type SpeechLabProps = {
  open: boolean;
  onClose: () => void;
};

const DEFAULT_TEXT =
  "In 500 feet, turn right onto Weakley Street. Stop ahead. You have arrived at your stop.";

export default function SpeechLab({ open, onClose }: SpeechLabProps) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceKey, setSelectedVoiceKey] = useState("");
  const [text, setText] = useState(DEFAULT_TEXT);
  const [rate, setRate] = useState(1);
  const [pitch, setPitch] = useState(1);
  const [volume, setVolume] = useState(1);
  const [speaking, setSpeaking] = useState(false);

  const supported =
    typeof window !== "undefined" && "speechSynthesis" in window;

  const loadVoices = useCallback(() => {
    if (!supported) return;

    const available = window.speechSynthesis
      .getVoices()
      .slice()
      .sort((a, b) => {
        const aEnglish = a.lang.toLowerCase().startsWith("en");
        const bEnglish = b.lang.toLowerCase().startsWith("en");

        if (aEnglish !== bEnglish) return aEnglish ? -1 : 1;
        if (a.lang !== b.lang) return a.lang.localeCompare(b.lang);
        return a.name.localeCompare(b.name);
      });

    setVoices(available);

    setSelectedVoiceKey((current) => {
      if (
        current &&
        available.some((voice) => voiceKey(voice) === current)
      ) {
        return current;
      }

      const preferred =
        available.find(
          (voice) =>
            voice.default &&
            voice.lang.toLowerCase().startsWith("en")
        ) ??
        available.find((voice) =>
          voice.lang.toLowerCase().startsWith("en")
        ) ??
        available[0];

      return preferred ? voiceKey(preferred) : "";
    });
  }, [supported]);

  useEffect(() => {
    if (!open || !supported) return;

    const synth = window.speechSynthesis;
    synth.addEventListener("voiceschanged", loadVoices);

    // Deferred, not a direct call - some browsers report an empty voice
    // list until just after this effect runs, so an immediate call is
    // never enough on its own; the fallback timer below covers that.
    // Also sidesteps this repo's own react-hooks/set-state-in-effect
    // rule, which flags setState calls made synchronously in an effect
    // body (loadVoices sets state) - see useRouteStepper.ts's own doc
    // comments for the same reasoning elsewhere in this app.
    const initialTimer = window.setTimeout(loadVoices, 0);
    const fallbackTimer = window.setTimeout(loadVoices, 250);

    return () => {
      window.clearTimeout(initialTimer);
      window.clearTimeout(fallbackTimer);
      synth.removeEventListener("voiceschanged", loadVoices);
    };
  }, [open, supported, loadVoices]);

  useEffect(() => {
    if (!open) return;

    return () => {
      window.speechSynthesis?.cancel();
      setSpeaking(false);
    };
  }, [open]);

  const selectedVoice = useMemo(
    () => voices.find((voice) => voiceKey(voice) === selectedVoiceKey),
    [voices, selectedVoiceKey]
  );

  const speak = () => {
    if (!supported || !text.trim()) return;

    const synth = window.speechSynthesis;
    synth.cancel();

    const utterance = new SpeechSynthesisUtterance(text.trim());

    if (selectedVoice) {
      utterance.voice = selectedVoice;
      utterance.lang = selectedVoice.lang;
    }

    utterance.rate = rate;
    utterance.pitch = pitch;
    utterance.volume = volume;

    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);

    setSpeaking(true);
    synth.speak(utterance);
  };

  const stop = () => {
    if (!supported) return;

    window.speechSynthesis.cancel();
    setSpeaking(false);
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="speech-lab-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      style={styles.backdrop}
    >
      <div style={styles.panel}>
        <div style={styles.header}>
          <div>
            <div id="speech-lab-title" style={styles.title}>
              Speech Lab
            </div>

            <div style={styles.subtitle}>
              Test voices available on this device
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close Speech Lab"
            style={styles.closeButton}
          >
            ×
          </button>
        </div>

        {!supported ? (
          <div style={styles.error}>
            Speech synthesis is not available in this browser.
          </div>
        ) : (
          <>
            <label style={styles.label} htmlFor="speech-lab-voice">
              Voice
            </label>

            <select
              id="speech-lab-voice"
              value={selectedVoiceKey}
              onChange={(event) =>
                setSelectedVoiceKey(event.target.value)
              }
              style={styles.select}
            >
              {voices.length === 0 ? (
                <option value="">
                  No voices reported yet…
                </option>
              ) : (
                voices.map((voice) => (
                  <option
                    key={voiceKey(voice)}
                    value={voiceKey(voice)}
                  >
                    {voice.name} — {voice.lang}
                    {voice.default ? " — DEFAULT" : ""}
                    {voice.localService ? " — LOCAL" : ""}
                  </option>
                ))
              )}
            </select>

            <div style={styles.meta}>
              {voices.length} voice
              {voices.length === 1 ? "" : "s"} available
              {selectedVoice
                ? ` • ${
                    selectedVoice.localService
                      ? "local"
                      : "remote"
                  } service`
                : ""}
            </div>

            <label
              style={styles.label}
              htmlFor="speech-lab-text"
            >
              Test phrase
            </label>

            <textarea
              id="speech-lab-text"
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={4}
              style={styles.textarea}
            />

            <Slider
              label="Speed"
              value={rate}
              min={0.5}
              max={2}
              step={0.05}
              onChange={setRate}
            />

            <Slider
              label="Pitch"
              value={pitch}
              min={0}
              max={2}
              step={0.05}
              onChange={setPitch}
            />

            <Slider
              label="Volume"
              value={volume}
              min={0}
              max={1}
              step={0.05}
              onChange={setVolume}
            />

            <div style={styles.actions}>
              <button
                type="button"
                onClick={speak}
                disabled={!voices.length || !text.trim()}
                style={styles.primaryButton}
              >
                ▶ Speak
              </button>

              <button
                type="button"
                onClick={stop}
                disabled={!speaking}
                style={styles.secondaryButton}
              >
                ■ Stop
              </button>
            </div>

            <div style={styles.footer}>
              {speaking
                ? "Speaking…"
                : "Tip: try the same phrase with several voices."}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function voiceKey(voice: SpeechSynthesisVoice) {
  return `${voice.voiceURI}|||${voice.lang}|||${voice.name}`;
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <div style={styles.sliderRow}>
      <div style={styles.sliderHeader}>
        <label>{label}</label>
        <span>{value.toFixed(2)}</span>
      </div>

      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) =>
          onChange(Number(event.target.value))
        }
        style={styles.range}
      />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: "fixed",
    inset: 0,
    zIndex: 9999,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    background: "rgba(0, 0, 0, 0.55)",
    boxSizing: "border-box",
  },

  panel: {
    width: "min(520px, 100%)",
    maxHeight: "calc(100vh - 40px)",
    overflowY: "auto",
    borderRadius: 16,
    padding: 20,
    background: "#ffffff",
    color: "#111827",
    boxShadow: "0 20px 60px rgba(0, 0, 0, 0.3)",
    boxSizing: "border-box",
    fontFamily:
      'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },

  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
    marginBottom: 20,
  },

  title: {
    fontSize: 22,
    fontWeight: 700,
    lineHeight: 1.2,
  },

  subtitle: {
    marginTop: 4,
    fontSize: 13,
    color: "#6b7280",
  },

  closeButton: {
    width: 36,
    height: 36,
    border: 0,
    borderRadius: 18,
    background: "#f3f4f6",
    color: "#374151",
    fontSize: 25,
    lineHeight: 1,
    cursor: "pointer",
  },

  label: {
    display: "block",
    marginBottom: 7,
    fontSize: 13,
    fontWeight: 650,
  },

  select: {
    width: "100%",
    minHeight: 44,
    padding: "8px 10px",
    border: "1px solid #d1d5db",
    borderRadius: 9,
    background: "#ffffff",
    color: "#111827",
    fontSize: 15,
    boxSizing: "border-box",
  },

  meta: {
    minHeight: 18,
    marginTop: 6,
    marginBottom: 18,
    fontSize: 12,
    color: "#6b7280",
  },

  textarea: {
    width: "100%",
    resize: "vertical",
    padding: 11,
    border: "1px solid #d1d5db",
    borderRadius: 9,
    background: "#ffffff",
    color: "#111827",
    fontFamily: "inherit",
    fontSize: 15,
    lineHeight: 1.45,
    boxSizing: "border-box",
  },

  sliderRow: {
    marginTop: 17,
  },

  sliderHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
    fontSize: 13,
    fontWeight: 600,
  },

  range: {
    width: "100%",
    margin: 0,
  },

  actions: {
    display: "flex",
    gap: 10,
    marginTop: 22,
  },

  primaryButton: {
    flex: 1,
    minHeight: 44,
    border: 0,
    borderRadius: 9,
    background: "#2563eb",
    color: "#ffffff",
    fontSize: 15,
    fontWeight: 700,
    cursor: "pointer",
  },

  secondaryButton: {
    minWidth: 90,
    minHeight: 44,
    border: "1px solid #d1d5db",
    borderRadius: 9,
    background: "#f9fafb",
    color: "#374151",
    fontSize: 15,
    fontWeight: 650,
    cursor: "pointer",
  },

  error: {
    padding: 14,
    borderRadius: 9,
    background: "#fef2f2",
    color: "#991b1b",
    fontSize: 14,
  },

  footer: {
    marginTop: 14,
    fontSize: 12,
    color: "#6b7280",
    textAlign: "center",
  },
};