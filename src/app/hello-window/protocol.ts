/**
 * protocol.ts (hello-window) - every selector that crosses this device's bridge.
 *
 * `window_testWindow_open` and `window_testWindow_close` are not here, for the
 * same reason a parameter is not: the window is declared in `surface.ts`, and the
 * build generates BOTH its [route] in the patcher and the selectors `useWindow()`
 * sends. One declaration, one name, both sides. `tests/protocol.test.mjs` lints
 * them from that declaration, so they carry the same guarantee with none of the
 * duplication.
 */
import { DEVICE_IN, STATE_OUT } from "@m4l-jweb/bridge";

/** Device -> UI. */
export const IN = {
  ...DEVICE_IN,
} as const;

/**
 * UI -> device. `STATE_OUT` (`get_state`/`sync_state`) is spread in because the
 * WINDOW now reads and writes the `note` slot - the same wrapper handlers the
 * device view would use, reached from the window through the tagged return path.
 */
export const OUT = {
  ...STATE_OUT,
  /** UI -> wrapper: page ready; send me the current state. */
  ui_ready: "ui_ready",
} as const;
