/**
 * protocol.ts (hello-remote) - the selectors this device's bridge uses, minus the
 * ones the Surface owns (`target` / `set_target` are generated from surface.ts and
 * linted from there, so they are deliberately absent).
 *
 * The rest is the modulation path: `remote_bind` / `remote_val` are the `remote`
 * chain's, and `get_param_id` / `param_id` are the wrapper's LOM-id lookup. `bindRemote`,
 * `writeRemote` and `resolveParamId` in @m4l-jweb/bridge are the shaped API over them.
 */
import { CHAIN_OUT, DEVICE_IN, PARAM_IN, PARAM_OUT } from "@m4l-jweb/bridge";

/** Device -> UI. */
export const IN = {
  ...DEVICE_IN,
  ...PARAM_IN,
} as const;

/** UI -> device. */
export const OUT = {
  remote_bind: CHAIN_OUT.remote_bind,
  remote_val: CHAIN_OUT.remote_val,
  get_param_id: PARAM_OUT.get_param_id,
  /** UI -> wrapper: page ready; send me the current state. */
  ui_ready: "ui_ready",
} as const;
