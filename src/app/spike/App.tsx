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
import { IN, OUT } from "./protocol";

export default function Spike() {
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

  return (
    <main className="device">
      <header>
        <h1>SPIKE</h1>
        <span className="badge dev">not a device</span>
      </header>

      <dl>
        <dt>1.1 set</dt>
        <dd>
          <button onClick={() => outlet(OUT.set_param, Math.random())}>set_param</button>
          <button onClick={() => outlet(OUT.raw_param, Math.random())}>raw_param</button>
          <div>
            dial echoes: <strong>{echoes}</strong>
            {lastEcho !== null && ` (last ${lastEcho.toFixed(3)})`}
          </div>
          <small>set_param must NOT raise the count. raw_param must. If both do, the Surface needs the [gate] fallback.</small>
        </dd>

        <dt>1.2 buffer~</dt>
        <dd>
          <input value={bufferPath} onChange={(e) => setBufferPath(e.target.value)} size={40} />
          <button onClick={() => outlet(OUT.buffer_load, bufferPath)} disabled={!bufferPath.trim()}>
            buffer_load
          </button>
          <button onClick={() => outlet(OUT.buffer_load, probePath)} disabled={!probePath}>
            load the .html (control)
          </button>
          <div>{buffer ?? "-"}</div>
          <small>
            The buffer~ starts empty, so <strong>frames&gt;0 is the finding</strong> - and a non-zero midsample is what proves audio actually landed.
            The control button points the same `replace` at {probePath || "the extracted .html"}, which is not audio: it should leave the buffer at 0.
          </small>
        </dd>

        <dt>1.3 maxurl</dt>
        <dd>
          <input value={urlWords} onChange={(e) => setUrlWords(e.target.value)} size={40} />
          <button onClick={() => outlet(OUT.url_send, ...urlWords.trim().split(/\s+/))}>send</button>
          <div>{urlResult ?? "-"}</div>
          <small>Raw words, straight to [maxurl]. Nobody here has confirmed its vocabulary - that is the point. Try things.</small>
        </dd>
      </dl>

      <footer>
        <span>doc/SPIKES.md has the procedure and the results table</span>
      </footer>
    </main>
  );
}
