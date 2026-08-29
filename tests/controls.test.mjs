/**
 * controls.test.mjs - defineControls(), the pad store, and the takeover codegen.
 *
 * Three things are checked here and each of them fails SILENTLY in a device, which
 * is the only reason any of it is worth a test:
 *
 *   the declaration  a role outside the vocabulary, a grid whose shape does not
 *                    match the hardware, two keys claiming one control, an ENCODER
 *                    role. Each throws at declaration time, so `pnpm build` fails
 *                    rather than the hardware going quiet.
 *   the y flip       the hardware counts rows from the TOP and the API from the
 *                    BOTTOM. Get it wrong and every device on the grid is mirrored,
 *                    with nothing to report it - which is what the round trip below
 *                    is for: a cell painted at y = 0 must come back as a press at
 *                    y = 0.
 *   the patcher      the observer must reach [jweb] WITHOUT passing through [js],
 *                    and the takeover parameters must reach [js] without passing
 *                    through the page. Both are cords, and a missing cord in a
 *                    generated patcher is invisible.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

import { simulate, tapMessages } from "@m4l-jweb/bridge";
import {
  defineControls,
  defineSurface,
  dial,
  grid,
  padButton,
  padStream,
  paletteIndex,
  PUSH_PALETTE,
  REFUSED_ROLES,
  ROLE_NAMES,
  toggle,
} from "@m4l-jweb/surface";
import { padStore } from "@m4l-jweb/surface/pads";
import { composePatcher } from "@m4l-jweb/build";
import { controlsSpecBanner, withControlsChain } from "@m4l-jweb/build/controls";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = JSON.parse(readFileSync(path.join(root, "packages/build/templates/base.json"), "utf8"));

const pads = () => defineControls({ surface: "push", controls: { pads: grid({ role: "matrix", rows: 8, cols: 8 }) } });

/* ------------------------------------------------------------------ *
 * The declaration
 * ------------------------------------------------------------------ */

test("a declared grid carries its role's candidate NAMES, not a name the device typed", () => {
  // The device names a role; the library owns the per-generation name table. A name
  // Max looks up and does not recognise is not an error - it is a feature that
  // silently does nothing, which is the whole reason roles exist.
  const c = pads();
  expect(c.controls.pads.names).toContain("Button_Matrix");
  expect(c.keys).toEqual(["pads"]);
  expect(c.defaultFocus).toBe("Track");
});

test("a role outside the vocabulary throws, naming the vocabulary", () => {
  expect(() => defineControls({ surface: "push", controls: { x: padButton({ role: "teleport" }) } })).toThrow(/not in the vocabulary/);
});

test("a grid whose shape does not match the hardware throws", () => {
  expect(() => defineControls({ surface: "push", controls: { p: grid({ role: "matrix", rows: 4, cols: 8 }) } })).toThrow(
    /on this hardware it is 8x8/,
  );
});

test("two keys cannot claim one control", () => {
  expect(() =>
    defineControls({
      surface: "push",
      controls: { a: grid({ role: "matrix", rows: 8, cols: 8 }), b: grid({ role: "matrix", rows: 8, cols: 8 }) },
    }),
  ).toThrow(/cannot be grabbed twice/);
});

test("a key with whitespace throws - it becomes a selector Max would split", () => {
  expect(() => defineControls({ surface: "push", controls: { "my pads": grid({ role: "matrix", rows: 8, cols: 8 }) } })).toThrow(/whitespace/);
});

test("a role declared as the wrong KIND throws", () => {
  expect(() => defineControls({ surface: "push", controls: { j: padButton({ role: "jogwheel" }) } })).toThrow(/is a stream/);
  expect(() => defineControls({ surface: "push", controls: { s: padStream({ role: "shift" }) } })).toThrow(/is a button/);
  expect(() => defineControls({ surface: "push", controls: { m: padButton({ role: "matrix" }) } })).toThrow(/is a grid/);
});

