/**
 * chains.test.mjs - the signal path, and the rule that makes chains composable.
 *
 * An audio chain used to create `plugin~` and `plugout~` for itself and wire itself
 * between them, which made every audio chain a whole DEVICE rather than a stage in
 * one. `chains: ["lowpass", "gain"]` therefore emitted two boxes sharing the id
 * `obj-plugin`, two sharing `obj-plugout`, and four sources summing into the output:
 * the filtered pair AND the unfiltered gain pair, in parallel. The effects did not
 * stack, they mixed - and nothing anywhere reported it. You would blame your DSP.
 *
 * The endpoints belong to the device now, and a chain claims a STAGE:
 * `ctx.audioIn(ch)` is what the last stage left, `ctx.setAudioOut(ch, ...)` says you
 * are the tail. So the ORDER of the list composes them, which is what a device
 * author already expects from a list.
 *
 * These tests generate patchers through `composePatcher()` - the build's own
 * pipeline, not a re-implementation of it.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { expect, test } from "vitest";

import { composePatcher } from "@m4l-jweb/build";
import { box, fanParamInto, line, registerChain } from "@m4l-jweb/build/chains";
import { defineSurface, dial } from "@m4l-jweb/surface";

const require = createRequire(import.meta.url);
const BASE = path.join(path.dirname(require.resolve("@m4l-jweb/build")), "..", "templates", "base.json");

function compile(surface, device) {
  const base = JSON.parse(readFileSync(BASE, "utf8"));
  const { patcher } = composePatcher(base, { name: "test", ...device }, surface);
  const { boxes, lines } = patcher;
  const cords = lines.map(({ patchline: pl }) => ({ src: pl.source[0], out: pl.source[1], dst: pl.destination[0], in: pl.destination[1] }));
  return {
    boxes,
    cords,
    /** How many boxes carry this text - "one plugin~" is the whole point below. */
    count: (text) => boxes.filter((b) => b.box.text === text).length,
    has: (id) => boxes.some((b) => b.box.id === id),
    /** Every box id feeding an inlet. */
    feeding: (dstId, dstIn) => cords.filter((c) => c.dst === dstId && c.in === dstIn).map((c) => c.src),
  };
}

/** hello-audio's three parameters - one per stage, each named by the chain that wants it. */
const surface = defineSurface({
  params: {
    cutoff: dial({ range: [40, 18000], unit: "Hz", exponent: 4, default: 18000, short: "Cutoff" }),
    drive: dial({ range: [1, 10], unit: "x", default: 1, short: "Drive" }),
    gain: dial({ range: [0, 2], default: 1, short: "Gain" }),
  },
});

const audio = (chains) => compile(surface, { name: "fx", type: "audio", chains });

/* ------------------------------------------------------------------ *
 * Composition: the list is a series
 * ------------------------------------------------------------------ */

test("two audio chains stack in declaration order, through ONE pair of endpoints", () => {
  const c = audio(["lowpass", "gain"]);

  // One device, one input, one output. Two of either is the bug: duplicate ids and
  // a summed parallel path, which is an effect that "works" and sounds wrong.
  expect(c.count("plugin~")).toBe(1);
  expect(c.count("plugout~")).toBe(1);

  for (const ch of [0, 1]) {
    const [lpf, gain] = [`obj-lpf-${"lr"[ch]}`, `obj-gain-${"lr"[ch]}`];
    expect(c.feeding(lpf, 0)).toEqual(["obj-plugin"]); // the filter is first
    expect(c.feeding(gain, 0)).toEqual([lpf]); // ...and the gain takes ITS output
    expect(c.feeding("obj-plugout", ch)).toEqual([gain]); // only the tail is heard
  }
});

