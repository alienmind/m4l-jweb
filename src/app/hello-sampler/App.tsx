import { useState, useRef } from "react";
import { useDevice } from "../shared/device";
import { Frame } from "../shared/Frame";

/**
 * The first device in this repo that MAKES a sound.
 * 
 * Uses the native Web Audio API since Max 9 allows `jweb~`
 * to output audio natively to the track.
 */

const SAMPLES = [
  {
    slot: "stereo",
    label: "Stereo",
    url: "https://raw.githubusercontent.com/geikha/tidal-drum-machines/main/machines/AJKPercusyn/ajkpercusyn-bd/Bassdrum.wav",
  },
  {
    slot: "mono",
    label: "Mono",
    url: "https://raw.githubusercontent.com/Bubobubobubobubo/Dough-Juj/main/juj/PLE.wav",
  },
] as const;

// Shared audio context for the app
const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();

export default function HelloSampler() {
  const device = useDevice();
  return (
    <Frame title="HELLO SAMPLER" device={device}>
      {SAMPLES.map((s) => (
        <SampleRow key={s.slot} {...s} />
      ))}
    </Frame>
  );
}

function SampleRow({ label, url }: { label: string; url: string }) {
  const [status, setStatus] = useState("Idle");
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);

  async function load() {
    setBuffer(null);
    setStatus("Downloading and decoding...");
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const arrayBuffer = await response.arrayBuffer();
      const decodedBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      setBuffer(decodedBuffer);
      setStatus(`Loaded ${Math.round(decodedBuffer.duration * 1000)} ms, ${decodedBuffer.numberOfChannels} ch, ${decodedBuffer.sampleRate} Hz`);
    } catch (err) {
      setStatus(`Load failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function play() {
    if (!buffer) return;
    
    // Stop any existing playback
    stop();
    
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(audioCtx.destination);
    source.start();
    
    source.onended = () => {
      if (sourceRef.current === source) {
        sourceRef.current = null;
      }
    };
    
    sourceRef.current = source;
  }
  
  function stop() {
    if (sourceRef.current) {
      sourceRef.current.stop();
      sourceRef.current = null;
    }
  }

  return (
    <>
      <dt>{label}</dt>
      <dd>
        <button onClick={load} style={{ padding: "4px 8px" }}>
          1. Fetch & Load
        </button>{" "}
        <button onClick={play} disabled={!buffer} style={{ padding: "4px 8px" }}>
          2. Play
        </button>{" "}
        <button onClick={stop} disabled={!buffer} style={{ padding: "4px 8px" }}>
          Stop
        </button>
        <div style={{ marginTop: "2px", opacity: 0.75 }}>
          {status}
        </div>
      </dd>
    </>
  );
}