test("the encoders are REFUSED, and the message says what grabbing one would cost", () => {
  // Measured: they ARE grabbable, and grabbing them takes them - the dials stop
  // moving their parameters at all. That is automation, MIDI mapping and the
  // automation lane, which is everything the parameter path exists for.
  //
  // No role in the vocabulary maps to them, so the refusal is unreachable through
  // the public API - it is a guard against the table growing one by accident. Check
  // the table itself rather than pretending to declare one.
  expect(Object.keys(REFUSED_ROLES)).toContain("Track_Controls");
  for (const names of Object.values(ROLE_NAMES)) {
    for (const n of names) expect(REFUSED_ROLES[n]).toBeUndefined();
  }
});

test("index 0 is OFF, and an unknown colour name is off rather than a guess", () => {
  // The one MEASURED entry in the palette: the top-left pad is the only dark one on
  // page 0. The rest are read off photographs and say so.
  expect(PUSH_PALETTE.black).toBe(0);
  expect(paletteIndex("black")).toBe(0);
  expect(paletteIndex("chartreuse")).toBe(0);
});

/* ------------------------------------------------------------------ *
 * The parameters the declaration contributes
 * ------------------------------------------------------------------ */

test("defineControls contributes takeover and focus as REAL parameters", () => {
  const s = defineSurface({ controls: pads(), params: { speed: dial({ range: [1, 16], default: 4, short: "Speed" }) } });
  expect(s.ids).toEqual(["speed", "takeover", "focus"]);
  // Off by default: a device that seizes the pads of every set it lands in is a
  // device people uninstall.
  expect(s.params.takeover.default).toBe(false);
  expect(s.params.focus.default).toBe("Track");
});

test("...and they land in a declared BANK, because Push shows nothing else", () => {
  const s = defineSurface({
    controls: pads(),
    params: {
      a: toggle({ default: false, short: "A" }),
      b: toggle({ default: false, short: "B" }),
    },
    banks: [{ name: "Main", params: ["a", "b"] }],
  });
  expect(s.banks[0].params).toEqual(["a", "b", "takeover", "focus"]);
});

test("...and get a page of their own when every declared bank is full", () => {
  const params = {};
  const full = [];
  for (let i = 0; i < 8; i++) {
    params[`p${i}`] = toggle({ default: false, short: `P${i}` });
    full.push(`p${i}`);
  }
  const s = defineSurface({ controls: pads(), params, banks: [{ name: "Main", params: full }] });
  expect(s.banks[1]).toEqual({ name: "Takeover", params: ["takeover", "focus"] });
});

test("a device may not declare a parameter defineControls generates", () => {
  expect(() => defineSurface({ controls: pads(), params: { takeover: toggle({ default: true, short: "T" }) } })).toThrow(/two dials and one name/);
});

/* ------------------------------------------------------------------ *
 * The pad store - the y flip and the frame diff
 * ------------------------------------------------------------------ */

/** Everything the app sent, as [selector, ...args]. */
function sent() {
  const out = [];
  const stop = tapMessages((m) => m.direction === "out" && out.push([m.selector, ...m.args]));
  return { out, stop };
}

test("draw() sends the whole grid ONCE, in hardware order with y from the TOP", () => {
  const store = padStore(pads());
  const { out, stop } = sent();

  store.draw("pads", (f) => {
    f.clear("black");
    f.set(0, 0, "green"); // BOTTOM-left in the API...
  });
  stop();

  expect(out).toHaveLength(1);
  const [selector, key, ...cells] = out[0];
  expect(selector).toBe("controls_frame");
  expect(key).toBe("pads");
  expect(cells).toHaveLength(64);
  // ...which is the LAST row on the wire. Get this backwards and every device on the
  // grid is mirrored vertically with nothing to report it.
  expect(cells[56]).toBe(PUSH_PALETTE.green);
  expect(cells[0]).toBe(0);
});

test("an unchanged frame does not cross the bridge at all", () => {
  const store = padStore(pads());
  const paint = (f) => f.clear("red");
  store.draw("pads", paint);

  const { out, stop } = sent();
  store.draw("pads", paint);
  store.draw("pads", paint);
  stop();
  expect(out).toHaveLength(0);
});

