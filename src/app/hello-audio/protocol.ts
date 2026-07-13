/**
 * protocol.ts (hello-audio) - every selector that crosses this device's bridge.
 *
 * An audio effect has no MIDI ports at all, so the chain contract (CHAIN_IN /
 * CHAIN_OUT) is deliberately NOT spread in here. A `midinote` sent from this
 * device would match nothing, reach the wrapper and be swallowed in silence.
 */
import { DEVICE_IN } from "@m4l-jweb/bridge";

/** Device -> UI. */
export const IN = {
  ...DEVICE_IN,
  /**
   * live.dial -> UI: filter cutoff, 0-1.
   *
   * The dial is ALSO wired straight into the filter in the signal path. This copy
   * exists only so the UI can DISPLAY it: the audio does not depend on the
   * browser being alive, or keeping up. Audio is Max's job; the app is a view.
   */
  cutoff: "cutoff",
} as const;

/** UI -> device. */
export const OUT = {
  /** UI -> wrapper: page ready; send me the current state. */
  ui_ready: "ui_ready",
  /**
   * UI -> the cutoff parameter: `set_cutoff <0-1>` WRITES the live.dial.
   *
   * Not a message to the app's own state - a write to a real Live parameter. The
   * slider in the device window, the dial, the automation lane and the filter are
   * one control with several faces. The `set_<id>` route is generated from
   * surface.ts, for every declared parameter; naming it here is what Stage 2.2
   * (the generated protocol) will remove.
   */
  set_cutoff: "set_cutoff",
} as const;
