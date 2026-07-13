/**
 * spike - not a device. An instrument for answering the three Stage 1 questions
 * in doc/SPIKES.md.
 *
 * Every button fires ONE message and the answer arrives as another. Watch the Max
 * console, and (in `pnpm dev:spike`) the harness message log - for spike 1.1
 * especially, the finding IS whether a message shows up at all.
 *
 * Delete this folder, patcher/chains.mjs, wrapper/device.ts and the `spike` entry
 * in patcher/devices.mjs once the answers are recorded.
 */
import { useEffect, useState } from "react";
import { bindInlet, outlet } from "@m4l-jweb/bridge";
import { useDevice } from "../shared/device";
import { Frame } from "../shared/Frame";
import { IN, OUT } from "./protocol";

export default function Spike() {
  // The shared chrome, for the build stamps. A spike is run by rebuilding and
  // re-dragging the device, over and over - and Live embeds a COPY in the set,
  // so "is this the build I just made?" is the question you ask most often here.
  // Answering it by hand-rolling a header without the stamps, as this device
  // originally did, is how a spike ends up measuring last week's code.
  const device = useDevice();
  // The echo detector. `set_param` should leave this at 0; `raw_param` should
  // bump it. If BOTH bump it, the Surface needs the [gate] fallback.
  const [echoes, setEchoes] = useState(0);
  const [lastEcho, setLastEcho] = useState<number | null>(null);
  const [buffer, setBuffer] = useState<string | null>(null);
  // An AUDIO file, not the wrapper's own spike.html - buffer~ decodes audio, and
  // pointing it at HTML leaves the buffer untouched at its declared size, which
  // reads exactly like a successful load. jongly.aif ships with Max and sits on
  // its search path, so a bare filename resolves with no path at all.
  const [bufferPath, setBufferPath] = useState("jongly.aif");
  const [probePath, setProbePath] = useState("");
  const [urlWords, setUrlWords] = useState("download https://example.com/a.wav ~/Music/a.wav");
  const [urlResult, setUrlResult] = useState<string | null>(null);

  useEffect(() => {
    bindInlet(IN.dial_out, (v) => {
      setEchoes((n) => n + 1);
      setLastEcho(Number(v));
    });
    bindInlet(IN.buffer_result, (frames, channels, mid) => {
      setBuffer(Number(frames) < 0 ? "FAILED - see the Max console" : `${frames} frames, ${channels} ch, midsample ${mid}`);
    });
    bindInlet(IN.probe_path, (p) => setProbePath(String(p)));
    bindInlet(IN.url_result, (...a) => setUrlResult(a.map(String).join(" ")));

    outlet(OUT.buffer_probe_path);
  }, []);

  // The device view is a fixed ~169 px and clips silently, so the prose is kept
  // short here on purpose: doc/SPIKES.md has the procedure, and the Max console
  // has the findings. This UI only has to be pressable.
  return (
    <Frame title="SPIKE" device={device}>
      <dt>1.1 set</dt>
      <dd className="row">
        <button onClick={() => outlet(OUT.set_param, Math.random())}>set_param</button>
        <button onClick={() => outlet(OUT.raw_param, Math.random())}>raw_param</button>
        <span>
          echoes: <strong>{echoes}</strong>
          {lastEcho !== null && ` (last ${lastEcho.toFixed(3)})`}
        </span>
        <em className="hint">set_param must not raise it; raw_param must</em>
      </dd>

      <dt>1.2 buffer~</dt>
      <dd className="row">
        <input value={bufferPath} onChange={(e) => setBufferPath(e.target.value)} size={14} />
        <button onClick={() => outlet(OUT.buffer_load, bufferPath)} disabled={!bufferPath.trim()}>
          load
        </button>
        <button onClick={() => outlet(OUT.buffer_load, probePath)} disabled={!probePath} title={probePath}>
          .html (control)
        </button>
        <span>{buffer ?? "-"}</span>
        <em className="hint">frames&gt;0 is the finding; the control must stay 0</em>
      </dd>

      <dt>1.3 maxurl</dt>
      <dd className="row">
        <input value={urlWords} onChange={(e) => setUrlWords(e.target.value)} size={30} />
        <button onClick={() => outlet(OUT.url_send, ...urlWords.trim().split(/\s+/))}>send</button>
        <span>{urlResult ?? "-"}</span>
      </dd>
    </Frame>
  );
}
