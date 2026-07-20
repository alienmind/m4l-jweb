/**
 * protocol.ts (hello-render) - the selectors this device's chains route.
 *
 * The `renderplay` and `download` chains own the render_* and save_* selectors; the
 * promise/callback wrappers in @m4l-jweb/bridge (`saveToFile`, `renderLoad`, `renderArm`,
 * `renderStop`, `onRenderReady`) type them, so the app never spells one. This file exists
 * so the codegen lint can see the device's surface of selectors.
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