test("...and reversing the list reverses the signal path", () => {
  // Nothing about `lowpass` says "filter first". The order of the list is the order
  // of the stages, and that is the whole composition model.
  const c = audio(["gain", "lowpass"]);
  expect(c.feeding("obj-gain-l", 0)).toEqual(["obj-plugin"]);
  expect(c.feeding("obj-lpf-l", 0)).toEqual(["obj-gain-l"]);
  expect(c.feeding("obj-plugout", 0)).toEqual(["obj-lpf-l"]);
});

test("hello-audio's three stages are a series, in the order the manifest lists them", () => {
  // The device as shipped: lowpass -> drive -> gain. This is the composition a human
  // can actually verify in Live, because `drive` does not commute with `gain` - which
  // `lowpass` and `gain` do, being both linear. A test that only ever composed linear
  // stages would be pinning a patcher nobody could confirm by ear.
  const c = audio(["lowpass", "drive", "gain"]);
  expect(c.count("plugin~")).toBe(1);
  expect(c.count("plugout~")).toBe(1);

  for (const ch of [0, 1]) {
    const side = "lr"[ch];
    expect(c.feeding(`obj-lpf-${side}`, 0)).toEqual(["obj-plugin"]);
    expect(c.feeding(`obj-drive-${side}`, 0)).toEqual([`obj-lpf-${side}`]);
    expect(c.feeding(`obj-gain-${side}`, 0)).toEqual([`obj-drive-${side}`]);
    expect(c.feeding("obj-plugout", ch)).toEqual([`obj-gain-${side}`]);
  }
});

test("the fan-out invariant survives composition: BOTH sources reach every stage", () => {
  // `set` silences a live.* object's outlet for everyone, so a parameter reaches its
  // DSP from the object (a knob, automation, Push) AND from the route (the app's
  // write). A composed chain is where this would quietly get dropped for one stage.
  const c = audio(["lowpass", "drive", "gain"]);
  const sources = (dst) => c.feeding(dst, 1).sort();
  expect(sources("obj-lpf-l")).toEqual(["obj-param-cutoff", "obj-surface-route"].sort());
  expect(sources("obj-drive-l")).toEqual(["obj-param-drive", "obj-surface-route"].sort());
  expect(sources("obj-gain-r")).toEqual(["obj-param-gain", "obj-surface-route"].sort());
});

/* ------------------------------------------------------------------ *
 * One chain: the seam may not change a working device
 * ------------------------------------------------------------------ */

test("hello-audio is what it always was: plugin~ -> onepole~ -> plugout~, no MIDI ports", () => {
  const c = audio(["lowpass"]);
  expect(c.count("plugin~")).toBe(1);
  expect(c.count("plugout~")).toBe(1);
  for (const ch of [0, 1]) {
    const lpf = `obj-lpf-${"lr"[ch]}`;
    expect(c.feeding(lpf, 0)).toEqual(["obj-plugin"]);
    expect(c.feeding("obj-plugout", ch)).toEqual([lpf]);
  }
  // An audio effect has no MIDI ports. The build removes them now; `lowpass` used to.
  expect(c.has("obj-midiin")).toBe(false);
  expect(c.has("obj-midiout")).toBe(false);
});

test("an audio device with no chain at all is a straight wire", () => {
  // ...and so is `passthrough`, which claims no stage. It is a scaffold: it says out
  // loud what an empty chain list already does.
  for (const chains of [[], ["passthrough"]]) {
    const c = compile(null, { name: "thru", type: "audio", chains });
    expect(c.feeding("obj-plugout", 0)).toEqual(["obj-plugin"]);
    expect(c.feeding("obj-plugout", 1)).toEqual(["obj-plugin"]);
  }
});

test("an instrument keeps its MIDI in - that is how it is played", () => {
  const c = compile(null, { name: "synth", type: "instrument", chains: [] });
  expect(c.has("obj-midiin")).toBe(true);
  expect(c.has("obj-plugout")).toBe(true);
});

/* ------------------------------------------------------------------ *
 * The failures that used to be silent
 * ------------------------------------------------------------------ */