test("...and a changed one does", () => {
  const store = padStore(pads());
  store.draw("pads", (f) => f.clear("red"));

  const { out, stop } = sent();
  store.draw("pads", (f) => {
    f.clear("red");
    f.set(2, 2, "white");
  });
  stop();
  expect(out).toHaveLength(1);
});

test("a press arrives with y flipped back, so a round trip lands on the pad it was painted on", () => {
  const store = padStore(pads());
  const seen = [];
  store.onPad("pads", (e) => seen.push(e));

  // The wire shape, MEASURED on a Push 3: <velocity> <x> <yFromTop> <1>.
  simulate("pad_pads", 66, 0, 7, 1); // bottom-left on the hardware
  simulate("pad_pads", 0, 0, 7, 1); // ...and its release

  expect(seen).toEqual([
    { x: 0, y: 0, value: 66, down: true, extra: 1 },
    { x: 0, y: 0, value: 0, down: false, extra: 1 },
  ]);
});

test("the observer's ATTACH notification is not a press", () => {
  // `live.observer` emits the property's current value the moment it is pointed at
  // an object. Forwarded blindly that is a press at (undefined, undefined) - which
  // is exactly what the spike saw.
  const store = padStore(pads());
  const seen = [];
  store.onPad("pads", (e) => seen.push(e));
  simulate("pad_pads");
  expect(seen).toEqual([]);
});

test("controls_held clears the cache, so the next frame is whole", () => {
  // Live repaints the matrix as it hands it over, so what we last sent is no longer
  // what is lit - a diff against it would suppress the repaint that is needed most.
  const store = padStore(pads());
  const paint = (f) => f.clear("sky");
  store.draw("pads", paint);

  simulate("controls_held", 1);
  const { out, stop } = sent();
  store.draw("pads", paint);
  stop();
  expect(out).toHaveLength(1);
  expect(store.held()).toBe(true);
});

test("controls_held carries the REASON, and the four are distinguishable", () => {
  // The bug this pins: on the hardware `takeover` off, no Push, a Push without the
  // role, and another instance holding the grid are all one thing - a dark Push - and
  // Live reports none of them, because a rejected grab is a console line and a normal
  // return. The reason is the wrapper saying what it DECIDED.
  const store = padStore(pads());
  simulate("controls_held", 0, "not_focused");
  expect(store.held()).toBe(false);
  expect(store.reason()).toBe("not_focused");

  simulate("controls_held", 1, "held");
  expect(store.held()).toBe(true);
  expect(store.reason()).toBe("held");

  // A reason that changes WITHOUT the grab changing is still news to the page.
  simulate("controls_held", 0, "no_surface");
  expect(store.reason()).toBe("no_surface");
});

test("the wrapper reads an OBJECT-valued observer's id off the LAST atom", () => {
  // A property observer is handed `[<property>, ...value]`, and an object-valued
  // property's value is the TWO atoms `id <n>`. Reading `a[1]` gives Number("id"),
  // which is NaN - not equal to anything, including itself - so the focus test could
  // never be true, `takeover` looked on, and nothing was ever grabbed with no error
  // anywhere. This is the shape that made it so.
  const wrapper = readFileSync(path.join(root, "packages/wrapper/src/controls.ts"), "utf8");
  expect(wrapper).toMatch(/function controlsIdFromCallback/);
  expect(wrapper).toContain("controlsSelectedTrackId = controlsIdFromCallback(a)");
  expect(wrapper).toContain("controlsSelectedDeviceId = controlsIdFromCallback(a)");
  // ...and the track is the one ownTrack() CLIMBS to. `this_device canonical_parent`
  // is the Chain inside a Rack, whose id equals no selected_track ever.
  expect(wrapper).toContain("ownTrack()");
  expect(wrapper).not.toContain('new LiveAPI("this_device canonical_parent")');
});

test("a role that did not resolve is REPORTED - the one failure this API can see", () => {
  const store = padStore(pads());
  simulate("controls_role", "pads", 0);
  expect(store.roles()).toEqual({ pads: false });
});

/* ------------------------------------------------------------------ *
 * The build half
 * ------------------------------------------------------------------ */

