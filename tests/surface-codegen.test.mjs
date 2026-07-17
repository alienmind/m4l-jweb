/**
 * surface-codegen.test.mjs - what the Surface compiles to, in the patcher.
 *
 * The declaration's own rules are tested in surface.test.mjs. This file is about
 * the CORDS: the boxes applySurface() emits and how they are wired, because the
 * one behaviour this whole design rests on has two halves that pull in opposite
 * directions, and getting either wrong is silent.
 *
 *   `set <value>` updates a live.* object WITHOUT making it output.
 *
 *   HALF ONE - that is why the app can write a parameter at all. A bare value
 *   into the object's inlet would set it AND make it output, straight back to
 *   the app, which may set it again. The write must arrive as `set`.
 *
 *   HALF TWO - and `set` silences the object for EVERYONE, not just for the app,
 *   including whatever it drives inside the patcher. So the value must ALSO be
 *   fanned straight from the route to the parameter's consumers, or the app's
 *   slider moves the dial and the DSP never hears it. hello-audio shipped like
 *   that: the filter did not move, and nothing anywhere reported an error.
 *
 * A test that pinned only half one would pass on the broken device.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { expect, test } from "vitest";

import { composePatcher } from "@m4l-jweb/build";
import { box, line, registerChain, removeLine } from "@m4l-jweb/build/chains";
import { SURFACE_ROUTE, computeNativeSlots } from "@m4l-jweb/build/surface";
import { button, defineSurface, dial, menu, toggle, window, state } from "@m4l-jweb/surface";

const require = createRequire(import.meta.url);
const BASE = path.join(path.dirname(require.resolve("@m4l-jweb/build")), "..", "templates", "base.json");

/**
 * Generate a device's patcher exactly as the build does - by calling the build.
 *
 * `composePatcher()` IS the pipeline: the real template, the audio endpoints, the
 * real chains, then the Surface interposing on what feeds the wrapper. A test that
 * assembled that pipeline itself could pass while the build wired something else,
 * which is the one failure a codegen test must not have.
 */
function compile(surface, { chains = [], device = {} } = {}) {
  const base = JSON.parse(readFileSync(BASE, "utf8"));
  const { patcher } = composePatcher(base, { name: "test", type: "midi", chains, ...device }, surface);
  const { boxes, lines } = patcher;

  const cords = lines.map(({ patchline: pl }) => ({ src: pl.source[0], out: pl.source[1], dst: pl.destination[0], in: pl.destination[1] }));
  return {
    boxes,
    cords,
    box: (id) => boxes.find((b) => b.box.id === id)?.box,
    /** Every box feeding an inlet, by the text a reader would see in Max. */
    feeding: (dstId, dstIn) =>
      cords.filter((c) => c.dst === dstId && c.in === dstIn).map((c) => ({ ...c, text: boxes.find((b) => b.box.id === c.src)?.box.text })),
  };
}

/**
 * The cords carrying the APP's messages into the wrapper - which is not the same
 * as every cord into [js]. `live.thisdevice` bangs the same inlet, and that cord
 * is load-bearing (hard rule 4). Excluding it here is what lets the assertions
 * below say "exactly one" and mean it.
 */
const appFeeds = (c) => c.feeding("obj-js", 0).filter((x) => x.src !== "obj-thisdevice");

/** hello-audio's real parameter: a cutoff in Hz, with the knob's curve on it. */
const oneDial = defineSurface({
  params: { cutoff: dial({ range: [40, 18000], unit: "Hz", exponent: 4, default: 18000, short: "Cutoff" }) },
});

/* ------------------------------------------------------------------ *
 * The objects
 * ------------------------------------------------------------------ */

test("every declared parameter becomes a parameter_enable'd live.* object", () => {
  const p = compile(oneDial).box("obj-param-cutoff");
  expect(p.maxclass).toBe("live.dial");
  expect(p.parameter_enable).toBe(1);

  const attrs = p.saved_attribute_attributes.valueof;
  expect(attrs.parameter_longname).toBe("cutoff");
  expect(attrs.parameter_shortname).toBe("Cutoff"); // Push's label, from `short`
});