test("a duplicate box id fails the build", () => {
  // This is what two audio chains produced, and a patcher with two boxes sharing an
  // id is one Max resolves however it likes. It shipped. Now it cannot.
  registerChain("dupe", ({ boxes }) => boxes.push(box("obj-js", "print")));
  expect(() => compile(null, { name: "dupe-device", type: "midi", chains: ["dupe"] })).toThrow(/duplicate box ids.*obj-js/);
});

test("a duplicate box id INSIDE a subpatcher fails the build too", () => {
  // A subpatcher is its own id namespace, so this used to be unchecked - and the
  // floating-window codegen shipped two [inlet]s sharing one id for exactly as long
  // as nobody looked. Same malformed patcher, one level down.
  registerChain("dupe-sub", ({ boxes }) =>
    boxes.push({
      box: {
        id: "obj-sub",
        maxclass: "newobj",
        text: "p Inner",
        patcher: { boxes: [{ box: { id: "obj-in", maxclass: "inlet" } }, { box: { id: "obj-in", maxclass: "inlet" } }], lines: [] },
      },
    }),
  );
  expect(() => compile(null, { name: "dupe-sub-device", type: "midi", chains: ["dupe-sub"] })).toThrow(/subpatcher \[p Inner\].*obj-in/s);
});

test("an audio chain on a MIDI device says so, instead of wiring into a box that does not exist", () => {
  // A MIDI effect has no plugin~/plugout~ at all, so `ctx.audioIn()` has nothing to
  // hand back. Before, the chain conjured the endpoints and the device silently
  // became something the manifest never said it was.
  expect(() => compile(surface, { name: "oops", type: "midi", chains: ["lowpass"] })).toThrow(/asked for the signal path.*type "midi"/s);
});

test("a stage that forgets setAudioOut is bypassed, not silently mixed in", () => {
  // The honest failure mode of the new seam, pinned so it stays honest: a chain that
  // takes audioIn and never sets a tail leaves the path where it was. Its DSP is
  // simply not in the signal path - it does not get summed over the top of it.
  registerChain("orphan", (ctx) => {
    const [srcId, srcOut] = ctx.audioIn(0);
    ctx.boxes.push(box("obj-orphan", "*~ 0.5", { numinlets: 2, numoutlets: 1, outlettype: ["signal"] }));
    ctx.lines.push(line(srcId, srcOut, "obj-orphan", 0));
  });
  const c = compile(null, { name: "orphan-device", type: "audio", chains: ["orphan"] });
  expect(c.feeding("obj-plugout", 0)).toEqual(["obj-plugin"]);
});

/* ------------------------------------------------------------------ *
 * "samples" - the chain that ORIGINATES a sound
 * ------------------------------------------------------------------ */

const sampler = (chains = ["samples"], slots = ["preview"]) => compile(null, { name: "smp", type: "instrument", chains, slots });

/** The box text of one id, so a test can assert what Max will actually instantiate. */
const textOf = (c, id) => c.boxes.find((b) => b.box.id === id)?.box.text;

test("a sample slot is a named [buffer~], and the player refers to it by that name", () => {
  const c = sampler();
  // groove~ and buffer~ agree on the name or they are two unrelated objects, and
  // nothing in Max reports the mismatch: the preview simply plays silence.
  expect(textOf(c, "obj-samples-buf-preview")).toBe("buffer~ buf-smp-preview");
  expect(textOf(c, "obj-samples-info-preview")).toBe("info~ buf-smp-preview");
  expect(textOf(c, "obj-samples-set-preview")).toBe("set buf-smp-preview");
  expect(textOf(c, "obj-samples-groove")).toContain("groove~ buf-smp-preview 2");
});

