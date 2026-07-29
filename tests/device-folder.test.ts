/**
 * @vitest-environment happy-dom
 *
 * device-folder.test.ts - the ordering that makes a ui_ready reply arrive at all.
 *
 * `device_folder` is a ONE-SHOT: the wrapper sends it inside ui_ready and never
 * repeats it. So a page that binds it in a later effect than the one calling
 * `uiReady()` misses its only message and shows "unknown" forever, with nothing in
 * the console to say so - the wrapper did its half. That shipped once.
 *
 * The fix is that `uiReady()` binds the selector itself, so the ordering is not
 * something a device can get wrong. These tests pin that, not the folder value.
 *
 * The bridge keeps the binding and the last folder in MODULE state, so every test
 * re-imports it fresh.
 */
import { afterEach, expect, test, vi } from "vitest";

type Logged = { call: "bindInlet" | "outlet"; name: string };

/**
 * A [jweb] view that records the ORDER of what the bridge does to it. Installed
 * before the import, because `inJweb` is read once at module load.
 */
const enterJweb = () => {
  const log: Logged[] = [];
  (window as unknown as { max: unknown }).max = {
    bindInlet: (name: string) => log.push({ call: "bindInlet", name }),
    outlet: (...args: unknown[]) => log.push({ call: "outlet", name: String(args[0]) }),
  };
  return log;
};

/** A fresh bridge - `folderBound` and the cached folder are module-level. */
const freshBridge = async () => {
  vi.resetModules();
  return await import("@m4l-jweb/bridge");
};

afterEach(() => {
  delete (window as unknown as { max?: unknown }).max;
});

test("uiReady binds device_folder BEFORE it announces, so the reply has a handler", async () => {
  const log = enterJweb();
  const { uiReady } = await freshBridge();

  uiReady();

  const bind = log.findIndex((e) => e.call === "bindInlet" && e.name === "device_folder");
  const ready = log.findIndex((e) => e.call === "outlet" && e.name === "ui_ready");
  expect(bind).toBeGreaterThanOrEqual(0);
  expect(bind).toBeLessThan(ready);
});

test("a subscriber that arrives after the reply still gets the folder", async () => {
  enterJweb();
  const { onDeviceFolder, simulate, uiReady } = await freshBridge();

  // The device's own effect order: announce, the wrapper answers, and only then
  // does the component that wants the path mount.
  uiReady();
  simulate("device_folder", "C:/Music/Ableton/User Library/Max For Live/m4l-jweb");

  const seen: string[] = [];
  onDeviceFolder((f) => seen.push(f));
  expect(seen).toEqual(["C:/Music/Ableton/User Library/Max For Live/m4l-jweb"]);
});

test("subscribing before ui_ready works the same - one binding, every subscriber", async () => {
  enterJweb();
  const { onDeviceFolder, simulate, uiReady } = await freshBridge();

  const early: string[] = [];
  const late: string[] = [];
  onDeviceFolder((f) => early.push(f));
  uiReady();
  onDeviceFolder((f) => late.push(f));
  simulate("device_folder", "/Users/x/Music/Ableton/User Library/Max For Live/m4l-jweb");

  expect(early).toEqual(["/Users/x/Music/Ableton/User Library/Max For Live/m4l-jweb"]);
  // The late one got the cached value on subscribe, and the message on top of it.
  expect(late.at(-1)).toBe("/Users/x/Music/Ableton/User Library/Max For Live/m4l-jweb");
});

test("unsubscribing leaves the binding in place for the others", async () => {
  enterJweb();
  const { onDeviceFolder, simulate, uiReady } = await freshBridge();

  const kept: string[] = [];
  const dropped: string[] = [];
  const off = onDeviceFolder((f) => dropped.push(f));
  onDeviceFolder((f) => kept.push(f));
  uiReady();
  off();
  simulate("device_folder", "/tmp/device");

  expect(dropped).toEqual([]);
  expect(kept).toEqual(["/tmp/device"]);
});