test("a range is parameter_mmin/parameter_mmax - NOT parameter_range", () => {
  // We emitted `parameter_range` for a long time. It is not a key Max uses for a
  // continuous parameter - it appears in zero of the patchers Ableton ships - so
  // the range was silently whatever the object defaulted to. A range that does
  // nothing is invisible until a device is on a track behaving oddly.
  const attrs = compile(oneDial).box("obj-param-cutoff").saved_attribute_attributes.valueof;
  expect(attrs.parameter_mmin).toBe(40);
  expect(attrs.parameter_mmax).toBe(18000);
  expect(attrs).not.toHaveProperty("parameter_range");
});

test("a unit makes Live PRINT the value - without one, a float reads as an integer", () => {
  // This is what put "0" and "1" under a Push encoder while the filter swept
  // perfectly smoothly: the value was always a float, but unit style 0 (the
  // default) rounds the READOUT to an integer. 3 = Hertz.
  const attrs = compile(oneDial).box("obj-param-cutoff").saved_attribute_attributes.valueof;
  expect(attrs.parameter_type).toBe(0); // float
  expect(attrs.parameter_unitstyle).toBe(3); // Hertz
  expect(attrs.parameter_exponent).toBe(4); // the knob's travel, not the value

  // No unit: a bare number, printed per the parameter's own type.
  const bare = defineSurface({ params: { mix: dial({ range: [0, 1], default: 0.5, short: "Mix" }) } });
  expect(compile(bare).box("obj-param-mix").saved_attribute_attributes.valueof.parameter_unitstyle).toBe(1); // float
});

test("an unknown unit becomes a custom one, with the string Live appends", () => {
  const s = defineSurface({ params: { harm: dial({ range: [1, 16], step: 1, default: 1, unit: "Harmonics", short: "Harm" }) } });
  const attrs = compile(s).box("obj-param-harm").saved_attribute_attributes.valueof;
  expect(attrs.parameter_unitstyle).toBe(9); // custom
  expect(attrs.parameter_units).toBe("Harmonics");
});

test("a default is stored as parameter_initial - and is INERT without its enable flag", () => {
  // A live.* object with no initial value loads at the BOTTOM of its range, and
  // the bottom of this one is a 40 Hz lowpass: a device that eats the signal the
  // moment it loads. Setting parameter_initial WITHOUT parameter_initial_enable
  // does nothing at all, silently, so the two are asserted together.
  const attrs = compile(oneDial).box("obj-param-cutoff").saved_attribute_attributes.valueof;
  expect(attrs.parameter_initial_enable).toBe(1);
  expect(attrs.parameter_initial).toEqual([18000]);
});

test("the parameter kind picks the Max object and its parameter_type", () => {
  const s = defineSurface({
    params: {
      density: dial({ range: [0, 1], default: 0.5, short: "Dens" }),
      octave: dial({ range: [-4, 4], step: 1, default: 0, short: "Oct" }),
      running: toggle({ default: true, short: "Run" }),
      slot: menu({ options: ["A", "B", "C"], default: "B", short: "Slot" }),
    },
  });
  const c = compile(s);
  const attrs = (id) => c.box(`obj-param-${id}`).saved_attribute_attributes.valueof;

  expect(c.box("obj-param-density").maxclass).toBe("live.dial");
  expect(attrs("density").parameter_type).toBe(0); // float
  expect(attrs("octave").parameter_type).toBe(1); // step: 1 -> an INTEGER parameter
  expect(c.box("obj-param-running").maxclass).toBe("live.toggle");
  expect(attrs("running").parameter_type).toBe(2); // enum

  // Max stores a parameter's value as a NUMBER, always. A menu's default is an
  // index into its options; a toggle's is 0/1.
  expect(attrs("running").parameter_initial).toEqual([1]);
  expect(c.box("obj-param-slot").maxclass).toBe("live.menu");
  expect(attrs("slot").parameter_enum).toEqual(["A", "B", "C"]);
  expect(attrs("slot").parameter_initial).toEqual([1]); // "B"

  // An enum's range is its options: the labels in `parameter_enum`, and the
  // highest INDEX in parameter_mmax. This is the shape Max itself writes.
  expect(attrs("slot").parameter_mmax).toBe(2); // 3 options -> 0..2
  expect(attrs("running").parameter_enum).toEqual(["off", "on"]);
  expect(attrs("running").parameter_mmax).toBe(1);

  // A continuous parameter's range, in real units.
  expect(attrs("octave").parameter_mmin).toBe(-4);
  expect(attrs("octave").parameter_mmax).toBe(4);
});

