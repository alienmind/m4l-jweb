/**
 * headless.test.mjs - the target seam, and the claim it makes.
 *
 * The claim is narrow and worth stating exactly: a `target: "headless"` device
 * contains NO `[jweb]` object and NO HTML payload, and its logic is `[js]`. It does
 * not claim the shipped wrapper has no browser code in it - there is one wrapper for
 * every device in a repo, and it still carries `loadWebview` and the rest, inert, for
 * the devices that do have a page. What matters is that nothing instantiates Chromium,
 * and that is a property of the PATCHER and the payload, which is what is checked here.
 *
 * The rest is the seam itself: every chain reaches "the app" through `ctx.appIn`, and
 * that is `[jweb]` under one target and `[js]` under the other. If that substitution is
 * wrong, a device builds cleanly and then does nothing at all - a `[prepend notein]`
 * wired to a box that is not in the patcher, or a route claiming a stream nothing
 * feeds.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

import { composePatcher } from "@m4l-jweb/build";
import { deviceTarget, isHeadless } from "@m4l-jweb/build/target";
import { defineControls, defineSurface, dial, grid, toggle, window as windowSpec } from "@m4l-jweb/surface";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = JSON.parse(readFileSync(path.join(root, "packages/build/templates/starter/../base.json"), "utf8"));

const surface = () =>
  defineSurface({
    params: { rate: dial({ range: [1, 16], default: 6, unit: "Hz", short: "Rate" }) },
    layout: { native: { params: ["rate"] } },
  });

const headlessDevice = (extra = {}) => ({ name: "t", type: "midi", target: "headless", chains: ["midiout"], ...extra });

const boxIds = (p) => p.patcher.boxes.map(({ box: b }) => b.id);
const text = (p) => Object.fromEntries(p.patcher.boxes.map(({ box: b }) => [b.id, b.text]));
const cord = (p, a, b) => p.patcher.lines.some(({ patchline: l }) => l.source[0] === a && l.destination[0] === b);

/* ------------------------------------------------------------------ *
 * The default is unchanged
 * ------------------------------------------------------------------ */

test("a device with no `target` is a jweb device, exactly as before", () => {
  // The seam must be invisible to every device that existed before it. A default that
  // had to be written out is a default that some repo will get wrong.
  expect(deviceTarget({ name: "x" })).toBe("jweb");
  expect(isHeadless({ name: "x" })).toBe(false);

  const p = composePatcher(base, { name: "x", type: "midi", chains: ["midiin"], unmatchedTo: "js" }, surface());
  expect(boxIds(p)).toContain("obj-jweb");
  expect(cord(p, "obj-noteinmsg", "obj-jweb")).toBe(true);
});

test("an unknown target is refused, and the message names the known ones", () => {
  expect(() => deviceTarget({ name: "x", target: "wasm" })).toThrow(/known targets are jweb, headless/);
});

/* ------------------------------------------------------------------ *
 * The headless patcher
 * ------------------------------------------------------------------ */

test("a headless device has NO [jweb] and no cord that ever named one", () => {
  const p = composePatcher(base, headlessDevice(), surface());
  expect(boxIds(p)).not.toContain("obj-jweb");
  // Both of the template's cords go with the box. One left behind is a patchline to a
  // box that is not there, which Max opens without complaint and without wiring.
  expect(JSON.stringify(p.patcher)).not.toContain("jweb");
});

test("...and [js]'s own outlet is the head of the app's message stream", () => {
  const p = composePatcher(base, headlessDevice(), surface());
  // What a page would have sent across the bridge, the wrapper sends out of outlet 0 -
  // into the same [route midinote flush] a jweb device feeds.
  expect(text(p)["obj-route"]).toBe("route midinote flush");
  expect(cord(p, "obj-js", "obj-route")).toBe(true);
  // ...and the Surface is chained after it, as always: one route hands the next what
  // it did not match.
  expect(cord(p, "obj-route", "obj-surface-route")).toBe(true);
});

test("...the LAST route's unmatched outlet goes nowhere, because [js] is already the far end", () => {
  const p = composePatcher(base, headlessDevice(), surface());
  // Wiring it back into [js] would be a loop: every message the wrapper sent that
  // nothing routed would arrive back at anything(). Harmless and absurd.
  const tail = p.patcher.lines.filter(({ patchline: l }) => l.source[0] === "obj-surface-route" && l.destination[0] === "obj-js");
  expect(tail).toHaveLength(0);
});

