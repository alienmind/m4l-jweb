/**
 * hello-audio - an AUDIO EFFECT. It sits on an audio track, takes audio in and
 * gives audio out. A filter into a distortion into a level: sweep Cutoff and the
 * top end goes, push Drive and it dirties up, pull Gain and it quietens.
 *
 * THREE CHAINS, IN A SERIES THE MANIFEST SPELLS. `chains: ["lowpass", "drive",
 * "gain"]` in patcher/devices.mjs IS the signal path - the build creates the
 * device's plugin~/plugout~ and each chain claims one stage between them. Reorder
 * those three words and the device is rewired; nothing in this file changes, and no
 * patch cord is drawn by hand.
 *
 * That reordering is AUDIBLE, which is not a given: put `gain` before `drive` and a
 * quiet signal barely clips, put it after and the distortion happens at full level
 * and is then turned down. (Swapping `lowpass` and `gain` would sound identical -
 * both are linear, so they commute. Distortion is what makes the order real.)
 *
 * THE THING TO UNDERSTAND HERE: the audio never touches this app.
 *
 * Every one of those dials is wired straight into its signal object, in the patcher.
 * This React code neither sees nor carries a single sample, and if the browser
 * stalls the sound keeps working. What the app does is move a VALUE - and it moves
 * the real Live parameter, not a private copy of it, so the slider, the dial, the
 * automation lane and Push are one control with several faces.
 *
 * That is the general rule of this stack, not a quirk of this device: audio is
 * Max's job; the app decides *what* and *when*, and never carries samples.
 *
 *   pnpm dev:hello-audio
 */
import { useParam } from "@m4l-jweb/surface/react";
import { useDevice } from "../shared/device";
import { Frame, Transport } from "../shared/Frame";
import surface from "./surface";

/**
 * The cutoff crosses the bridge in HERTZ, because that is what the Live parameter
 * is: `range: [40, 18000]`, `unit: "Hz"` in surface.ts. The app, the automation
 * lane and Push all read the same number, and no conversion sits between them.
 *
 * The curve is still needed - HERE, and only for the slider's feel. Pitch is
 * logarithmic: a linear 40..18000 slider spends nearly all its travel in the top
 * octave, where a lowpass does nothing you can hear. So the slider's POSITION is
 * 0-1 and maps exponentially onto the Hz it sends. The Live dial does the same
 * thing with `exponent`, which is why the two knobs feel alike.
 */
const [MIN, MAX] = surface.params.cutoff.range;
const posToHz = (p: number) => MIN * Math.pow(MAX / MIN, p);
const hzToPos = (hz: number) => Math.log(hz / MIN) / Math.log(MAX / MIN);

export default function HelloAudio() {
  /**
   * A two-way binding to the REAL Live parameter, typed `number` from the
   * declaration. No selector appears in this file: `cutoff` and `set_cutoff` are
   * derived from surface.ts, the same place the Max objects come from.
   *
   * Reading it follows a knob turn, an automation lane and a Push encoder.
   * Writing it moves all three.
   */
  const [hz, setHz] = useParam(surface, "cutoff");
  const [drive, setDrive] = useParam(surface, "drive");
  const [gain, setGain] = useParam(surface, "gain");
  const device = useDevice();

  const fmt = (id: "drive" | "gain", v: number) => surface.params[id].format?.(v) ?? String(v);

  return (
    <Frame title="HELLO AUDIO" device={device}>
      <dt>cutoff</dt>
      <dd>
        <label className="slider">
          <input type="range" min={0} max={1} step={0.001} value={hzToPos(hz)} onChange={(e) => setHz(posToHz(Number(e.target.value)))} />
          <strong>{hz < 1000 ? `${hz.toFixed(0)} Hz` : `${(hz / 1000).toFixed(1)} kHz`}</strong>
        </label>
      </dd>

      {/* Drive and gain need no curve: their ranges are small and linear, so the
          slider position IS the value. Only the cutoff is logarithmic. */}
      <dt>drive</dt>
      <dd>
        <label className="slider">
          <input type="range" min={1} max={10} step={0.1} value={drive} onChange={(e) => setDrive(Number(e.target.value))} />
          <strong>{fmt("drive", drive)}</strong>
        </label>
      </dd>

      <dt>gain</dt>
      <dd>
        <label className="slider">
          <input type="range" min={0} max={2} step={0.01} value={gain} onChange={(e) => setGain(Number(e.target.value))} />
          <strong>{fmt("gain", gain)}</strong>
        </label>
      </dd>

      {/* Deliberately NOT naming the order. This app is shared by hello-audio and
          hello-audio-rev, which differ only in the order of their chains - so a page
          that claimed one would be lying in the other. The page cannot know: the
          signal path is the manifest's, and it never crosses the bridge. */}
      <dt>chain</dt>
      <dd>filter, drive and level - in the signal path, in the order patcher/devices.mjs lists them</dd>

      <Transport device={device} />
    </Frame>
  );
}