/* ------------------------------------------------------------------ *
 * Direction one: the object -> the app
 * ------------------------------------------------------------------ */

test("a knob turn reaches the app as `<id> <value>`", () => {
  const c = compile(oneDial);
  expect(c.box("obj-prepend-cutoff").text).toBe("prepend cutoff");
  expect(c.cords).toContainEqual({ src: "obj-param-cutoff", out: 0, dst: "obj-prepend-cutoff", in: 0 });
  expect(c.cords).toContainEqual({ src: "obj-prepend-cutoff", out: 0, dst: "obj-jweb", in: 0 });
});

/* ------------------------------------------------------------------ *
 * Direction two: the app -> the object. Both halves of `set`.
 * ------------------------------------------------------------------ */

test("HALF ONE: the app's write reaches the object as `set`, never as a bare value", () => {
  // A bare value into a live.dial's inlet sets it AND makes it output - which
  // sends it straight back to the app, which may set it again. `prepend set` is
  // what stops the loop, so nothing else may feed this inlet.
  const c = compile(oneDial);
  expect(c.box(SURFACE_ROUTE).text).toBe("route set_cutoff");

  const into = c.feeding("obj-param-cutoff", 0);
  expect(into.map((x) => x.text)).toEqual(["prepend set"]);
  expect(c.cords).toContainEqual({ src: SURFACE_ROUTE, out: 0, dst: "obj-set-cutoff", in: 0 });
});

test("HALF TWO: and the parameter's consumers still receive what the app wrote", () => {
  // `set` silences the object's outlet for EVERYONE. So the DSP is fed from TWO
  // sources, fanned out - the object (a knob turn, automation, Push) AND the
  // route (the app's slider). Drop the second and the slider looks dead: the dial
  // moves, the filter does not. That was a real bug, and this is the assertion
  // that makes it unrepeatable.
  //
  // The cutoff is in Hz, so it lands on the filter's right inlet directly - there
  // is no mapping object in between any more. The curve is on the parameter.
  const c = compile(oneDial, { chains: ["lowpass"], device: { name: "hello-audio", type: "audio" } });

  for (const filter of ["obj-lpf-l", "obj-lpf-r"]) {
    const into = c.feeding(filter, 1).map((x) => `${x.src}:${x.out}`);
    expect(into).toContain("obj-param-cutoff:0"); // the dial's own outlet
    expect(into).toContain(`${SURFACE_ROUTE}:0`); // the value the app wrote
  }
});

test("each parameter's value leaves the route on its own outlet, in declaration order", () => {
  const s = defineSurface({
    params: {
      a: dial({ range: [0, 1], default: 0, short: "A" }),
      b: dial({ range: [0, 1], default: 0, short: "B" }),
    },
  });
  const c = compile(s);
  expect(c.box(SURFACE_ROUTE).text).toBe("route set_a set_b");
  expect(c.cords).toContainEqual({ src: SURFACE_ROUTE, out: 0, dst: "obj-set-a", in: 0 });
  expect(c.cords).toContainEqual({ src: SURFACE_ROUTE, out: 1, dst: "obj-set-b", in: 0 });
  // ...and the last outlet is `route`'s unmatched one, which is NOT a parameter.
  expect(c.box(SURFACE_ROUTE).numoutlets).toBe(3);
});

/* ------------------------------------------------------------------ *
 * Interposition: the Surface must not eat anybody else's messages
 * ------------------------------------------------------------------ */

test("what the Surface does not own still reaches the wrapper - exactly once", () => {
  // The route sits in the middle of the app's message stream, so `ui_ready` and
  // everything else has to come out of its unmatched outlet. TWO cords carrying
  // the app's messages into [js] would mean the wrapper saw every unrouted message
  // twice - which is what routing [jweb] into two routes in parallel would do.
  const c = compile(oneDial, { chains: ["lowpass"], device: { name: "hello-audio", type: "audio" } });
  expect(appFeeds(c)).toEqual([{ src: SURFACE_ROUTE, out: 1, dst: "obj-js", in: 0, text: "route set_cutoff" }]);
});