test("a parameter reaches [js] and takes `set_` back", () => {
  const p = composePatcher(base, headlessDevice(), surface());
  // The SAME generated boxes a jweb device gets. Only the far end moved, which is the
  // whole of the port.
  expect(text(p)["obj-prepend-rate"]).toBe("prepend rate");
  expect(cord(p, "obj-prepend-rate", "obj-js")).toBe(true);
  expect(text(p)["obj-surface-route"]).toContain("set_rate");
});

test("a native layout is the whole device view, and needs no [jweb] to sit beside", () => {
  const p = composePatcher(base, headlessDevice(), surface());
  const rate = p.patcher.boxes.find(({ box: b }) => b.id === "obj-param-rate").box;
  expect(rate.presentation).toBe(1);
  expect(rate.presentation_rect).toBeDefined();
});

test("the midiin chain reaches [js] instead of the page, with no change of its own", () => {
  const p = composePatcher(base, headlessDevice({ chains: ["midiin", "midiout"] }), surface());
  expect(cord(p, "obj-noteinmsg", "obj-js")).toBe(true);
});

test("a declared TAKEOVER puts the pads' observer straight into [js]", () => {
  // doc/TODO.md item 3's first argument: the pad takeover never needed a browser. The
  // observer, the grab and the paint are LiveAPI, and the page was only ever the thing
  // reading the events.
  const controls = defineControls({ surface: "push", controls: { pads: grid({ role: "matrix", rows: 8, cols: 8 }) } });
  const s = defineSurface({ controls, params: { run: toggle({ default: false, short: "Run" }) } });
  const p = composePatcher(base, headlessDevice({ chains: [] }), s);
  expect(text(p)["obj-tk-obs-pads"]).toBe("live.observer value");
  expect(cord(p, "obj-tk-pad-pads", "obj-js")).toBe(true);
  expect(boxIds(p)).not.toContain("obj-jweb");
});

/* ------------------------------------------------------------------ *
 * What headless gives up, said out loud rather than built quietly wrong
 * ------------------------------------------------------------------ */

test("the webaudio chain is refused - its signal comes out of the page", () => {
  expect(() => composePatcher(base, headlessDevice({ type: "instrument", chains: ["webaudio"] }), surface())).toThrow(/has no page/);
});

test("a declared WINDOW is refused - a window is a second page", () => {
  const s = defineSurface({
    params: { rate: dial({ range: [1, 16], default: 6, short: "Rate" }) },
    windows: { editor: windowSpec({ title: "Editor", width: 400, height: 300, entry: "Window" }) },
  });
  expect(() => composePatcher(base, headlessDevice(), s)).toThrow(/no browser for/);
});

test("a `latency` is refused - there is no [jweb~] ring buffer to size", () => {
  expect(() => composePatcher(base, headlessDevice({ latency: 30 }), surface())).toThrow(/no \[jweb~\] to give a ring buffer to/);
});

/* ------------------------------------------------------------------ *
 * The artifact
 * ------------------------------------------------------------------ */

const built = path.join(root, "dist", "m4l-jweb", "hello-headless.amxd");

test.skipIf(!existsSync(built))("the shipped .amxd carries NO html payload", () => {
  const amxd = readFileSync(built);
  // The wrapper's own source still MENTIONS the payload variables - it is the code
  // that would read them, shared with every device in the repo. What must not be there
  // is the assignment, which is the quarter-megabyte of base64 HTML itself.
  expect(amxd.includes("var UI_PAYLOAD_B64 = [")).toBe(false);
  // ...and the device's own logic IS there, appended after the wrapper.
  expect(amxd.includes("function arpTick")).toBe(true);
  expect(amxd.includes("var HEADLESS = 1")).toBe(true);
});

test.skipIf(!existsSync(built) || !existsSync(path.join(root, "dist/m4l-jweb/hello-midi.amxd")))(
  "...and is a fraction of the size of the same device with a browser in it",
  () => {
    const headless = readFileSync(built).length;
    const withPage = readFileSync(path.join(root, "dist/m4l-jweb/hello-midi.amxd")).length;
    // Not a performance claim - a statement about what is inside. The difference IS
    // the bundle: a React page, inlined, base64'd.
    expect(headless).toBeLessThan(withPage / 2);
  },
);
