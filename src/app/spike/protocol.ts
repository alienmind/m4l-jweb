/**
 * protocol.ts (spike) - selectors for the Stage 1 spike device.
 *
 * Not a device: an instrument for answering the three questions in
 * doc/SPIKES.md. Delete this folder, patcher/chains.mjs, wrapper/device.ts and
 * the `spike` entry in patcher/devices.mjs once the answers are recorded.
 */
import { DEVICE_IN } from "@m4l-jweb/bridge";

/** Device -> UI. */
export const IN = {
  ...DEVICE_IN,
  /** spike chain -> UI: the live.dial produced output. Its ARRIVAL is the finding. */
  dial_out: "dial_out",
  /** spike wrapper -> UI: `buffer_result <frames> <channels> <midsample>`. */
  buffer_result: "buffer_result",
  /** spike wrapper -> UI: a real path on disk to feed buffer~. */
  probe_path: "probe_path",
  /** spike wrapper -> UI: whatever [maxurl] replied, verbatim. */
  url_result: "url_result",
} as const;

/** UI -> device. */
export const OUT = {
  ui_ready: "ui_ready",
  /** UI -> spike chain: `set_param <v>` - the set-WITHOUT-output path under test. */
  set_param: "set_param",
  /** UI -> spike chain: `raw_param <v>` - the control. This one definitely echoes. */
  raw_param: "raw_param",
  /** UI -> spike wrapper: `buffer_load <path>`. */
  buffer_load: "buffer_load",
  /** UI -> spike wrapper: ask for a real path that exists on disk. */
  buffer_probe_path: "buffer_probe_path",
  /** UI -> spike wrapper: raw words for [maxurl], unguessed. */
  url_send: "url_send",
} as const;
