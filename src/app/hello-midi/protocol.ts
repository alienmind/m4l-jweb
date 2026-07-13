/**
 * protocol.ts (hello-midi) - every selector that crosses this device's bridge,
 * EXCEPT the ones the Surface owns.
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
 * never sounded.
 *
 * The PARAMETERS are not here either. `density` and `rate` are declared in
 * surface.ts, which generates their Max objects AND their selectors in both
 * directions - `<id>` coming out of the live.dial, `set_<id>` going back into it.
 * `useParam()` binds them, and the lint checks them from the declaration, so they
 * carry the same guarantee with none of the duplication.
 *
 * What is left below is what is genuinely this device's own.
 */
import { CHAIN_IN, CHAIN_OUT, DEVICE_IN } from "@m4l-jweb/bridge";

/** Device -> UI. */
export const IN = {
  ...DEVICE_IN,
  ...CHAIN_IN,
} as const;

/** UI -> device. */
export const OUT = {
  ...CHAIN_OUT,
  /** UI -> wrapper: page ready; send me the current state. */
  ui_ready: "ui_ready",
} as const;