test("live.thisdevice keeps its cord into the wrapper", () => {
  // [live.thisdevice] -> [js] is the bang EVERY LiveAPI observer is created from
  // (CLAUDE.md, hard rule 4: one created during loadbang is dead, forever, with no
  // error). It also lands on [js]'s inlet 0, so anything that goes looking for
  // "the cord that feeds the wrapper" can cut it by mistake. Nothing here may.
  const c = compile(oneDial, { chains: ["lowpass"], device: { name: "hello-audio", type: "audio" } });
  expect(c.cords).toContainEqual({ src: "obj-thisdevice", out: 0, dst: "obj-js", in: 0 });
});

test("a chain that already claimed jweb's outlet keeps it - the Surface goes downstream of it", () => {
  // hello-midi: [jweb] -> [route midinote flush] -> [route set_*] -> [js]. In
  // SERIES, so a `midinote` still reaches the note chain, a `set_density` still
  // reaches the dial, and `ui_ready` still reaches the wrapper - once.
  const s = defineSurface({ params: { density: dial({ range: [0, 1], default: 0.5, short: "Dens" }) } });
  const c = compile(s, { chains: ["midiin", "midiout"], device: { name: "hello-midi" } });

  expect(c.cords).toContainEqual({ src: "obj-jweb", out: 0, dst: "obj-route", in: 0 });
  expect(c.cords).toContainEqual({ src: "obj-route", out: 2, dst: SURFACE_ROUTE, in: 0 }); // midiout's unmatched
  expect(appFeeds(c).map((x) => x.src)).toEqual([SURFACE_ROUTE]);
});

test("a device with no surface is left alone", () => {
  // The device declares no parameters. It must not grow an empty `route`
  // mapping or crash the UI bridge.
  const c = compile(null, { device: { name: "empty-device" } });
  expect(c.box(SURFACE_ROUTE)).toBeUndefined();
  expect(appFeeds(c).map((x) => x.src)).toEqual(["obj-jweb"]);
});

/* ------------------------------------------------------------------ *
 * The failure that used to be silent
 * ------------------------------------------------------------------ */

test("a chain that cuts jweb's cord by hand fails the build, instead of double-delivering", () => {
  // The pre-0.4.0 idiom: removeLine(lines, jwebId, unmatchedId), then wire your own
  // route from [jweb] and pass your unmatched outlet on to [js]. Two routes then
  // hang off [jweb] IN PARALLEL, and each passes the unrouted messages on - so the
  // wrapper sees `ui_ready` twice, the device works, and nothing reports anything.
  // A chain must hand the stream on explicitly (claimAppMessages), or say why not.
  const legacy = (ctx) => {
    const { boxes, lines, jwebId, unmatchedId } = ctx;
    removeLine(lines, jwebId, unmatchedId);
    boxes.push(box("obj-legacy-route", "route foo", { numoutlets: 2, outlettype: ["", ""] }));
    lines.push(line(jwebId, 0, "obj-legacy-route", 0));
    lines.push(line("obj-legacy-route", 1, unmatchedId, 0));
  };
  registerChain("legacy-claim", legacy);

  expect(() => compile(oneDial, { chains: ["legacy-claim"], device: { name: "legacy" } })).toThrow(/without claimAppMessages/);
});

test("a chain whose parameter is not declared fails the build, loudly", () => {
  // `lowpass` drives its filter from `cutoff`. Rename the parameter in surface.ts
  // and the chain would generate a cord from a box that does not exist - which
  // Max opens as a patcher with a missing object and no explanation.
  const s = defineSurface({ params: { brightness: dial({ range: [0, 1], default: 1, short: "Bright" }) } });
  expect(() => compile(s, { chains: ["lowpass"], device: { name: "hello-audio", type: "audio" } })).toThrow(/needs a parameter "cutoff"/);
});

/* ------------------------------------------------------------------ *
 * layout.native - native dials in the device view
 *
 * The whole feature is a PRESENTATION overlay on the objects applySurface()
 * already emits: a listed parameter gains `presentation`/`presentation_rect`/
 * `varname`, [jweb] shifts right by the zone width, and NOTHING about the wiring
 * changes. The load-bearing property is the last one - and the regression guard
 * at the end pins that a surface with no `layout` is untouched.
 * ------------------------------------------------------------------ */

/** Do two [x, y, w, h] rects overlap (share any area)? */
const overlaps = (a, b) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];

