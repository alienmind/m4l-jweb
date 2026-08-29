/**
 * protocol.ts (push-snake) - the selectors crossing this device's bridge.
 *
 * Almost all of them are SPREAD, not typed: the pads' vocabulary belongs to
 * @m4l-jweb/bridge (`CONTROLS_IN` / `CONTROLS_OUT`) and the parameters are generated
 * from surface.ts, so this device names nothing of its own. That is the point - a
 * device that retyped `pad_pads` would have two sources of truth for one name, and a
 * typo in either produces no error at runtime, only a grid that never responds.
 *
 * Audio does not appear here at all: it leaves the page as a SIGNAL on [jweb~]'s
 * outlets, which is what the `webaudio` chain is for.
 */
import { CONTROLS_IN, CONTROLS_OUT, DEVICE_IN, SHELL_OUT, STATE_OUT } from "@m4l-jweb/bridge";

/** Device -> UI. */
export const IN = {
  ...DEVICE_IN,
  ...CONTROLS_IN,
} as const;

/** UI -> device. */
export const OUT = {
  /** UI -> wrapper: page ready; send me the current state. */
  ui_ready: "ui_ready",
  ...CONTROLS_OUT,
  ...STATE_OUT,
  // The music credit opens the original track in a real browser.
  ...SHELL_OUT,
} as const;
