/**
 * hello-midi - a MIDI EFFECT. It sits on a MIDI track, before the instrument,
 * and generates notes.
 *
 * A pulse generator: the Rate slider picks a note division (off, 1/4, 1/8, 1/16,
 * 1/32) and it plays C3 on every one of them.
 *
 * This is the pattern EVERY sequencer in this stack follows, and it is worth
 * understanding before you write your own. Live's transport reaches you at 20 Hz
 * - so each `tick` covers a SLICE of musical time, not an instant, and a pulse
 * almost never lands exactly on a poll. At 1/32 there are several pulses inside
 * one slice. So the app does not "play a note now": it finds every pulse in the
 * slice and sends each one with the DELAY that carries it to its true position.
 * [pipe] releases it there, on Max's scheduler.
 *
 * The app computes WHEN. Max places it. That is why the notes land tight even
 * though the clock driving them is coarse - and it is why your device never
 * touches a timer.
 *
 *   pnpm dev:hello-midi
 *
 * and press play in the mocked-Live harness on the left. No Live, no Max.
 */
import { useRef, useState } from "react";
import { flushNotes, onNote, sendNote } from "@m4l-jweb/bridge";
import { useParam } from "@m4l-jweb/surface/react";
import { useDevice } from "../shared/device";
import { Frame, Transport } from "../shared/Frame";
import { useEffect } from "react";
import surface, { RATES } from "./surface";
import DemoWorker from "../shared/worker.ts?worker&inline";

/**
 * C3. Ableton calls MIDI note 60 "C3" while most other software calls it C4 -
 * same note, different naming convention. 60 is what Live will show you.
 */
const C3 = 60;

/**
 * A rate label -> the division it means. `off` is 0: no pulse.
 *
 * The labels live in surface.ts, because they are the Live parameter's `options` -
 * which is what Push prints under the encoder. This device and the hardware read
 * the same list.
 */
const DIVISION: Record<(typeof RATES)[number], number> = { off: 0, "1/4": 4, "1/8": 8, "1/16": 16, "1/32": 32 };

/** A division, in beats. 4 (a quarter note) is 1 beat; 8 is half of one. */
const beatsPerPulse = (division: number) => 4 / division;

/** The Density parameter is a PERCENTAGE (Live prints "50 %"); MIDI velocity is 1-127. */
const toVelocity = (density: number) => Math.round(40 + (density / 100) * 87);

