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
 * 0-1 -> 40 Hz..18 kHz. The SAME curve the `lowpass` chain applies in the
 * patcher (`expr 40. * pow(450., $f1)`) - if these two ever disagree, the readout
 * is lying about what you are hearing.
 *
 * It is logarithmic because pitch is: a linear sweep would spend nearly all its
 * travel in the top octave, where you hear nothing happening.
 */
const toHz = (v: number) => 40 * Math.pow(450, v);

export default function HelloAudio() {
  const [cutoff, setCutoff] = useState(1);
  const device = useDevice();

  useEffect(() => {
    // The parameter's value coming back: a knob turn, an automation lane, or a
    // Push encoder. The slider follows all three.
    bindInlet(IN.cutoff, (c) => setCutoff(Number(c)));
  }, []);

  const hz = toHz(cutoff);

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
            value={cutoff}
            onChange={(e) => {
              const v = Number(e.target.value);
              setCutoff(v); // optimistic - do not wait for Live to echo it back
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
