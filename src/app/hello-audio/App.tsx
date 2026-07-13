/**
 * hello-audio - an AUDIO EFFECT. It sits on an audio track, takes audio in and
 * gives audio out. A lowpass filter: drag the Cutoff slider down and the top end
 * goes away.
 *
 * THE THING TO UNDERSTAND HERE: the audio never touches this app.
 *
 * The Cutoff dial is wired straight into the filter, in the patcher
 * (`plugin~ -> onepole~ -> plugout~`). This React code neither sees nor carries a
 * single sample, and if the browser stalls the sound keeps working. What the app
 * does is move a VALUE - and it moves the real Live parameter, not a private copy
 * of it, so the slider, the dial, the automation lane and Push are one control
 * with several faces.
 *
 * That is the general rule of this stack, not a quirk of this device: audio is
 * Max's job; the app decides *what* and *when*, and never carries samples.
 *
 *   pnpm dev:hello-audio
 */
import { useEffect, useState } from "react";
import { bindInlet, outlet } from "@m4l-jweb/bridge";
import { useDevice } from "../shared/device";
import { Frame, Transport } from "../shared/Frame";
import { IN, OUT } from "./protocol";

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
const MIN = 40;
const MAX = 18000;
const posToHz = (p: number) => MIN * Math.pow(MAX / MIN, p);
const hzToPos = (hz: number) => Math.log(hz / MIN) / Math.log(MAX / MIN);

export default function HelloAudio() {
  const [hz, setHz] = useState(MAX);
  const device = useDevice();

  useEffect(() => {
    // The parameter's value coming back, in Hz: a knob turn, an automation lane,
    // or a Push encoder. The slider follows all three.
    bindInlet(IN.cutoff, (c) => setHz(Number(c)));
  }, []);

  return (
    <Frame title="HELLO AUDIO" device={device}>
      <dt>cutoff</dt>
      <dd>
        <label className="slider">
          <input
            type="range"
            min={0}
            max={1}
            step={0.001}
            value={hzToPos(hz)}
            onChange={(e) => {
              const v = posToHz(Number(e.target.value));
              setHz(v); // optimistic - do not wait for Live to echo it back
              outlet(OUT.set_cutoff, v);
            }}
          />
          <strong>{hz < 1000 ? `${hz.toFixed(0)} Hz` : `${(hz / 1000).toFixed(1)} kHz`}</strong>
        </label>
      </dd>

      <dt>filter</dt>
      <dd>lowpass, 6 dB/oct - in the signal path, not in this page</dd>

      <Transport device={device} />
    </Frame>
  );
}