export default function HelloMidi() {
  /**
   * Both are REAL Live parameters, bound in both directions and typed from the
   * declaration: `rate` is one of the labels ("1/8"), not an index, and `density`
   * is a percentage.
   *
   * Both are also SHOWN below. A parameter the UI never renders is one the user
   * cannot tell from a broken one - they turn the Push encoder and nothing on
   * screen moves.
   */
  const [rate, setRate] = useParam(surface, "rate");
  const [density, setDensity] = useParam(surface, "density");
  const [notesSent, setNotesSent] = useState(0);
  const [lastIn, setLastIn] = useState<number | null>(null);
  const [workerTicks, setWorkerTicks] = useState(0);

  const division = DIVISION[rate] ?? 0;

  const worker = useRef<Worker | null>(null);

  // The tick handler must read the CURRENT parameters and the PREVIOUS tick's
  // position. A ref keeps them out of the binding without going stale.
  const state = useRef({ tempo: 120, density: 50, division: 0, lastBeat: -1 });
  state.current.density = density;
  state.current.division = division;

  const device = useDevice((playing, beat) => {
    const s = state.current;
    worker.current?.postMessage(["tick"]);
    if (device.tempo !== null) s.tempo = device.tempo;

    if (!playing || !s.division) {
      // Stop means stop. Notes are HELD by [makenote] on the Max side, so a UI
      // that simply stops sending leaves them sounding forever.
      if (s.lastBeat >= 0) flushNotes();
      s.lastBeat = -1;
      return;
    }
    // First tick after switching on: start here, do not fire for every pulse
    // since the set began.
    if (s.lastBeat < 0) s.lastBeat = beat;

    const step = beatsPerPulse(s.division);
    const msPerBeat = 60000 / s.tempo;
    let sent = 0;
    for (let at = Math.ceil(s.lastBeat / step) * step; at < beat; at += step) {
      sendNote({
        pitch: C3,
        // The Density dial is a real Live parameter, so this is also how you see
        // automation and Push reach the app: it scales how hard C3 hits.
        velocity: toVelocity(s.density),
        // Staccato, so pulses never overlap - at 1/32 they are 60 ms apart.
        durationMs: Math.max(20, Math.round(msPerBeat * step * 0.5)),
        delayMs: Math.max(0, Math.round((at - beat) * msPerBeat)),
      });
      sent++;
    }
    if (sent) setNotesSent((n) => n + sent);
    s.lastBeat = beat;
  });

  useEffect(() => {
    const w = new DemoWorker();
    w.onmessage = (e: MessageEvent) => {
      const [type, value] = e.data as [string, number];
      if (type === "ticks") setWorkerTicks(value);
    };
    worker.current = w;

    // Incoming MIDI, from the `midiin` chain. onNote drops note-offs for you:
    // [makenote] on the Max side already owns the release.
    onNote((pitch) => setLastIn(pitch));

    return () => w.terminate();
  }, []);

  function changeRate(next: (typeof RATES)[number]) {
    setRate(next); // writes the Live parameter, not just this component
    // Going to "off" mid-note would leave C3 sounding: the note-off is Max's to
    // send, and it only sends one for notes it still knows about.
    if (DIVISION[next] === 0) flushNotes();
  }

  /**
   * The free-running fallback: pulse even with Live's transport STOPPED.
   *
   * The tick loop only advances while Live plays - right for a musical device,
   * useless for a test one. Drop this on a track with the transport stopped, pull
   * the slider up, hear nothing, and you cannot tell "MIDI is broken" from "the
   * transport is not rolling" - the one question this device exists to answer.
   *
   * A plain browser timer is NOT sample-accurate. That is exactly what the
   * transport-locked path above is for, and why a real sequencer must use it. This
   * only proves the MIDI chain works end to end with nothing else running.
   */
  useEffect(() => {
    if (!division || device.playing) return;
    const stepMs = (60000 / (device.tempo ?? 120)) * beatsPerPulse(division);
    const fire = () => {
      sendNote({ pitch: C3, velocity: toVelocity(density), durationMs: Math.max(20, Math.round(stepMs * 0.5)) });
      setNotesSent((n) => n + 1);
    };
    fire(); // at once, so moving the slider is audible immediately
    const id = setInterval(fire, stepMs);
    return () => clearInterval(id);
  }, [division, device.playing, device.tempo, density]);

  return (
    <Frame title="HELLO MIDI" device={device}>
      <dt>rate</dt>
      <dd style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <label className="slider">
          {/* The slider steps through the parameter's own OPTIONS - the same list
              Push prints under its encoder, because both come from surface.ts. */}
          <input
            type="range"
            min={0}
            max={RATES.length - 1}
            step={1}
            value={Math.max(0, RATES.indexOf(rate))}
            onChange={(e) => changeRate(RATES[Number(e.target.value)])}
          />
          <strong>{rate}</strong>
        </label>
      </dd>

      <dt>density</dt>
      <dd style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <label className="slider">
          <input type="range" min={0} max={100} step={1} value={density} onChange={(e) => setDensity(Number(e.target.value))} />
          <strong>
            {Math.round(density)}% - vel {toVelocity(density)}
          </strong>
        </label>
      </dd>

      <dt>sent</dt>
      <dd>
        {notesSent} notes
        {division > 0 && (device.playing ? " - on the transport, in time" : " - free-running (press play for tight timing)")}
      </dd>

      <dt>note in</dt>
      <dd>{lastIn === null ? "-" : lastIn}</dd>

      <Transport device={device} />

      <dt>worker ticks</dt>
      <dd>{workerTicks}</dd>
    </Frame>
  );
}
