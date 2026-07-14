/**
 * protocol.ts (hello-state) - every selector that crosses this device's bridge.
 *
 * The `config` slot is not named here, and that is the point: it is declared in
 * `surface.ts`, which generates its [dict] and [pattr] in the patcher AND its
 * inbound selector (`state_config`). `useStateSync()` binds it. Naming it again
 * here would be a second source of truth for one string.
 *
 * What IS here is the pair of selectors the WRAPPER handles - `get_state` and
 * `sync_state` - spread in from the library, because the id travels as an
 * ARGUMENT and the selector itself is fixed. It was `sync_state_<id>` for a while,
 * which Max looked up as a handler nobody has and swallowed in silence: every
 * write to the slot was dropped, and only the reads worked, so the state appeared
 * to load and never save. This lint is what would have caught it.
 */
import { DEVICE_IN, STATE_OUT } from "@m4l-jweb/bridge";

/** Device -> UI. */
export const IN = {
  ...DEVICE_IN,
} as const;

/** UI -> device. */
export const OUT = {
  ...STATE_OUT,
  /** UI -> wrapper: page ready; send me the current state. */
  ui_ready: "ui_ready",
} as const;
