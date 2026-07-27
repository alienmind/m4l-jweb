/**
 * jweb-latency.test.ts - the ring buffer, on BOTH pages.
 *
 * `[jweb~]`'s `latency` is the buffer between Chromium's audio thread and MSP. At the
 * object default (~21 ms at 48 kHz) a sustained tone underruns within ~30 s - audible
 * dropouts, no error. `window({ audio: true, latency })` has carried it since 1.1.0.
 *
 * The DEVICE PAGE's own `[jweb~]` could not, and a device with both - a sounding
 * window and a sounding device view - therefore had one clean page and one that
 * chopped, from a setting that looked like it had been applied. One attribute, two
 * objects; this pins that both can have it.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { expect, test } from "vitest";

import { composePatcher } from "@m4l-jweb/build";
import { defineSurface, window as surfaceWindow } from "@m4l-jweb/surface";

const require = createRequire(import.meta.url);
const BASE = path.join(path.dirname(require.resolve("@m4l-jweb/build")), "..", "templates", "base.json");

interface Box {
  id: string;
  maxclass?: string;
  latency?: number;
  patcher?: { boxes: { box: Box }[] };
}

/** Every `[jweb~]` in the device, the device page's and any window's. */
function jwebBoxes(device: Record<string, unknown>, surface = defineSurface({ params: {} })) {
  const base = JSON.parse(readFileSync(BASE, "utf8"));
  const { patcher } = composePatcher(base, { name: "test", type: "instrument", chains: ["webaudio"], ...device }, surface);
  const found: Box[] = [];
  const walk = (boxes: { box: Box }[]) => {
    for (const { box } of boxes) {
      if (box.maxclass === "jweb~") found.push(box);
      if (box.patcher) walk(box.patcher.boxes);
    }
  };
  walk(patcher.boxes);
  return found;
}

test("no latency declared leaves the object's own default", () => {
  const [page] = jwebBoxes({});
  expect(page.maxclass).toBe("jweb~");
  // Absent, not zero: a written 0 would ASK for the minimum rather than accept the
  // default, and the two are not the same request.
  expect(page.latency).toBeUndefined();
});

test("a device's latency reaches the device page's own [jweb~]", () => {
  const [page] = jwebBoxes({ latency: 66 });
  expect(page.id).toBe("obj-jweb");
  expect(page.latency).toBe(66);
});

test("a sounding window and the device page can each carry their own", () => {
  const surface = defineSurface({
    params: {},
    windows: { studio: surfaceWindow({ title: "Studio", width: 400, height: 300, audio: true, latency: 66, entry: "Studio" }) },
  });
  const boxes = jwebBoxes({ latency: 66 }, surface);
  // Two pages make sound in this device, and BOTH were the bug when only one of them
  // could be given a buffer.
  expect(boxes).toHaveLength(2);
  expect(boxes.every((b) => b.latency === 66)).toBe(true);
});
