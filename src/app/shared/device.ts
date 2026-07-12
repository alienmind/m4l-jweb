/**
 * shared/device.ts - the part of a device that every device has.
 *
 * Whatever else it does, a device is told its run mode, its build stamp, Live's
 * tempo, and the transport position. Binding those four by hand in every app was
 * four chances to get the handshake wrong, so it lives here once.
 *
 * The selectors are NOT re-declared here: they come from @m4l-jweb/bridge's
 * DEVICE_IN, which each device spreads into its own protocol.ts. Same rule as
 * the chains - the name you bind and the name the wrapper sends come from one
 * definition.
 */
import { useEffect, useRef, useState } from "react";
import { DEVICE_IN, bindInlet, uiReady } from "@m4l-jweb/bridge";

declare const __APP_VERSION__: string;

export interface DeviceState {
  /** midi | audio | instrument | ... - the wrapper's object-box argument. */
  mode: string;
  /** The wrapper's build stamp, or null before it has replied. */
  build: string | null;
  /** Live's tempo in BPM, or null before the observer has fired. */
  tempo: number | null;
  playing: boolean;
  beats: number;
  /**
   * The wrapper and this page disagree about which build they are.
   *
   * Live embeds a COPY of a device in the set, so reinstalling does not update
   * instances already on tracks. Without this, a stale device looks like a bug in
   * your code rather than a stale device.
   */
  stale: boolean;
}

/** A transport poll. Return-value-free: send your notes from inside it. */
export type TickHandler = (playing: boolean, beats: number) => void;

/**
 * Bind the common inlets, announce `ui_ready`, and hand back the device's state.
 *
 * `onTick` is called on every transport poll (20 Hz). It is held in a ref and
 * called through it, so your handler always sees fresh props WITHOUT the inlet
 * being rebound on every render - rebinding would drop messages in the gap.
 */
export function useDevice(onTick?: TickHandler): DeviceState {
  const [mode, setMode] = useState("dev");
  const [build, setBuild] = useState<string | null>(null);
  const [tempo, setTempo] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [beats, setBeats] = useState(0);

  const tick = useRef<TickHandler | undefined>(onTick);
  tick.current = onTick;

  useEffect(() => {
    bindInlet(DEVICE_IN.mode, (m) => setMode(String(m)));
    bindInlet(DEVICE_IN.build, (b) => setBuild(String(b)));
    bindInlet(DEVICE_IN.tempo, (bpm) => setTempo(Number(bpm)));
    bindInlet(DEVICE_IN.tick, (isPlaying, position) => {
      const on = Number(isPlaying) === 1;
      const at = Number(position);
      setPlaying(on);
      setBeats(at);
      tick.current?.(on, at);
    });

    // The handshake. The page loads asynchronously, so anything the wrapper sent
    // before these handlers existed is simply gone: announce readiness and let it
    // resend. This is not optional.
    uiReady();
  }, []);

  // The stamp is "<version> <iso date>"; the page only bakes in the version.
  const stale = build !== null && build.split(" ")[0] !== __APP_VERSION__;

  return { mode, build, tempo, playing, beats, stale };
}
