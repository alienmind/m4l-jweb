import { useEffect, useRef, useState } from "react";
import { saveToFile, renderLoad, renderArm, renderStop, renderSync, onRenderReady } from "@m4l-jweb/bridge";
import { useDevice } from "../shared/device";
import { Frame } from "../shared/Frame";

/**
 * hello-render - the proving ground for the SUPERDOUGH Rendering pipe.
 *
 * S2 (saveToFile): a sine-beep WAV is generated in the browser and written to disk next
 * to the .amxd - bytes cross to disk without touching the message bridge, via the same
 * [maxurl] atomic place the download chain owns. The status shows the verified byte count.
 *
 * S3 (renderplay): the two beeps load into slots rndA/rndB and loop, SELF-CLOCKED off the
 * groove's own sync (not the host transport). Arm A/B crossfades between them at the next
 * loop boundary; Stop fades out and holds. No transport needed - it plays on load.
 *
 * S3b (transport sync): the proof that the loop can be TRANSPORT-LOCKED. `render_sync`
 * relocates each groove to Live's exact transport phase. We align ONCE - on transport
 * start and on a relocate - then rate-1 @loop holds the lock (Live's transport and the
 * 120 BPM WAV share one clock). We deliberately do NOT re-sync every tick: a per-loop
 * re-sync is what caused the boundary click in the self-clock era. Freeze/flatten the
 * track at 120 BPM and the beep must land in the pocket, bar-locked.
 */

const SAMPLE_RATE = 44100;
const LOOP_BEATS = 4;
const LOOP_SECONDS = 2; // 4 beats at 120 BPM (the sync math below assumes this tempo)

/**
 * A STEREO sine, exactly a whole number of cycles long, as a 16-bit PCM WAV.
 *
 * Stereo so both ears sound - a mono file drives only groove~'s left outlet. A WHOLE
 * number of cycles so the last sample joins the first with no discontinuity: the loop is
 * seamless with no end fade (a fade would put a few ms of silence at every seam). The
 * length is rounded to the nearest whole cycle near LOOP_SECONDS.
 */
function sineWav(freq: number, seconds = LOOP_SECONDS, sampleRate = SAMPLE_RATE): ArrayBuffer {
  const cycles = Math.max(1, Math.round(freq * seconds));
  const frames = Math.round((cycles * sampleRate) / freq); // whole cycles => seamless loop
  const bytesPerFrame = 4; // stereo, 16-bit
  const buffer = new ArrayBuffer(44 + frames * bytesPerFrame);
  const view = new DataView(buffer);
  const str = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  view.setUint32(4, 36 + frames * bytesPerFrame, true);
  str(8, "WAVE");
  str(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 2, true); // stereo
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerFrame, true);
  view.setUint16(32, bytesPerFrame, true);
  view.setUint16(34, 16, true);
  str(36, "data");
  view.setUint32(40, frames * bytesPerFrame, true);
  for (let i = 0; i < frames; i++) {
    const s = Math.sin((2 * Math.PI * cycles * i) / frames) * 0.6;
    const q = Math.max(-1, Math.min(1, s)) * 0x7fff;
    view.setInt16(44 + i * 4, q, true); // L
    view.setInt16(44 + i * 4 + 2, q, true); // R
  }
  return buffer;
}

// Device-folder ROOT, no subdirectory: neither Max's [js] File nor [maxurl] creates
// intermediate directories, so `render/rndA.wav` would write the .part but fail the atomic
// place (maxurl cannot make the folder). The download chain writes to the root too.
const SLOTS = {
  rndA: { freq: 440, file: "hello-render-rndA.wav" },
  rndB: { freq: 660, file: "hello-render-rndB.wav" },
} as const;
type Slot = keyof typeof SLOTS;

