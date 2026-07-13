/**
 * spike - not a device. An instrument for answering the three Stage 1 questions
 * in doc/TODO.md.
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
  const [urlResult, setUrlResult] = useState<string | null>(null);
  // Blank = let the wrapper default it, next to the .amxd. Set it to somewhere
  // unwritable and a FILESYSTEM failure can be asked for on purpose - the one
  // maxurl failure mode still unmeasured, and the one that needs telling apart
  // from an HTTP failure.
  const [dlDest, setDlDest] = useState("");
  // A small, real .wav over https. The download-to-file form is a `dictionary`
  // message per maxurl's reference, so the wrapper builds the dict - raw words
  // cannot say it. If it lands, buffer_load it: 1.2 already proved that seam, so
  // a non-zero frame count here is the whole download->disk->audio path, end to end.
  // Verified live (200, audio/x-wav, ~1.2 MB) at the time of writing - a dead URL
  // and a broken download look identical from in here, and one of them is not the
  // thing under test. Big enough to catch a truncating write, too: this project
  // already knows File.writebytes gives up silently past ~16 KB.
  const [dlUrl, setDlUrl] = useState("https://www.kozco.com/tech/piano2.wav");
  const [dlPath, setDlPath] = useState("");
  const [dlBytes, setDlBytes] = useState<number | null>(null);

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
    bindInlet(IN.download_path, (p) => setDlPath(String(p)));
    bindInlet(IN.url_check_result, (b) => setDlBytes(Number(b)));

    outlet(OUT.buffer_probe_path);
  }, []);

  // The device view is a fixed ~169 px and CLIPS SILENTLY - which this spike
  // proved on itself: the `-> buffer~` button spent a session below the fold,
  // where it could not be pressed and did not look missing. So: no hint text, no
  // spare rows, short labels. doc/TODO.md has the procedure and the Max console
  // has the findings; this UI only has to be pressable.
  return (
    <Frame title="SPIKE" device={device}>
      <dt>1.1 set</dt>
      <dd className="row">
        <button onClick={() => outlet(OUT.set_param, Math.random())}>set</button>
        <button onClick={() => outlet(OUT.raw_param, Math.random())}>raw</button>
        <span>
          echoes <strong>{echoes}</strong>
          {lastEcho !== null && ` (${lastEcho.toFixed(3)})`}
        </span>
      </dd>

      <dt>1.2 buffer~</dt>
      <dd className="row">
        <input value={bufferPath} onChange={(e) => setBufferPath(e.target.value)} size={10} />
        <button onClick={() => outlet(OUT.buffer_load, bufferPath)} disabled={!bufferPath.trim()}>
          load
        </button>
        <button onClick={() => outlet(OUT.buffer_load, probePath)} disabled={!probePath} title={probePath}>
          .html
        </button>
        <span>{buffer ?? "-"}</span>
      </dd>

      <dt>1.3 maxurl</dt>
      <dd className="row">
        <input value={dlUrl} onChange={(e) => setDlUrl(e.target.value)} size={18} />
        <button onClick={() => outlet(OUT.url_download, dlUrl, ...(dlDest.trim() ? [dlDest.trim()] : []))} disabled={!dlUrl.trim()}>
          get
        </button>
        <button onClick={() => outlet(OUT.url_check, dlPath)} disabled={!dlPath} title={dlPath}>
          on disk?
        </button>
        {/* The end-to-end one: network -> disk -> decode -> audio, in one click. */}
        <button onClick={() => outlet(OUT.buffer_load, dlPath)} disabled={!dlPath}>
          -&gt; buffer~
        </button>
        <span>{dlBytes === null ? "-" : dlBytes > 0 ? `${dlBytes}B` : "NO FILE"}</span>
      </dd>

      {/* The destination, so an UNWRITABLE one can be asked for on purpose. The
          server saying no and the disk saying no want different handling, and
          until this field existed the spike could not tell them apart. Blank =
          the wrapper's default, next to the .amxd. */}
      <dt>dest</dt>
      <dd className="row">
        <input value={dlDest} onChange={(e) => setDlDest(e.target.value)} size={26} placeholder="blank = next to the .amxd" />
        <button onClick={() => setDlDest("C:/Windows/System32/nope.wav")}>unwritable</button>
        <span>{urlResult ?? "-"}</span>
      </dd>
    </Frame>
  );
}
