/**
 * protocol.ts - every selector crossing this device's bridge.
 *
 * The single source of truth for both sides: the app binds/emits these, and the
 * generated patcher routes them. An unrouted selector produces no error at
 * runtime - the message just falls on the floor - so keep them here.
 *
 * Most of this is spreads, not declarations. Those names belong to the library:
 *
 *   DEVICE_IN   what the wrapper sends every device (mode, build, tick, tempo)
 *   CHAIN_IN    what the `midiin` chain sends (notein)
 *   CHAIN_OUT   what the `midiout` chain takes (midinote, flush)
 *
 * Spread them rather than retyping them, so a rename in the library is a type
 * error here instead of silence. What is left is what is genuinely yours.
 */
import { CHAIN_IN, CHAIN_OUT, DEVICE_IN } from "@m4l-jweb/bridge";

/** Device -> UI. */
export const IN = {
  ...DEVICE_IN,
  ...CHAIN_IN,
  /** live.dial -> UI: a parameter is just another message. */
  density: "density",
} as const;

/** UI -> device. */
export const OUT = {
  ...CHAIN_OUT,
  /** UI -> wrapper: page ready; send me the current state. */
  ui_ready: "ui_ready",
} as const;
