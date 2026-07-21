/**
 * protocol.ts (hello-synth) - the selectors this device's chains route.
 *
 * The handshake, plus MIDI IN. `notein` arrives from the `midiin` chain and is what
 * `onNote`/`onNoteOff` bind to; the app types neither name. Audio does not appear here
 * at all - it leaves the page as a SIGNAL on [jweb~]'s outlets 0 and 1, which is the
 * whole point of the `webaudio` chain. This file exists so the codegen lint can see
 * the device's surface of selectors.
 */
import { CHAIN_IN, DEVICE_IN } from "@m4l-jweb/bridge";

/** Device -> UI. */
export const IN = {
  ...DEVICE_IN,
  /** midiin -> UI: `notein <pitch> <velocity>`; velocity 0 is a release. */
  notein: CHAIN_IN.notein,
} as const;

/** UI -> device. */
export const OUT = {
  /** UI -> wrapper: page ready; send me the current state. */
  ui_ready: "ui_ready",
} as const;
