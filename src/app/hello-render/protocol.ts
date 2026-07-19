/**
 * protocol.ts (hello-render) - the selectors this device's chains route.
 *
 * The `renderplay` and `download` chains own the render_* and save_* selectors; the
 * promise/callback wrappers in @m4l-jweb/bridge (`saveToFile`, `renderLoad`, `renderArm`,
 * `renderStop`, `onRenderReady`) type them, so the app never spells one. This file exists
 * so the codegen lint can see the device's surface of selectors.
 */
import { CHAIN_IN, CHAIN_OUT, DEVICE_IN } from "@m4l-jweb/bridge";

/** Device -> UI. */
export const IN = {
  ...DEVICE_IN,
  save_done: CHAIN_IN.save_done,
  save_error: CHAIN_IN.save_error,
  render_ready: CHAIN_IN.render_ready,
} as const;

/** UI -> device. */
export const OUT = {
  save_begin: CHAIN_OUT.save_begin,
  save_chunk: CHAIN_OUT.save_chunk,
  save_end: CHAIN_OUT.save_end,
  render_load: CHAIN_OUT.render_load,
  render_arm: CHAIN_OUT.render_arm,
  render_stop: CHAIN_OUT.render_stop,
  /** UI -> wrapper: page ready; send me the current state. */
  ui_ready: "ui_ready",
} as const;