test("a load goes through the WRAPPER, which is what resolves the path", () => {
  const c = sampler();
  // [buffer~] resolves a bare name against MAX'S SEARCH PATH, which does not contain
  // the device's folder - so `preview.wav`, freshly downloaded next to the .amxd,
  // reported "can't open" and the app's promise timed out. The wrapper resolves it
  // (the same way fetchToFile does) and hands it back on its aux outlet as one symbol,
  // spaces and all. So `buffer_load` must NOT be claimed from [jweb].
  expect(textOf(c, "obj-samples-route")).toBe("route buffer_play buffer_stop");
  expect(c.cords).toContainEqual({ src: "obj-js", out: 1, dst: "obj-samples-replaceroute", in: 0 });
  expect(textOf(c, "obj-samples-replaceroute")).toBe("route buffer_replace");
  expect(c.feeding("obj-samples-loadslot", 0)).toEqual(["obj-samples-replaceroute"]);
});

test("the buffer reports what it LOADED, from its read-completed outlet", () => {
  const c = sampler();
  // Outlet 1, not outlet 0: outlet 0 is a mouse position in the editing window. And
  // info~'s outlets fire right-to-left, so the sample rate (outlet 0) arrives LAST
  // and is the only one that may drive [pack]'s hot inlet - otherwise the message
  // goes out carrying the previous load's numbers.
  expect(c.cords).toContainEqual({ src: "obj-samples-buf-preview", out: 1, dst: "obj-samples-info-preview", in: 0 });
  const pack = "obj-samples-pack-preview";
  expect(c.cords).toContainEqual({ src: "obj-samples-info-preview", out: 0, dst: pack, in: 0 }); // sample rate, hot
  expect(c.cords).toContainEqual({ src: "obj-samples-info-preview", out: 6, dst: pack, in: 1 }); // duration ms
  expect(c.cords).toContainEqual({ src: "obj-samples-info-preview", out: 8, dst: pack, in: 2 }); // channels
  expect(textOf(c, "obj-samples-ready-preview")).toBe("prepend buffer_ready preview");
  expect(c.feeding("obj-jweb", 0)).toContain("obj-samples-ready-preview");
});

test("play sets the buffer BEFORE it starts it, through a trigger and not a fan-out", () => {
  const c = sampler();
  // Two cords out of one outlet fire in an order Max chooses. Starting the OLD buffer
  // and switching after is exactly the bug that reads as "it previewed the wrong
  // sample" - so the order is a [t b b], whose right outlet fires first.
  expect(c.feeding("obj-samples-set-preview", 0)).toEqual(["obj-samples-trig-preview"]);
  // [t b b b], firing right-to-left: assert the fold gate, then set the buffer, then start.
  expect(textOf(c, "obj-samples-trig-preview")).toBe("t b b b");
  expect(c.cords).toContainEqual({ src: "obj-samples-trig-preview", out: 2, dst: "obj-samples-chans-preview", in: 0 });
  expect(c.cords).toContainEqual({ src: "obj-samples-trig-preview", out: 1, dst: "obj-samples-set-preview", in: 0 });
  expect(c.cords).toContainEqual({ src: "obj-samples-trig-preview", out: 0, dst: "obj-samples-start-preview", in: 0 });
  for (const id of ["obj-samples-set-preview", "obj-samples-start-preview", "obj-samples-stopmsg"]) {
    expect(c.boxes.find((b) => b.box.id === id).box.maxclass).toBe("message");
    expect(c.feeding("obj-samples-groove", 0)).toContain(id);
  }
});

test("the preview SUMS into the signal path - it does not claim the stage", () => {
  const c = sampler();
  // A chain that makes its own sound and claimed the stage would silence whatever came
  // before it. The input goes into [+~]'s left inlet, the player into its right.
  for (const ch of [0, 1]) {
    const mix = `obj-samples-mix-${"lr"[ch]}`;
    expect(c.feeding(mix, 0)).toEqual(["obj-plugin"]);
    expect(c.feeding("obj-plugout", ch)).toEqual([mix]);
  }
  // L takes groove~ outlet 0 directly; R takes the mono-fold selector (see below).
  expect(c.feeding("obj-samples-mix-l", 1)).toEqual(["obj-samples-groove"]);
  expect(c.feeding("obj-samples-mix-r", 1)).toEqual(["obj-samples-rsel"]);
});

