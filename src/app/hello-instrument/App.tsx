import { useEffect, useRef, useState } from "react";
import { useDevice } from "../shared/device";
import { Frame } from "../shared/Frame";

/**
 * hello-instrument - the marquee: POLYPHONY, and now MULTI-SAMPLE.
 *
 * Uses the native Web Audio API. 
 * `jweb~` supports direct audio signal routing into Max!
 */

const SAMPLE_BASE = "https://raw.githubusercontent.com/alienmind/m4l-jweb/main/samples/piano";

const NOTES = [
  { key: "c", label: "C", slot: 0, file: "c1.wav" },
  { key: "e", label: "E", slot: 1, file: "e1.wav" },
  { key: "g", label: "G", slot: 2, file: "g1.wav" },
] as const;

const PADS = [
  { id: "C3", note: 0, rate: 1, octave: 3 },
  { id: "E3", note: 1, rate: 1, octave: 3 },
  { id: "G3", note: 2, rate: 1, octave: 3 },
  { id: "C4", note: 0, rate: 2, octave: 4 },
  { id: "E4", note: 1, rate: 2, octave: 4 },
  { id: "G4", note: 2, rate: 2, octave: 4 },
] as const;

const STEP_MS = 750;
const HOLD_MS = 1000;

const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();

export default function HelloInstrument() {
  const device = useDevice();
  const [status, setStatus] = useState("Idle - fetch, then load, then Strike or Play a chord.");
  const [loaded, setLoaded] = useState<Record<number, AudioBuffer>>({});
  const [active, setActive] = useState<string[]>(["C3", "E3", "G3"]);
  const [running, setRunning] = useState(false);
  const [lit, setLit] = useState<string[]>([]);
  
  const activeSources = useRef<AudioBufferSourceNode[]>([]);

  const ready = NOTES.every((n) => loaded[n.slot]);

  function toggle(id: string) {
    setActive((a) => (a.includes(id) ? a.filter((p) => p !== id) : [...a, id]));
  }

  function strike(padIds: string[]) {
    setLit(padIds);
    for (const id of padIds) {
      const pad = PADS.find((p) => p.id === id);
      if (!pad) continue;
      const buffer = loaded[pad.note];
      if (!buffer) continue;
      
      const source = audioCtx.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = pad.rate;
      
      // We can add a simple envelope or just stop it after HOLD_MS
      source.connect(audioCtx.destination);
      source.start();
      
      const durationSeconds = HOLD_MS / 1000;
      source.stop(audioCtx.currentTime + durationSeconds);
      
      activeSources.current.push(source);
      source.onended = () => {
        activeSources.current = activeSources.current.filter((s) => s !== source);
      };
    }
  }

  async function fetchAndLoad() {
    setRunning(false);
    setLoaded({});
    try {
      const next: Record<number, AudioBuffer> = {};
      for (const n of NOTES) {
        setStatus(`Downloading ${n.file}...`);
        const res = await fetch(`${SAMPLE_BASE}/${n.file}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const arrayBuffer = await res.arrayBuffer();
        
        setStatus(`Loading ${n.file}...`);
        const decodedBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        next[n.slot] = decodedBuffer;
      }
      setLoaded(next);
      setStatus(`Loaded ${NOTES.length} samples. Strike or Play a chord.`);
    } catch (err) {
      setStatus(`Failed: ${err instanceof Error ? err.message : String(err)} (samples resolve only once this branch is on main)`);
    }
  }

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
