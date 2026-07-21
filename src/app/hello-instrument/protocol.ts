/**
 * protocol.ts (hello-instrument) - every selector crossing this device's bridge.
 *
 * Almost nothing, and that is the point: the device makes sound with the `webaudio`
 * chain, which carries AUDIO on [jweb~]'s signal outlets rather than messages. Sample
 * loading and voice triggering happen entirely in the page (fetch + decodeAudioData +
 * AudioBufferSourceNode), so the `buffer_load`/`voice_play` exchange this device used
 * to need does not exist any more.
 *
 * What DOES still cross as a message is MIDI IN: `notein` from the `midiin` chain,
 * which `onNote` binds - that is how a MIDI device in front of this one plays it.
 *
 * CHAIN_OUT is deliberately not spread wholesale: it carries selectors belonging to
 * chains this device does not have. An unrouted selector falls on the floor silently,
 * and the protocol lint is what catches it, so declare only what this device's Max side
 * actually routes.
 */
import { CHAIN_IN, DEVICE_IN } from "@m4l-jweb/bridge";

/** Device -> UI. */
export const IN = {
  ...DEVICE_IN,
  /** midiin -> UI: `notein <pitch> <velocity>`. Note-ons only, here. */
  notein: CHAIN_IN.notein,
} as const;

/** UI -> device. */
export const OUT = {
  /** UI -> wrapper: page ready; send me the current state. */
  ui_ready: "ui_ready",
} as const;
