import { useState } from "react";
import { fetchToFile, loadSample, playSample, stopSample } from "@m4l-jweb/bridge";
import type { LoadedSample } from "@m4l-jweb/bridge";
import { useDevice } from "../shared/device";
import { Frame } from "../shared/Frame";

/**
 * The first device in this repo that MAKES a sound.
 *
 * Everything else here processes Live's audio (hello-audio) or moves messages
 * around. This one fetches a file to disk, reads it into a [buffer~], and plays it
 * through [groove~] into the track - which is the whole path a sample browser needs,
 * and the reason the browser cannot simply play the file itself: [jweb] has no signal
 * outlets, so audio a page plays goes straight to the OS output device, past the
 * track, the fader and the monitor cue. Downloading it first is not a detour; it is
 * the only route to audio Live can hear.
 *
 * It is an INSTRUMENT device (type: "instrument"), so it sits on a MIDI track and is
 * the source of that track's sound rather than a stage in someone else's signal path.
 *
 * TWO SLOTS, one STEREO and one MONO, so the mono-fold can be heard: `groove~ <buf> 2`
 * drives outlet 0 only for a mono file, so without the samples chain's [selector~]
 * gate a mono sample plays in one ear. Load the mono row and confirm it is centred.
 */

/**
 * `raw.githubusercontent.com`, not the `github.com/.../blob/...` page - that one
 * serves HTML, which downloads perfectly and then fails to load as audio. And a WAV,
 * not an MP3: [buffer~]'s `read`/`replace` takes AIFF/Next-Sun/WAV and NOT MP3.
 */
const SAMPLES = [
  {
    slot: "stereo",
    label: "Stereo",
    file: "stereo.wav",
    url: "https://raw.githubusercontent.com/geikha/tidal-drum-machines/main/machines/AJKPercusyn/ajkpercusyn-bd/Bassdrum.wav",
  },
  {
    slot: "mono",
    label: "Mono",
    file: "mono.wav",
    url: "https://raw.githubusercontent.com/Bubobubobubobubo/Dough-Juj/main/juj/PLE.wav",
  },
] as const;

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

function SampleRow({ slot, label, file, url }: { slot: string; label: string; file: string; url: string }) {
  const [status, setStatus] = useState("Idle");
  const [loaded, setLoaded] = useState<LoadedSample | null>(null);

  async function fetchIt() {
    setLoaded(null);
    setStatus("Downloading...");
    try {
      const { bytes } = await fetchToFile(url, file, (downloaded, total) =>
        setStatus(total > 0 ? `Downloading... ${downloaded} / ${total} bytes` : `Downloading... ${downloaded} bytes`),
      );
      setStatus(`Wrote ${bytes} bytes to ${file}. Now load it.`);
    } catch (err) {
      setStatus(`Download failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function load() {
    setStatus("Loading into [buffer~]...");
    try {
      // What comes back is what [info~] measured, not what we hoped for: `replace`
      // adopts the file's own channel count and sample rate. The `channels` shown
      // below is the ground truth for whether the fold is being exercised.
      const s = await loadSample(slot, file);
      setLoaded(s);
      setStatus(`Loaded ${s.channels === 1 ? "MONO" : `${s.channels} ch`}.`);
    } catch (err) {
      setStatus(`Load failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return (
    <>
      <dt>{label}</dt>
      <dd>
        <button onClick={fetchIt} style={{ padding: "4px 8px" }}>
          1. Fetch
        </button>{" "}
        <button onClick={load} style={{ padding: "4px 8px" }}>
          2. Load
        </button>{" "}
        <button onClick={() => playSample(slot)} disabled={!loaded} style={{ padding: "4px 8px" }}>
          3. Play
        </button>{" "}
        <button onClick={stopSample} disabled={!loaded} style={{ padding: "4px 8px" }}>
          Stop
        </button>
        <div style={{ marginTop: "2px", opacity: 0.75 }}>
          {loaded
            ? `${Math.round(loaded.durationMs)} ms, ${loaded.channels} ch, ${loaded.sampleRate} Hz (${loaded.frames} frames)`
            : status}
        </div>
      </dd>
    </>
  );
}
