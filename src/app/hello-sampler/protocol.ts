/**
 * protocol.ts (hello-sampler) - every selector that crosses this device's bridge.
 *
 * Only the handshake, because sampling no longer crosses the bridge at all: the page
 * fetches and decodes the audio itself and plays it through the `webaudio` chain's
 * signal path. The `samples` chain (buffer_load / buffer_play / buffer_stop) that used
 * to own these selectors was removed in 0.9.9, along with the [buffer~] it drove.
 *
 * CHAIN_OUT is not spread wholesale: it carries `midinote` and `flush`, which belong to
 * `midiout`, a chain this device does not have. An unrouted selector is a message
 * falling on the floor, silently, and the protocol lint is the only thing that would
 * ever say so - so declare only what this device's Max side actually routes.
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
