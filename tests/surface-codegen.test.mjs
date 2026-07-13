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
import { SURFACE_ROUTE } from "@m4l-jweb/build/surface";
import { defineSurface, dial, menu, toggle } from "@m4l-jweb/surface";

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