/** The transport phase of `beats` as a groove play position in ms (see LOOP_SECONDS note). */
function phaseMs(beats: number): number {
  const phase = ((beats % LOOP_BEATS) + LOOP_BEATS) % LOOP_BEATS; // 0..LOOP_BEATS, guard negatives
  return (phase / LOOP_BEATS) * LOOP_SECONDS * 1000;
}

export default function HelloRender() {
  const [status, setStatus] = useState("Idle. Generate a beep to hear it loop.");
  const [loaded, setLoaded] = useState<Record<Slot, boolean>>({ rndA: false, rndB: false });

  // Align-once state: remember the last transport reading to detect start / relocate.
  const prevPlaying = useRef(false);
  const prevBeats = useRef(0);

  // ALIGN ONCE, then let @loop hold. Sync both slots (they stay mutually phase-aligned) on
  // the transport START edge and on a RELOCATE (a beat jump the 20 Hz poll cannot explain by
  // normal advance). Not every tick - that would fight the loop and reintroduce the click.
  function onTick(playing: boolean, beats: number) {
    const started = playing && !prevPlaying.current;
    // Normal advance between 50 ms polls is small (0.1 beat at 120 BPM); anything past half a
    // beat is a jump (relocate, or wrap on a looping arrangement). Backward is always a jump.
    const jumped = playing && Math.abs(beats - prevBeats.current) > 0.5;
    if (started || jumped) {
      const pos = phaseMs(beats);
      renderSync("rndA", pos);
      renderSync("rndB", pos);
      setStatus(`Transport ${started ? "start" : "relocate"} @ ${beats.toFixed(2)} beats: synced to ${pos.toFixed(0)} ms.`);
    }
    prevPlaying.current = playing;
    prevBeats.current = beats;
  }

  const device = useDevice(onTick);

  useEffect(() => {
    onRenderReady((slot) => {
      setLoaded((l) => ({ ...l, [slot]: true }));
      setStatus(`Slot ${slot} loaded and looping-ready. Arm it, then run the transport to lock it.`);
    });
  }, []);

  async function generate(slot: Slot) {
    const { freq, file } = SLOTS[slot];
    setStatus(`Generating ${freq} Hz beep for ${slot}...`);
    try {
      const wav = sineWav(freq);
      const { bytes } = await saveToFile(file, wav);
      setStatus(`Saved ${bytes} bytes to ${file}. Loading into ${slot}...`);
      renderLoad(slot, file, LOOP_BEATS);
    } catch (err) {
      setStatus(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return (
    <Frame title="HELLO RENDER" device={device}>
      <dt>Slot A (440 Hz)</dt>
      <dd>
        <button onClick={() => generate("rndA")} style={{ padding: "4px 8px" }}>
          Generate + save + load
        </button>{" "}
        <button onClick={() => renderArm("rndA")} disabled={!loaded.rndA} style={{ padding: "4px 8px" }}>
          Arm A
        </button>
      </dd>
      <dt>Slot B (660 Hz)</dt>
      <dd>
        <button onClick={() => generate("rndB")} style={{ padding: "4px 8px" }}>
          Generate + save + load
        </button>{" "}
        <button onClick={() => renderArm("rndB")} disabled={!loaded.rndB} style={{ padding: "4px 8px" }}>
          Arm B
        </button>
      </dd>
      <dt>Transport</dt>
      <dd>
        {device.playing ? "playing" : "stopped"} @ {device.beats.toFixed(2)} beats
        {" "}
        <button
          onClick={() => {
            const pos = phaseMs(device.beats);
            renderSync("rndA", pos);
            renderSync("rndB", pos);
            setStatus(`Manual re-sync @ ${device.beats.toFixed(2)} beats: ${pos.toFixed(0)} ms.`);
          }}
          style={{ padding: "4px 8px" }}
        >
          Re-sync now
        </button>{" "}
        <button onClick={() => renderStop()} style={{ padding: "4px 8px" }}>
          Stop (fade out)
        </button>
      </dd>
      <dt>Status</dt>
      <dd>{status}</dd>
    </Frame>
  );
}
