/**
 * protocol.ts (hello-sampler) - every selector that crosses this device's bridge.
 *
 * Two chains own all of them, so they are spread/picked in from the library rather
 * than retyped: `samples` (buffer_load / buffer_play / buffer_stop, and buffer_ready
 * back) and `download` (fetch_to_file, and its three replies). `loadSample()` and
 * `fetchToFile()` in @m4l-jweb/bridge are the promise-shaped wrappers around exactly
 * those exchanges - the app types no selector at all.
 *
 * CHAIN_OUT is not spread wholesale: it also carries `midinote` and `flush`, which
 * belong to `midiout`, a chain this device does not have. An unrouted selector is a
 * message falling on the floor, silently, and the protocol lint is the only thing
 * that would ever say so - so declare only what this device's Max side actually routes.
 */
import { CHAIN_IN, CHAIN_OUT, DEVICE_IN } from "@m4l-jweb/bridge";

/** Device -> UI. */
export const IN = {
  ...DEVICE_IN,
  buffer_ready: CHAIN_IN.buffer_ready,
  fetch_done: CHAIN_IN.fetch_done,
  fetch_error: CHAIN_IN.fetch_error,
  fetch_progress: CHAIN_IN.fetch_progress,
} as const;

/** UI -> device. */
export const OUT = {
  buffer_load: CHAIN_OUT.buffer_load,
  buffer_play: CHAIN_OUT.buffer_play,
  buffer_stop: CHAIN_OUT.buffer_stop,
  fetch_to_file: CHAIN_OUT.fetch_to_file,
  /** UI -> wrapper: page ready; send me the current state. */
  ui_ready: "ui_ready",
} as const;
