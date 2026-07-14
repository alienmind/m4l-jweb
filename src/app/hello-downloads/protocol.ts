/**
 * protocol.ts (hello-downloads) - every selector that crosses this device's bridge.
 *
 * The `download` chain owns all four of them, so they are SPREAD in from the
 * library rather than retyped: `fetch_to_file` out, and `fetch_done` /
 * `fetch_error` / `fetch_progress` back. `fetchToFile()` in @m4l-jweb/bridge is
 * the promise-shaped wrapper around exactly this exchange - the app never types a
 * selector at all.
 *
 * Spreading CHAIN_OUT also brings in `midinote` and `flush`, which an audio effect
 * has no ports for. Take only the names this device's chains actually route: an
 * unrouted selector is a message falling on the floor, and the lint below is the
 * only thing that would ever say so.
 */
import { CHAIN_IN, CHAIN_OUT, DEVICE_IN } from "@m4l-jweb/bridge";

/** Device -> UI. */
export const IN = {
  ...DEVICE_IN,
  fetch_done: CHAIN_IN.fetch_done,
  fetch_error: CHAIN_IN.fetch_error,
  fetch_progress: CHAIN_IN.fetch_progress,
} as const;

/** UI -> device. */
export const OUT = {
  fetch_to_file: CHAIN_OUT.fetch_to_file,
  /** UI -> wrapper: page ready; send me the current state. */
  ui_ready: "ui_ready",
  /**
   * The Max conformance check - `wrapper/device.ts`. Asserts, in Live, the Max
   * behaviours `fetchToFile()` depends on and the unit tests CANNOT verify (they run
   * against a fake Max built from those very assumptions). Run it after a Live or Max
   * update; the results go to the Max console.
   */
  max_conformance: "max_conformance",
} as const;
