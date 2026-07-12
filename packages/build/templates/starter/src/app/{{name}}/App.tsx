/**
 * {{name}} - a MIDI effect. It sits on a MIDI track before the instrument, and
 * transposes what you play up by an octave.
 *
 * Replace the body with your device. The bridge surface stays the same.
 *
 *   pnpm dev
 *
 * runs this in a browser with a mocked Live beside it: a transport, and a log of
 * every message crossing the bridge. No Live, no Max needed.
 */
import { useEffect, useRef, useState } from "react";
import { bindInlet, flushNotes, onNote, sendNote } from "@m4l-jweb/bridge";
import { useDevice } from "../shared/device";
import { Frame, Transport } from "../shared/Frame";
import { IN } from "./protocol";

export default function App() {
  const [density, setDensity] = useState(0.5);
  const [last, setLast] = useState<{ from: number; to: number } | null>(null);

  // The inlet handler is bound once, but it has to read the CURRENT parameter
  // value. A ref keeps it fresh without rebinding on every render - rebinding
  // would drop messages in the gap.
  const densityRef = useRef(0.5);
  densityRef.current = density;

  const device = useDevice((playing) => {
    // Called on every transport poll (20 Hz). A sequencer computes which notes
    // fall in this slice of musical time and sends each with a delayMs that
    // carries it to its true position; Max places it on the scheduler.
    if (!playing) flushNotes();
  });

  useEffect(() => {
    bindInlet(IN.density, (d) => setDensity(Number(d)));

    // Notes played into the device. onNote drops note-offs: makenote on the Max
    // side already owns the release.
    onNote((pitch, velocity) => {
      const up = Math.min(127, pitch + 12);
      sendNote({
        pitch: up,
        velocity: Math.round(velocity * (0.5 + densityRef.current / 2)),
        durationMs: 250,
      });
      setLast({ from: pitch, to: up });
    });
  }, []);

  return (
    <Frame title="{{name}}" device={device}>
      <dt>density</dt>
      <dd>{density.toFixed(2)} - turn the dial in Live, or automate it</dd>

      <dt>last note</dt>
      <dd>{last ? `${last.from} -> ${last.to}` : "play something"}</dd>

      <Transport device={device} />
    </Frame>
  );
}
