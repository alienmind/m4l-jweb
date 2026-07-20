/**
 * protocol.ts (hello-instrument) - every selector crossing this device's bridge.
 *
 * Two chains own them: `instrument` (buffer_load / voice_play, and buffer_ready back)
 * and `download` (fetch_to_file and its replies). `loadSample()`, `playVoice()` and
 * `fetchToFile()` in @m4l-jweb/bridge wrap the exchanges; the app types no selector.
 *
 * CHAIN_OUT is not spread wholesale - it also carries `midinote`/`buffer_play`, which
 * belong to chains this device does not have. An unrouted selector falls on the floor
 * silently, and the protocol lint is what catches it, so declare only what this
 * device's Max side actually routes.
 */
import { DEVICE_IN } from "@m4l-jweb/bridge";

/** Device -> UI. */
export const IN = {
  ...DEVICE_IN,
} as const;

/** UI -> device. */
export const OUT = {
  /** UI -> wrapper: page ready; send me the current state. */
  ui_ready: "ui_ready",
} as const;