test("computeNativeSlots fills column-major, then overflows into the next column", () => {
  // Four params at rows: 3 => a full first column (3) then one in a second column.
  const s = defineSurface({
    params: {
      a: dial({ range: [0, 1], default: 0, short: "A" }),
      b: dial({ range: [0, 1], default: 0, short: "B" }),
      c: dial({ range: [0, 1], default: 0, short: "C" }),
      d: dial({ range: [0, 1], default: 0, short: "D" }),
    },
    layout: { native: { params: ["a", "b", "c", "d"], rows: 3 } },
  });
  const { slots, width } = computeNativeSlots(s);
  // First column: x constant, y stepping by the pitch.
  expect(slots.get("a")).toEqual([8, 8, 44, 48]);
  expect(slots.get("b")).toEqual([8, 64, 44, 48]);
  expect(slots.get("c")).toEqual([8, 120, 44, 48]);
  // Fourth wraps to a new column, back at the top row.
  expect(slots.get("d")).toEqual([60, 8, 44, 48]);
  // The zone spans both columns plus its margins: 8 + 44 + 8 + 44 + 8.
  expect(width).toBe(112);
});

test("a surface with no native layout produces an empty zone", () => {
  const s = defineSurface({ params: { a: dial({ range: [0, 1], default: 0, short: "A" }) } });
  expect(computeNativeSlots(s)).toEqual({ slots: new Map(), width: 0 });
});

const fxLike = () =>
  defineSurface({
    params: {
      cutoff: dial({ range: [40, 18000], unit: "Hz", default: 18000, short: "Cutoff" }),
      drive: dial({ range: [0, 1], default: 0, short: "Drive" }),
      room: dial({ range: [0, 1], default: 0, short: "Room" }),
      gain: dial({ range: [0, 2], default: 1, short: "Gain" }),
    },
    // Only three of the four are native; `gain` stays an HTML control.
    layout: { native: { params: ["cutoff", "drive", "room"], rows: 3 } },
  });

test("every listed parameter's object is shown in the device view, inside the zone", () => {
  const c = compile(fxLike());
  const { width } = computeNativeSlots(fxLike());

  for (const id of ["cutoff", "drive", "room"]) {
    const b = c.box(`obj-param-${id}`);
    expect(b.presentation, `${id} must be shown`).toBe(1);
    expect(b.varname).toBe(`param-${id}`); // prefixed so it cannot collide with obj-state-<id>
    const [x, y, w, h] = b.presentation_rect;
    // Inside the presentation zone: [0, 0, width, 169].
    expect(x).toBeGreaterThanOrEqual(0);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(x + w).toBeLessThanOrEqual(width);
    expect(y + h).toBeLessThanOrEqual(169);
  }
});

test("no two native rects overlap", () => {
  const c = compile(fxLike());
  const rects = ["cutoff", "drive", "room"].map((id) => c.box(`obj-param-${id}`).presentation_rect);
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      expect(overlaps(rects[i], rects[j]), `${i} and ${j} overlap`).toBe(false);
    }
  }
});

test("a parameter NOT in layout.native carries no presentation - it stays an HTML control", () => {
  const c = compile(fxLike());
  const gain = c.box("obj-param-gain");
  expect(gain).toBeDefined();
  expect(gain).not.toHaveProperty("presentation");
  expect(gain).not.toHaveProperty("presentation_rect");
  // ...and its wiring is exactly the same as any other parameter's: the feature
  // touches presentation only. The fan-out route still carries set_gain.
  expect(c.box(SURFACE_ROUTE).text).toContain("set_gain");
});

test("[jweb] shifts right by the zone width, and its width is preserved", () => {
  const c = compile(fxLike());
  const { width } = computeNativeSlots(fxLike());
  const jweb = c.box("obj-jweb");
  // x moves to the zone width; y/w/h are exactly the template's [_, 0, 420, 169].
  expect(jweb.presentation_rect).toEqual([width, 0, 420, 169]);
});

