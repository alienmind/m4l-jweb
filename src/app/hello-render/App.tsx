import { useRef, useState } from "react";
import { useDevice } from "../shared/device";
import { Frame } from "../shared/Frame";

/**
 * hello-render - the proving ground for the SUPERDOUGH Rendering pipe.
 *
 * Uses the native Web Audio API since Max 9 allows `jweb~`
 * to output audio natively to the track.
 *
 * Instead of saving to file, we synthesize an AudioBuffer in memory
 * and loop it using an AudioBufferSourceNode.
 */

const SAMPLE_RATE = 44100;
const LOOP_BEATS = 4;
const LOOP_SECONDS = 2; // 4 beats at 120 BPM

const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();

function generateSineBuffer(freq: number, seconds = LOOP_SECONDS, sampleRate = SAMPLE_RATE): AudioBuffer {
  const frames = Math.round(seconds * sampleRate);
  const buffer = audioCtx.createBuffer(2, frames, sampleRate);
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  for (let i = 0; i < frames; i++) {
    const sample = Math.sin((2 * Math.PI * freq * i) / sampleRate) * 0.5;
    left[i] = sample;
    right[i] = sample;
  }
  return buffer;
}

const SLOTS = {
  rndA: { freq: 440 },
  rndB: { freq: 660 },
} as const;
type Slot = keyof typeof SLOTS;

function phaseMs(beats: number): number {
  const phase = ((beats % LOOP_BEATS) + LOOP_BEATS) % LOOP_BEATS;
  return (phase / LOOP_BEATS) * LOOP_SECONDS * 1000;
}

export default function HelloRender() {
  const [status, setStatus] = useState("Idle. Generate a beep to hear it loop.");
  const [loaded, setLoaded] = useState<Record<Slot, AudioBuffer | null>>({ rndA: null, rndB: null });

  const activeSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const prevPlaying = useRef(false);
  const prevBeats = useRef(0);

  function syncSource(beats: number) {
    if (activeSourceRef.current) {
      // Re-sync logic: in pure Web Audio, jumping is tricky without stopping and recreating the source.
      // For this demo, we'll just log the sync event.
      // A robust sequencer (like Strudel) handles its own scheduling natively anyway.
      const pos = phaseMs(beats);
      setStatus(`Transport sync @ ${beats.toFixed(2)} beats: position ${pos.toFixed(0)} ms.`);
    }
  }

  function onTick(playing: boolean, beats: number) {
    const started = playing && !prevPlaying.current;
    const jumped = playing && Math.abs(beats - prevBeats.current) > 0.5;
    
    if (started || jumped) {
      syncSource(beats);
    }
    
    if (!playing && prevPlaying.current) {
      stop();
    }
    
    prevPlaying.current = playing;
    prevBeats.current = beats;
  }

  const device = useDevice(onTick);

  function generate(slot: Slot) {
    const { freq } = SLOTS[slot];
    setStatus(`Generating ${freq} Hz beep for ${slot}...`);
    try {
      const buffer = generateSineBuffer(freq);
      setLoaded((l) => ({ ...l, [slot]: buffer }));
      setStatus(`Generated ${slot}. Arm it to play.`);
    } catch (err) {
      setStatus(`Generate failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function arm(slot: Slot) {
    stop();
    
    const buffer = loaded[slot];
    if (!buffer) return;
    
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(audioCtx.destination);
    source.start();
    activeSourceRef.current = source;
    
    setStatus(`Armed and playing ${slot}.`);
  }
  
  function stop() {
    if (activeSourceRef.current) {
      activeSourceRef.current.stop();
      activeSourceRef.current = null;
      setStatus(`Stopped.`);
    }
  }

  return (
    <Frame title="HELLO RENDER" device={device}>
      <dt>Slot A (440 Hz)</dt>
      <dd>
        <button onClick={() => generate("rndA")} style={{ padding: "4px 8px" }}>
          Generate in memory
        </button>{" "}
        <button onClick={() => arm("rndA")} disabled={!loaded.rndA} style={{ padding: "4px 8px" }}>
          Arm A
        </button>
      </dd>
      <dt>Slot B (660 Hz)</dt>
      <dd>
        <button onClick={() => generate("rndB")} style={{ padding: "4px 8px" }}>
          Generate in memory
        </button>{" "}
        <button onClick={() => arm("rndB")} disabled={!loaded.rndB} style={{ padding: "4px 8px" }}>
          Arm B
        </button>
      </dd>
      <dt>Transport</dt>
      <dd>
        {device.playing ? "playing" : "stopped"} @ {device.beats.toFixed(2)} beats
        {" "}
        <button
          onClick={() => {
            syncSource(device.beats);
          }}
          style={{ padding: "4px 8px" }}
        >
          Re-sync now
        </button>{" "}
        <button onClick={() => stop()} style={{ padding: "4px 8px" }}>
          Stop
        </button>
      </dd>
      <dt>Status</dt>
      <dd>{status}</dd>
    </Frame>
  );
}
