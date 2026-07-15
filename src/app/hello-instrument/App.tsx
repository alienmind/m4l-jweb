import { useEffect, useRef, useState } from "react";
import { fetchToFile, loadSample, playVoice } from "@m4l-jweb/bridge";
import type { LoadedSample } from "@m4l-jweb/bridge";
import { useDevice } from "../shared/device";
import { Frame } from "../shared/Frame";

/**
 * hello-instrument - the marquee: POLYPHONY, and now MULTI-SAMPLE.
 *
 * The honest test of a [poly~] is notes at the SAME instant, so this strikes whole
 * chords: every note is a `playVoice()` fired in the same tick, and Max allocates one
 * voice per note. And it is a keymap, not one stretched sample: the base octave
 * (C3/E3/G3) plays a DEDICATED piano recording per note at rate 1 - no repitching -
 * while the octave above (C4/E4/G4) repitches the SAME three buffers up an octave
 * (rate 2). Toggle both octaves and Play to hear the two chords alternate.
 *
 * The samples are served from THIS repo (samples/piano/), so the demo does not depend
 * on a third-party URL staying up. That path only resolves once this branch is on
 * `main` - see SAMPLE_BASE below.
 *
 * It is an INSTRUMENT device: it sits on a MIDI track and originates the track's
 * sound. Pass the `channels` we MEASURED at load so a mono sample folds to both ears.
 */

// Served from our own repo once this branch merges to main. Until then the fetch will
// 404 (the path does not exist on main yet) - which is the expected, documented state.
const SAMPLE_BASE = "https://raw.githubusercontent.com/alienmind/m4l-jweb/main/samples/piano";

// The base octave: one dedicated piano recording per note. `slot` is the index into
// the manifest's `slots: ["c", "e", "g"]` - the voice picks the buffer by it.
const NOTES = [
  { key: "c", label: "C", slot: 0, file: "c1.wav" },
  { key: "e", label: "E", slot: 1, file: "e1.wav" },
  { key: "g", label: "G", slot: 2, file: "g1.wav" },
] as const;

// Two octaves of pads over those three samples. rate 1 = the sample itself; rate 2 =
// an octave up, repitched from the same buffer. THIS is the multi-sample point: the
// low chord is three real recordings, the high chord is those three repitched.
const PADS = [
  { id: "C3", note: 0, rate: 1, octave: 3 },
  { id: "E3", note: 1, rate: 1, octave: 3 },
  { id: "G3", note: 2, rate: 1, octave: 3 },
  { id: "C4", note: 0, rate: 2, octave: 4 },
  { id: "E4", note: 1, rate: 2, octave: 4 },
  { id: "G4", note: 2, rate: 2, octave: 4 },
] as const;

// One CHORD per step; HOLD generous so a struck chord rings through and, when two
// chords alternate, one tail overlaps the next attack - more voices live at once.
const STEP_MS = 750;
const HOLD_MS = 1000;

export default function HelloInstrument() {
  const device = useDevice();
  const [status, setStatus] = useState("Idle - fetch, then load, then Strike or Play a chord.");
  const [loaded, setLoaded] = useState<Record<number, LoadedSample>>({});
  const [active, setActive] = useState<string[]>(["C3", "E3", "G3"]); // low triad on by default
  const [running, setRunning] = useState(false);
  const [lit, setLit] = useState<string[]>([]);

  const ready = NOTES.every((n) => loaded[n.slot]);

  function toggle(id: string) {
    setActive((a) => (a.includes(id) ? a.filter((p) => p !== id) : [...a, id]));
  }

  /** Fire every pad of a chord in one tick - simultaneity is the whole demonstration. */
  function strike(padIds: string[]) {
    setLit(padIds);
    for (const id of padIds) {
      const pad = PADS.find((p) => p.id === id);
      if (!pad) continue;
      const s = loaded[pad.note];
      playVoice({ slot: pad.note, rate: pad.rate, velocity: 100, durationMs: HOLD_MS, channels: s?.channels ?? 2 });
    }
  }

  async function fetchAndLoad() {
    setRunning(false);
    setLoaded({});
    try {
      const next: Record<number, LoadedSample> = {};
      for (const n of NOTES) {
        setStatus(`Downloading ${n.file}...`);
        await fetchToFile(`${SAMPLE_BASE}/${n.file}`, n.file);
        setStatus(`Loading ${n.file}...`);
        next[n.slot] = await loadSample(n.key, n.file);
      }
      setLoaded(next);
      setStatus(`Loaded ${NOTES.length} samples. Strike or Play a chord.`);
    } catch (err) {
      setStatus(`Failed: ${err instanceof Error ? err.message : String(err)} (samples resolve only once this branch is on main)`);
    }
  }

  // The loop alternates the two octave chords, each struck simultaneously. `active` is
  // read through a ref so retoggling a pad mid-loop does not restart the interval.
  const activeRef = useRef(active);
  activeRef.current = active;
  useEffect(() => {
    if (!running || !ready) return;
    let i = 0;
    const tick = () => {
      const pads = activeRef.current;
      const lows = pads.filter((id) => PADS.find((p) => p.id === id)?.octave === 3);
      const highs = pads.filter((id) => PADS.find((p) => p.id === id)?.octave === 4);
      const chords = [lows, highs].filter((c) => c.length > 0);
      if (chords.length === 0) return;
      strike(chords[i % chords.length]);
      i++;
    };
    tick();
    const id = setInterval(tick, STEP_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, ready]);

  const canPlay = ready && active.length > 0;

  return (
    <Frame title="HELLO INSTRUMENT" device={device}>
      <dt>Samples</dt>
      <dd>
        <button onClick={fetchAndLoad} style={{ padding: "4px 8px" }}>
          Fetch &amp; Load (C, E, G)
        </button>
      </dd>
      <dt>Pads</dt>
      <dd>
        <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
          {PADS.map((p) => {
            const on = active.includes(p.id);
            return (
              <button
                key={p.id}
                onClick={() => toggle(p.id)}
                aria-pressed={on}
                title={`${p.octave === 3 ? "dedicated sample" : "repitched +1 octave"} - click to ${on ? "remove" : "add"}`}
                style={{
                  padding: "6px 10px",
                  fontWeight: on ? 700 : 400,
                  outline: lit.includes(p.id) ? "2px solid currentColor" : "none",
                  opacity: on ? 1 : 0.5,
                }}
              >
                {p.id}
              </button>
            );
          })}
        </div>
      </dd>
      <dt>Chord</dt>
      <dd>
        <button onClick={() => strike(active)} disabled={!canPlay || running} style={{ padding: "6px 12px" }}>
          Strike
        </button>{" "}
        <button onClick={() => setRunning((r) => !r)} disabled={!canPlay} style={{ padding: "6px 12px", fontWeight: 700 }}>
          {running ? "■ Stop" : "▶ Play"}
        </button>
        <div style={{ marginTop: "2px", opacity: 0.75 }}>{status}</div>
      </dd>
    </Frame>
  );
}