test("REGRESSION: a surface with no layout leaves the objects and [jweb] untouched", () => {
  // The feature must be invisible until asked for. A no-layout surface's parameter
  // objects carry no presentation keys, and [jweb] sits where the base template
  // put it - `presentation_rect: [0, 0, 420, 169]`, unshifted.
  const c = compile(oneDial);
  const p = c.box("obj-param-cutoff");
  expect(p).not.toHaveProperty("presentation");
  expect(p).not.toHaveProperty("presentation_rect");
  expect(p).not.toHaveProperty("varname");
  expect(c.box("obj-jweb").presentation_rect).toEqual([0, 0, 420, 169]);
});

test("a button compiles to a live.text with its label and toggle mode", () => {
  // A live.text carries visible text where a live.toggle cannot. The label is `text`
  // (and `texton`, so it reads the same on and off), and `mode: 1` makes it a toggle.
  const s = defineSurface({ params: { back: button({ default: false, label: "Back", short: "Back" }) } });
  const b = compile(s).box("obj-param-back");
  expect(b.maxclass).toBe("live.text");
  expect(b.text).toBe("Back");
  expect(b.texton).toBe("Back");
  expect(b.mode).toBe(1);
  // Its value is a 0/1 enum, exactly like a toggle.
  const attrs = b.saved_attribute_attributes.valueof;
  expect(attrs.parameter_type).toBe(2);
  expect(attrs.parameter_enum).toEqual(["off", "on"]);
  expect(attrs.parameter_mmax).toBe(1);
});

const panelSurface = () =>
  defineSurface({
    params: {
      back: button({ default: false, label: "Back", short: "Back" }),
      cutoff: dial({ range: [40, 18000], unit: "Hz", default: 18000, short: "Cutoff" }),
      gain: dial({ range: [0, 2], default: 1, short: "Gain" }),
    },
    layout: { native: { params: ["cutoff", "gain"], rows: 2, panel: true, switch: "back" } },
  });

test("layout.native.panel builds [jweb] full-width (x=0), so web mode has no reserved strip", () => {
  const c = compile(panelSurface());
  const jweb = c.box("obj-jweb");
  // Full width from x=0 (the frame is the wider of the web UI and the knob zone).
  expect(jweb.presentation_rect[0]).toBe(0);
  expect(jweb.presentation_rect[2]).toBe(420);
  expect(jweb.varname).toBe("obj-jweb");
});

test("layout.native.switch is pinned top-right, OUT of the dial grid", () => {
  const c = compile(panelSurface());
  const back = c.box("obj-param-back");
  const [x, y, w] = back.presentation_rect;
  // Top-right of the 420-wide web UI, not in the grid's left columns.
  expect(y).toBe(8);
  expect(x + w).toBe(420 - 8); // right margin
  // The grid dials start at the left; the switch does not share their column.
  expect(c.box("obj-param-cutoff").presentation_rect[0]).toBe(8);
  expect(x).toBeGreaterThan(c.box("obj-param-gain").presentation_rect[0]);
});

test("layout.native does NOT claim native_show/native_hide - the wrapper handles them", () => {
  // Runtime show/hide (useNativeVisibility) is done in the wrapper's [js] via the
  // Maxobj API, not by a patcher route (the [thispatcher] `script hide` approach was
  // tried and did not reach the M4L presentation view). So the codegen emits no
  // control objects, and `native_show`/`native_hide` fall through to the wrapper like
  // any unclaimed app message.
  const c = compile(fxLike());
  expect(c.box("obj-native-route")).toBeUndefined();
  expect(c.box("obj-native-thispatcher")).toBeUndefined();
  // The Surface route's unmatched outlet still reaches the wrapper, carrying them.
  expect(appFeeds(c).map((x) => x.src)).toEqual([SURFACE_ROUTE]);
});

/* ------------------------------------------------------------------ *
 * Windows and Persistence
 * ------------------------------------------------------------------ */

const mapWindow = () =>
  defineSurface({
    params: {},
    windows: { map: window({ title: "Map", width: 400, height: 300, entry: "MapApp" }) },
  });

