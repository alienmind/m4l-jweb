/**
 * protocol.ts (hello-audio) - every selector that crosses this device's bridge,
 * EXCEPT the ones the Surface owns.
 *
 * The cutoff is not here, and that is the point. A parameter declared in
 * `surface.ts` generates its own selectors on both sides - `cutoff` out of the
 * live.dial, `set_cutoff` back into it - and `useParam()` binds them. Naming them
 * again here would be a second source of truth for the same string, which is what
 * the Surface exists to delete. `tests/protocol.test.mjs` lints them from the
 * declaration.
 *
 * An audio effect has no MIDI ports at all, so the chain contract (CHAIN_IN /
 * CHAIN_OUT) is deliberately NOT spread in here. A `midinote` sent from this
 * device would match nothing, reach the wrapper and be swallowed in silence.
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
