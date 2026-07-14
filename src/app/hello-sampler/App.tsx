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
 */
export default function HelloSampler() {
  const device = useDevice();
  const [status, setStatus] = useState("Idle");
  const [loaded, setLoaded] = useState<LoadedSample | null>(null);

  // A relative path lands next to the .amxd, in the device's own folder - the one
  // place a device can always write, on both platforms.
  const FILE = "preview.wav";
  /**
   * A WAV, and that is not a preference: [buffer~]'s `read`/`replace` takes AIFF,
   * Next/Sun and WAV, per its reference page - and NOT MP3. (MP3, OGG, FLAC and M4A
   * are [sfplay~]'s list, which streams from disk instead of filling a buffer, so it
   * is a different chain and not this one.) A file it cannot read produces an error
   * in the Max console and no reply at all, which is what loadSample() times out on.
   *
   * `raw.githubusercontent.com`, not the `github.com/.../blob/...` page - that one
   * serves HTML, and an HTML file downloads perfectly and then fails to load as audio.
   * The sample is from tidal-drum-machines, which is where m4l-strudel's own samples
   * come from.
   */
  const URL = "https://raw.githubusercontent.com/geikha/tidal-drum-machines/main/machines/AJKPercusyn/ajkpercusyn-bd/Bassdrum.wav";

  async function fetchIt() {
    setLoaded(null);
    setStatus("Downloading...");
    try {
      const { bytes } = await fetchToFile(URL, FILE, (downloaded, total) =>
        setStatus(total > 0 ? `Downloading... ${downloaded} / ${total} bytes` : `Downloading... ${downloaded} bytes`),
      );
      setStatus(`Wrote ${bytes} bytes to ${FILE}. Now load it.`);
    } catch (err) {
      setStatus(`Download failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function load() {
    setStatus("Loading into [buffer~]...");
    try {
      // What comes back is what [info~] measured, not what we hoped for: `replace`
      // adopts the file's own channel count and sample rate.
      const s = await loadSample("preview", FILE);
      setLoaded(s);
      setStatus("Loaded.");
    } catch (err) {
      setStatus(`Load failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return (
    <Frame title="HELLO SAMPLER" device={device}>
      <dt>Sample</dt>
      <dd>
        <button onClick={fetchIt} style={{ padding: "4px 8px" }}>
          1. Fetch
        </button>{" "}
        <button onClick={load} style={{ padding: "4px 8px" }}>
          2. Load
        </button>{" "}
        <button onClick={() => playSample("preview")} disabled={!loaded} style={{ padding: "4px 8px" }}>
          3. Play
        </button>{" "}
        <button onClick={stopSample} disabled={!loaded} style={{ padding: "4px 8px" }}>
          Stop
        </button>
      </dd>
      <dt>Buffer</dt>
      <dd>
        {loaded
          ? `${Math.round(loaded.durationMs)} ms, ${loaded.channels} ch, ${loaded.sampleRate} Hz (${loaded.frames} frames)`
          : "empty - nothing has reported a completed read"}
      </dd>
      <dt>Status</dt>
      <dd>{status}</dd>
    </Frame>
  );
}
