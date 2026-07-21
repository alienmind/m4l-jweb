import { useCallback, useEffect, useRef, useState } from "react";
import { onNote } from "@m4l-jweb/bridge";
import { useDevice } from "../shared/device";
import { Frame } from "../shared/Frame";

/**
 * hello-instrument - a PLAYABLE multi-sample instrument.
 *
 * What it demonstrates, in one device:
 *
 *   1. The page fetches and decodes real audio files (three piano notes) and plays
 *      them through `[jweb~]`'s signal outlets, so they land on the track's fader.
 *   2. **MIDI IN drives it** (`midiin` chain -> `onNote`). Put hello-midi, a clip, or
 *      a keyboard in front of it on the track and it plays what they send. This is
 *      what makes it an *instrument* rather than a page that happens to make noise.
 *   3. A real KEYMAP: three samples cover the whole keyboard. Each incoming pitch
 *      picks the nearest recorded note and is repitched from it, so C#3 is a real C
 *      recording shifted up one semitone rather than a stretched anything.
 *   4. POLYPHONY, for free. Every note is its own AudioBufferSourceNode; the browser
 *      mixes them. There is no voice allocator here because Web Audio does not need
 *      one - the `[poly~]` this device used to drive is gone.
 */

const SAMPLE_BASE = "https://raw.githubusercontent.com/alienmind/m4l-jweb/main/samples/piano";

/**
 * The recorded notes, and the MIDI pitch each one actually sounds. Repitching is
 * relative, so what matters is the DISTANCE between these numbers and the incoming
 * note - 60/64/67 is a C major triad in the middle of the keyboard (C4 = 60, the MIDI
 * standard; Live labels that C3, which is a naming convention, not a different pitch).
 */
const SAMPLES = [
  { key: "c", label: "C", pitch: 60, file: "c1.wav" },
  { key: "e", label: "E", pitch: 64, file: "e1.wav" },
  { key: "g", label: "G", pitch: 67, file: "g1.wav" },
] as const;

/** The pads, for playing it by hand when no MIDI is connected. */
const PADS = [60, 62, 64, 65, 67, 69, 71, 72] as const;

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const noteName = (pitch: number) => `${NOTE_NAMES[pitch % 12]}${Math.floor(pitch / 12) - 1}`;

const STEP_MS = 400;
const HOLD_MS = 1400;

/** Lazily created: constructing an AudioContext at module scope can leave it suspended. */
let ctx: AudioContext | null = null;
function audioContext(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

export default function HelloInstrument() {
  const device = useDevice();
  const [status, setStatus] = useState("Load the samples, then play the pads or send MIDI.");
  const [loaded, setLoaded] = useState<Record<string, AudioBuffer>>({});
  const [running, setRunning] = useState(false);
  const [lit, setLit] = useState<number[]>([]);
  const [midiCount, setMidiCount] = useState(0);

  // The bound-once MIDI handler must see the CURRENT samples, not the empty object it
  // closed over at mount.
  const loadedRef = useRef(loaded);
  loadedRef.current = loaded;

  const ready = SAMPLES.every((s) => loaded[s.key]);

  /** Play one note: nearest recorded sample, repitched to the pitch asked for. */
  const play = useCallback((pitch: number, velocity = 100) => {
    const nearest = SAMPLES.reduce((best, s) =>
      Math.abs(s.pitch - pitch) < Math.abs(best.pitch - pitch) ? s : best,
    );
    const buffer = loadedRef.current[nearest.key];
    if (!buffer) return;

    const ac = audioContext();
    const source = ac.createBufferSource();
    source.buffer = buffer;
    // Twelve-tone equal temperament: one semitone is a factor of 2^(1/12).
    source.playbackRate.value = Math.pow(2, (pitch - nearest.pitch) / 12);

    const amp = ac.createGain();
    amp.gain.value = velocity / 127;
    source.connect(amp);
    amp.connect(ac.destination);

    // A piano decays; there is no note-off to wait for (see onNote). Release over the
    // last 150 ms so the tail fades instead of clicking off.
    const now = ac.currentTime;
    const end = now + HOLD_MS / 1000;
    amp.gain.setValueAtTime(amp.gain.value, end - 0.15);
    amp.gain.linearRampToValueAtTime(0, end);
    source.start(now);
    source.stop(end + 0.01);
    source.onended = () => {
      source.disconnect();
      amp.disconnect();
    };

    setLit((l) => [...l, pitch]);
    setTimeout(() => setLit((l) => l.filter((p) => p !== pitch)), 150);
  }, []);

  // MIDI from the track: whatever is in front of this device on the chain plays it.
  // Bound ONCE (handlers are subscribers - binding twice would double every note);
  // `play` is reached through a ref, and reads the samples through one too.
  const playRef = useRef(play);
  playRef.current = play;
  const bound = useRef(false);
  useEffect(() => {
    if (bound.current) return;
    bound.current = true;
    onNote((pitch, velocity) => {
      setMidiCount((n) => n + 1);
      playRef.current(pitch, velocity);
    });
  }, []);

  async function fetchAndLoad() {
    setRunning(false);
    setLoaded({});
    try {
      const next: Record<string, AudioBuffer> = {};
      for (const s of SAMPLES) {
        setStatus(`Downloading ${s.file}...`);
        const res = await fetch(`${SAMPLE_BASE}/${s.file}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setStatus(`Decoding ${s.file}...`);
        next[s.key] = await audioContext().decodeAudioData(await res.arrayBuffer());
      }
      setLoaded(next);
      setStatus(`Loaded ${SAMPLES.length} samples. Play the pads, or send MIDI into the track.`);
    } catch (err) {
      setStatus(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // The arpeggio, for hearing polyphony without a MIDI source: notes overlap because
  // each one rings for HOLD_MS, well past the STEP_MS between them.
  useEffect(() => {
    if (!running || !ready) return;
    let i = 0;
    const tick = () => play(PADS[i++ % PADS.length]);
    tick();
    const id = setInterval(tick, STEP_MS);
    return () => clearInterval(id);
  }, [running, ready, play]);

  return (
    <Frame title="HELLO INSTRUMENT" device={device}>
      <dt>Samples</dt>
      <dd>
        <button onClick={fetchAndLoad} style={{ padding: "4px 8px" }}>
          Fetch &amp; Load (C, E, G)
        </button>
      </dd>
      <dt>Keys</dt>
      <dd>
        <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
          {PADS.map((pitch) => (
            <button
              key={pitch}
              onClick={() => play(pitch)}
              disabled={!ready}
              title={`${noteName(pitch)} - repitched from the nearest recorded sample`}
              style={{
                padding: "6px 10px",
                outline: lit.includes(pitch) ? "2px solid currentColor" : "none",
                opacity: ready ? 1 : 0.5,
              }}
            >
              {noteName(pitch)}
            </button>
          ))}
        </div>
      </dd>
      <dt>Arpeggio</dt>
      <dd>
        <button onClick={() => setRunning((r) => !r)} disabled={!ready} style={{ padding: "6px 12px", fontWeight: 700 }}>
          {running ? "■ Stop" : "▶ Play"}
        </button>
        <div style={{ marginTop: "2px", opacity: 0.75 }}>{status}</div>
        <div style={{ marginTop: "2px", opacity: 0.75 }}>
          MIDI notes received: {midiCount}
          {midiCount === 0 && " - put a MIDI device (hello-midi, a clip, a keyboard) before this one"}
        </div>
      </dd>
    </Frame>
  );
}
