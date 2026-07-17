/**
 * protocol.ts (hello-clip) - the selectors that cross this device's bridge.
 *
 * All four are WRAPPER-owned clip I/O (`read_notes`/`write_clip` out, `notes`/
 * `read_error` back), spread in from the library rather than retyped. `readClip()`
 * and `writeClip()` in @m4l-jweb/bridge are the shaped wrappers - the app never types
 * a selector.
 *
 * These reach `[js]` because the manifest declares `unmatchedTo: "js"`: no chain
 * routes them, so the bare selector has to fall through to the wrapper.
 */
import { CLIP_IN, CLIP_OUT, DEVICE_IN } from "@m4l-jweb/bridge";

/** Device -> UI. */
export const IN = {
  ...DEVICE_IN,
  ...CLIP_IN,
} as const;

/** UI -> device. */
export const OUT = {
  ...CLIP_OUT,
  /** UI -> wrapper: page ready; send me the current state. */
  ui_ready: "ui_ready",
} as const;