test("the takeover chain is DERIVED from the declaration, not from the manifest", () => {
  const surface = defineSurface({ controls: pads(), params: {} });
  expect(withControlsChain(["webaudio"], surface)).toEqual(["webaudio", "takeover"]);
  // Idempotent - running the chain twice would emit duplicate box ids.
  expect(withControlsChain(["takeover"], surface)).toEqual(["takeover"]);
  // ...and a device that declares nothing gets nothing.
  expect(withControlsChain(["webaudio"], defineSurface({ params: {} }))).toEqual(["webaudio"]);
});

test("CONTROLS_SPEC carries the candidate names the wrapper resolves against", () => {
  const banner = controlsSpecBanner(defineSurface({ controls: pads(), params: {} }));
  const spec = JSON.parse(banner.replace(/^var CONTROLS_SPEC = /, "").replace(/;\n$/, ""));
  expect(spec.controls[0]).toMatchObject({ key: "pads", kind: "grid", role: "matrix", rows: 8, cols: 8 });
  expect(spec.controls[0].names).toContain("Button_Matrix");
  // The declared focus default travels as the menu INDEX Max stores it as: a wrapper
  // that assumed 0 would treat a Track-focused device as Device-focused until the menu
  // was touched.
  expect(spec.focus).toBe(1);
  // A device with no declaration gets no banner - `typeof CONTROLS_SPEC ===
  // "undefined"` is the guard the wrapper checks.
  expect(controlsSpecBanner(defineSurface({ params: {} }))).toBe("");
});

test("the patcher puts the observer between the hardware and [jweb], with no [js] in the way", () => {
  const surface = defineSurface({ controls: pads(), params: {} });
  const device = { name: "t", type: "midi", chains: ["takeover"], unmatchedTo: "js" };
  const p = composePatcher(base, device, surface);
  const text = Object.fromEntries(p.patcher.boxes.map(({ box: b }) => [b.id, b.text]));
  const cord = (a, b) => p.patcher.lines.some(({ patchline: l }) => l.source[0] === a && l.destination[0] === b);

  expect(text["obj-tk-obs-pads"]).toBe("live.observer value");
  expect(text["obj-tk-pad-pads"]).toBe("prepend pad_pads");
  // THE INPUT PATH. A press reaches the page without touching [js] at all.
  expect(cord("obj-tk-obs-pads", "obj-tk-pad-pads")).toBe(true);
  expect(cord("obj-tk-pad-pads", "obj-jweb")).toBe(true);
  expect(cord("obj-tk-obs-pads", "obj-js")).toBe(false);

  // The id reaches the observer's RIGHT inlet, off [js]'s aux outlet.
  expect(text["obj-tk-route"]).toBe("route tk_pads");
  const idCord = p.patcher.lines.find(({ patchline: l }) => l.source[0] === "obj-tk-route" && l.destination[0] === "obj-tk-obs-pads");
  expect(idCord.patchline.destination[1]).toBe(1);
});

test("the takeover parameters reach [js] from BOTH their sources", () => {
  // The object's own outlet is a knob turn, an automation lane or a Push encoder;
  // the route outlet is what the app wrote - and the app's write reaches the object
  // as `set`, which updates it WITHOUT producing output. Wire only the first and
  // the takeover ignores the app; wire only the second and it ignores Push.
  const surface = defineSurface({ controls: pads(), params: {} });
  const p = composePatcher(base, { name: "t", type: "midi", chains: ["takeover"], unmatchedTo: "js" }, surface);
  const cord = (a, b) => p.patcher.lines.some(({ patchline: l }) => l.source[0] === a && l.destination[0] === b);

  for (const id of ["takeover", "focus"]) {
    expect(cord(`obj-param-${id}`, `obj-tk-${id}`)).toBe(true);
    expect(cord("obj-surface-route", `obj-tk-${id}`)).toBe(true);
    expect(cord(`obj-tk-${id}`, "obj-js")).toBe(true);
  }
});

test("the chain refuses a device whose surface declares no controls", () => {
  expect(() => composePatcher(base, { name: "t", type: "midi", chains: ["takeover"] }, defineSurface({ params: {} }))).toThrow(
    /needs a defineControls\(\) declaration/,
  );
});
