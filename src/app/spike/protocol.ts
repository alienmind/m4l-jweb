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
  /** spike wrapper -> UI: whatever [maxurl] replied, verbatim, outlet index first. */
  url_result: "url_result",
  /** spike wrapper -> UI: where the download was told to land. */
  download_path: "download_path",
  /** spike wrapper -> UI: `url_check_result <bytes>` - 0 means no file at all. */
  url_check_result: "url_check_result",
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
  /**
   * UI -> spike wrapper: `url_download <url> [dest]`.
   *
   * The download-to-file form is a `dictionary` message, not flat words, so
   * url_send cannot express it. The wrapper builds the dict.
   */
  url_download: "url_download",
  /** UI -> spike wrapper: `url_check <path>` - is the file REALLY on disk? */
  url_check: "url_check",
} as const;
