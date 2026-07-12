/**
 * protocol.ts (hello-midi) - every selector that crosses this device's bridge.
 *
 * The single source of truth for BOTH sides: the app binds/emits these, and the
 * generated patcher routes them. `tests/protocol.test.mjs` fails if a selector
 * here is not sent, handled or routed on the Max side - an unrouted selector is
 * a message falling on the floor, and it produces no error at runtime.
 *
 * Most of this file is SPREADS, not declarations, and that is the point:
 *
 *   DEVICE_IN  what the wrapper sends every device (mode, build, tick, tempo)
 *   CHAIN_IN   what the `midiin` chain sends (notein)
 *   CHAIN_OUT  what the `midiout` chain takes (midinote, flush)
 *
 * Those names belong to the library, so they come FROM the library. Retyping
 * them per device meant a typo produced no error anywhere - just a note that
 * never sounded. What is left below is what is genuinely this device's own.
 */
import { CHAIN_IN, CHAIN_OUT, DEVICE_IN } from "@m4l-jweb/bridge";

/** Device -> UI. */
export const IN = {
  ...DEVICE_IN,
  ...CHAIN_IN,
  /** live.dial -> UI: velocity of the pulse, 0-1. A parameter is just a message. */
  density: "density",
  /** live.dial -> UI: pulse rate, as an INDEX into RATES (0 = off). */
  rate: "rate",
} as const;

/** UI -> device. */
export const OUT = {
  ...CHAIN_OUT,
  /** UI -> wrapper: page ready; send me the current state. */
  ui_ready: "ui_ready",
} as const;