test("a declared window compiles to a subpatcher holding its own [jweb]", () => {
  const c = compile(mapWindow());

  expect(c.box("obj-windows-route").text).toBe("route window_map_open window_map_close");

  const sub = c.box("obj-window-map-sub");
  expect(sub.maxclass).toBe("newobj");
  expect(sub.text).toBe("p Map");

  // The subpatcher must have an INLET, or Max refuses the cord from [pcontrol] -
  // silently, when it saves. The window then never opens and nothing says why.
  const inner = sub.patcher.boxes.map((b) => b.box.maxclass);
  expect(inner).toContain("inlet");
  expect(inner).toContain("jweb");
  expect(c.cords).toContainEqual({ src: "obj-window-map-pcontrol", out: 0, dst: "obj-window-map-sub", in: 0 });

  // The URL cannot be wired in from outside a subpatcher, so the wrapper sends it
  // BY NAME (messnamed) to this receive.
  const recv = sub.patcher.boxes.find((b) => b.box.text?.indexOf("r window-read-") === 0);
  expect(recv.box.text).toBe("r window-read-map");
  expect(sub.patcher.lines).toContainEqual({ patchline: { source: ["obj-recv", 0], destination: ["obj-jweb", 0] } });
});

test("a window does NOT float unless it asks to", () => {
  // The default is right for a window you work IN. Floating everything would put an
  // editor permanently over the set.
  const inner = compile(mapWindow())
    .box("obj-window-map-sub")
    .patcher.boxes.map((b) => b.box.text);
  expect(inner).not.toContain("thispatcher");
});

test("alwaysOnTop floats the window, and keeps the close box while doing it", () => {
  const c = compile(
    defineSurface({
      params: {},
      windows: { help: window({ title: "Help", width: 400, height: 300, entry: "Help", alwaysOnTop: true }) },
    }),
  );
  const sub = c.box("obj-window-help-sub");
  const text = (id) => sub.patcher.boxes.find((b) => b.box.id === id)?.box.text;

  // loadbang -> the flags message -> thispatcher. It fires when the SUBPATCHER loads,
  // so the flags are a property of the window whether or not anyone opens it.
  expect(text("obj-float-loadbang")).toBe("loadbang");
  expect(text("obj-float-thispatcher")).toBe("thispatcher");
  expect(sub.patcher.lines).toContainEqual({ patchline: { source: ["obj-float-loadbang", 0], destination: ["obj-float-msg", 0] } });
  expect(sub.patcher.lines).toContainEqual({ patchline: { source: ["obj-float-msg", 0], destination: ["obj-float-thispatcher", 0] } });

  const msg = text("obj-float-msg");
  expect(msg).toContain("float");
  // `window flags` REPLACES the list rather than adding to it, so a message naming only
  // `float` ships a reference card with no close box, no title and no resize - a window
  // the user cannot get rid of. These put back what a window is expected to have.
  expect(msg, "window flags replaces the whole list - float alone loses the close box").toContain("close");
  expect(msg).toContain("title");
  expect(msg).toContain("grow");
  // The flags do nothing until `exec`. The comma is what makes that a second message.
  expect(msg).toContain(", window exec");
  // A message box, not a newobj - the comma only means "two messages" in a message box.
  expect(sub.patcher.boxes.find((b) => b.box.id === "obj-float-msg").box.maxclass).toBe("message");
});

/**
 * THE BUG THAT PARKED THIS FEATURE, and it was never [route]'s fault.
 *
 * `open` and `wclose` are MESSAGES sent to [pcontrol], so they are message boxes.
 * They were generated as `newobj` - object boxes - whose text named an object
 * ("open") that does not exist, and [pcontrol] was generated with `maxclass:
 * "pcontrol"`, which is not a box class Max has. All three boxes failed to
 * instantiate, kept their cords, and did nothing. The route matched perfectly and
 * fired into three holes.
 */
test("the open/close boxes are MESSAGE boxes, and [pcontrol] is an object box", () => {
  const c = compile(mapWindow());

  // The words are [pcontrol]'s own: `open` and `close`. `wclose` is
  // [thispatcher]'s, and pcontrol rejects it out loud.
  for (const [tag, text] of [
    ["open", "open"],
    ["close", "close"],
  ]) {
    const msg = c.box(`obj-window-map-${tag}msg`);
    expect(msg.maxclass, `[${text}( must be a message box, not an object named "${text}"`).toBe("message");
    expect(msg.text).toBe(text);
    expect(c.cords).toContainEqual({ src: `obj-window-map-${tag}msg`, out: 0, dst: "obj-window-map-pcontrol", in: 0 });
  }

  const pc = c.box("obj-window-map-pcontrol");
  expect(pc.maxclass).toBe("newobj");
  expect(pc.text).toBe("pcontrol");
});