test("a MONO buffer folds to both ears - the R channel is gated by the measured channel count", () => {
  const c = sampler();
  // groove~ <buf> 2 puts a mono buffer on outlet 0 only, so R would be silent. A
  // [selector~ 2] picks the real R (groove~ outlet 1) for a stereo file and folds
  // outlet 0 into R for a mono one, driven by what [info~] MEASURED at load.
  expect(textOf(c, "obj-samples-rsel")).toBe("selector~ 2");
  expect(c.cords).toContainEqual({ src: "obj-samples-groove", out: 1, dst: "obj-samples-rsel", in: 1 }); // stereo R
  expect(c.cords).toContainEqual({ src: "obj-samples-groove", out: 0, dst: "obj-samples-rsel", in: 2 }); // mono fold
  // The control: the slot's channel count (info~ outlet 8, retained in [f]) mapped
  // mono(1)->2, stereo(2)->1. It must NOT go straight to the pack's numbers only.
  expect(textOf(c, "obj-samples-rgate")).toBe("expr ($i1==1)+1");
  expect(textOf(c, "obj-samples-chans-preview")).toBe("f");
  expect(c.cords).toContainEqual({ src: "obj-samples-info-preview", out: 8, dst: "obj-samples-chans-preview", in: 1 });
  expect(c.feeding("obj-samples-rgate", 0)).toEqual(["obj-samples-chans-preview"]);
  expect(c.feeding("obj-samples-rsel", 0)).toEqual(["obj-samples-rgate"]);
});

test("...and it still composes: an effect after it processes the sound it made", () => {
  const c = compile(surface, { name: "smp", type: "instrument", chains: ["samples", "lowpass"], slots: ["preview"] });
  expect(c.feeding("obj-lpf-l", 0)).toEqual(["obj-samples-mix-l"]);
  expect(c.feeding("obj-plugout", 0)).toEqual(["obj-lpf-l"]);
});

test("more than one slot is more than one buffer, dispatched by name", () => {
  const c = sampler(["samples"], ["kick", "snare"]);
  expect(c.count("buffer~ buf-smp-kick")).toBe(1);
  expect(c.count("buffer~ buf-smp-snare")).toBe(1);
  // One player, N buffers: groove~ takes `set <name>`. Both slots' route outlets have
  // to reach it, and the slot lives in the ARGUMENTS - `route kick snare` matches a
  // whole word, which is what makes that legal here.
  expect(c.count("groove~ buf-smp-kick 2 @loop 0")).toBe(1);
  expect(textOf(c, "obj-samples-loadslot")).toBe("route kick snare");
  expect(c.cords).toContainEqual({ src: "obj-samples-playslot", out: 1, dst: "obj-samples-trig-snare", in: 0 });
});

test("fanParamInto is a public export - a device's own chain drives DSP from a parameter", () => {
  // Not a codegen assertion but a CONTRACT one: `fanParamInto` is the one right way
  // to wire a parameter into the thing it controls (both the object's outlet AND the
  // route's, so the app's `set` write is not silently dropped). A sibling device repo
  // carried a hand-copied version until this became a real export - if it stops being
  // one, that copy is the bug it exists to prevent, back again with no error.
  expect(typeof fanParamInto).toBe("function");
});

test("the samples chain hands on what it did not match, in series with the next claimant", () => {
  // The wrapper still has to see `ui_ready`. A route hung off [jweb] in parallel
  // would deliver every unrouted message twice instead.
  const c = sampler(["samples", "download"]);
  expect(c.feeding("obj-samples-route", 0)).toEqual(["obj-jweb"]);
  expect(c.cords).toContainEqual({ src: "obj-samples-route", out: 2, dst: "obj-js", in: 0 });
  expect(c.feeding("obj-js", 0)).not.toContain("obj-jweb");
});