test("the windows route is spliced into the app's stream in SERIES, not hung off [jweb]", () => {
  // Two routes in parallel on [jweb]'s outlet means every unrouted message reaches
  // the wrapper TWICE - `ui_ready` included. The windows route claimed [jweb]
  // directly and left its unmatched outlet dangling, so it did both at once.
  const c = compile(
    defineSurface({
      params: { cutoff: dial({ short: "Cut", range: [40, 18000], default: 1000, unit: "Hz" }) },
      windows: { map: window({ title: "Map", width: 400, height: 300, entry: "MapApp" }) },
    }),
  );

  // Two things feed [js] now: the windows route (the app's stream, in series) AND
  // the window subpatcher's OWN outlet - the return path that lets the window's
  // [jweb] talk back. The route is the one that must be in series; the subpatcher
  // cord is the window speaking, tagged inside the [p].
  expect(appFeeds(c)).toContainEqual({ src: "obj-windows-route", out: 2, dst: "obj-js", in: 0, text: "route window_map_open window_map_close" });
  expect(appFeeds(c)).toContainEqual({ src: "obj-window-map-sub", out: 0, dst: "obj-js", in: 0, text: "p Map" });
  // ...and the route takes its input from the Surface's unmatched outlet, not from [jweb].
  expect(c.feeding("obj-windows-route", 0)).toEqual([{ src: SURFACE_ROUTE, out: 1, dst: "obj-windows-route", in: 0, text: "route set_cutoff" }]);
});

test("the window subpatcher tags its [jweb] output and sends it out to [js]", () => {
  // The whole point of the return path: a window's [jweb] outlet used to go nowhere,
  // so the page could display but never send. Now it is tagged with the window id
  // (so the wrapper can answer the right window) and routed out of the subpatcher.
  const c = compile(mapWindow());
  const sub = c.box("obj-window-map-sub").patcher;
  const subBox = (id) => sub.boxes.find((b) => b.box.id === id)?.box;
  const subCords = sub.lines.map(({ patchline: pl }) => ({ src: pl.source[0], out: pl.source[1], dst: pl.destination[0], in: pl.destination[1] }));

  expect(subBox("obj-tag").text).toBe("prepend window map");
  expect(subBox("obj-out").maxclass).toBe("outlet");
  expect(subCords).toContainEqual({ src: "obj-jweb", out: 0, dst: "obj-tag", in: 0 });
  expect(subCords).toContainEqual({ src: "obj-tag", out: 0, dst: "obj-out", in: 0 });
});

test("a declared state slot compiles to a [dict] with a [pattr] bound to it", () => {
  const c = compile(defineSurface({ params: {}, state: { config: state({ default: { voices: 4 } }) } }));

  // `dict` is an OBJECT, not a box class: `maxclass: "dict"` never instantiates,
  // and the pattr then binds to nothing - the same silent hole as [pcontrol] above.
  const dict = c.box("obj-state-config");
  expect(dict.maxclass).toBe("newobj");
  expect(dict.text).toBe("dict obj-state-config");
  // @bindto resolves a SCRIPTING name, which is what varname is.
  expect(dict.varname).toBe("obj-state-config");

  const pattr = c.box("obj-pattr-config");
  expect(pattr.maxclass).toBe("newobj");
  expect(pattr.text).toBe("pattr obj-pattr-config @bindto obj-state-config");

  // WHAT MAKES LIVE SAVE IT. A pattr persists in a PATCHER; Live saves the SET,
  // and it only puts a pattr in it when the pattr is a Live parameter. Without
  // this the slot round-trips inside the session and quietly loses everything the
  // moment the set is closed - which is the failure mode you find out about last.
  expect(pattr.saved_object_attributes.parameter_enable).toBe(1);
  // A BLOB (type 3), and invisible: JSON is not a number, and a slot that offered
  // itself to the automation lane would be lying to every Live UI that listed it.
  expect(pattr.saved_attribute_attributes.valueof.parameter_type).toBe(3);
  expect(pattr.saved_attribute_attributes.valueof.parameter_invisible).toBe(1);
  // `@save` was here once. It is not a pattr attribute at all - Max says
  // "pattr: 'save' is not a valid attribute argument" and carries on without it.
  expect(pattr.text).not.toContain("@save");
});
