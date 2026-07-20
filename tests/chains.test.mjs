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
import { REMOTE_RAMP_MS, box, fanParamInto, line, registerChain } from "@m4l-jweb/build/chains";
import { defineSurface, dial } from "@m4l-jweb/surface";

const require = createRequire(import.meta.url);
const BASE = path.join(path.dirname(require.resolve("@m4l-jweb/build")), "..", "templates", "base.json");

function compile(surface, device) {
  const base = JSON.parse(readFileSync(BASE, "utf8"));
  const result = composePatcher(base, { name: "test", ...device }, surface);
  const { patcher } = result;
  const { boxes, lines } = patcher;
  const cords = lines.map(({ patchline: pl }) => ({ src: pl.source[0], out: pl.source[1], dst: pl.destination[0], in: pl.destination[1] }));
  return {
    boxes,
    cords,
    /** Frozen dependencies a chain contributed (a [poly~] voice patch, say). */
    extras: result.extras ?? [],
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
 * "remote" - live.remote~ modulation, bound by LOM id
 * ------------------------------------------------------------------ */

// No surface: `remote` drives Live parameters by LOM id, not parameters of its own, so
// it needs none - and without one the claim chain is short enough to assert on directly.
const remote = (device = {}) => compile(null, { name: "fx", type: "audio", chains: ["remote"], remotes: 2, ...device });

test("a remote slot is a live.remote~ fed by a RAMP, not by the value itself", () => {
  const c = remote();
  // The [line~] is the point of the chain: the app can only send a value per tick, and
  // a bare number into live.remote~ steps exactly as audibly as a parameter write. The
  // pack carries the ramp time with every value, so each one is slid to, not jumped to.
  expect(c.boxes.find((b) => b.box.id === "obj-remote-pack-0").box.text).toBe(`pack f ${REMOTE_RAMP_MS}`);
  expect(c.boxes.find((b) => b.box.id === "obj-remote-line-0").box.text).toBe("line~");
  expect(c.boxes.find((b) => b.box.id === "obj-remote-0").box.text).toBe("live.remote~");
  expect(c.feeding("obj-remote-pack-0", 0)).toEqual(["obj-remote-valroute"]);
  expect(c.feeding("obj-remote-line-0", 0)).toEqual(["obj-remote-pack-0"]);
  // The SIGNAL reaches live.remote~. Nothing else may - a number arriving here direct
  // from the app would be the stepping this chain exists to remove.
  expect(c.feeding("obj-remote-0", 0).sort()).toEqual(["obj-remote-bind-0", "obj-remote-line-0"].sort());
});

test("a slot is bound by LOM id, with the `id` message live.remote~ asks for", () => {
  const c = remote();
  expect(c.boxes.find((b) => b.box.id === "obj-remote-bind-0").box.text).toBe("prepend id");
  expect(c.feeding("obj-remote-bind-0", 0)).toEqual(["obj-remote-bindroute"]);
  expect(c.feeding("obj-remote-bind-1", 0)).toEqual(["obj-remote-bindroute"]);
});

test("`remotes: n` is n independent slots, each dispatched by its own index", () => {
  const c = remote({ remotes: 3 });
  // One route dispatches every slot: the selector is stripped by the first route, so
  // the slot INDEX is the first word by the time it gets here.
  expect(c.boxes.find((b) => b.box.id === "obj-remote-valroute").box.text).toBe("route 0 1 2");
  expect(c.boxes.find((b) => b.box.id === "obj-remote-bindroute").box.text).toBe("route 0 1 2");
  expect(c.count("live.remote~")).toBe(3);
  // Each slot's value lands on ITS OWN live.remote~ and no other - crossed cords here
  // would modulate the wrong parameter, which is not a thing you would find by ear.
  for (const slot of [0, 1, 2]) {
    expect(c.feeding(`obj-remote-${slot}`, 0).sort()).toEqual([`obj-remote-bind-${slot}`, `obj-remote-line-${slot}`].sort());
  }
});

test("remote takes NO audio stage - it composes without touching the signal path", () => {
  // It modulates; it does not process. An effect either side of it in the list must
  // still be wired to each other, or adding modulation would silently bypass a stage.
  const c = compile(surface, { name: "fx", type: "audio", chains: ["lowpass", "remote", "gain"], remotes: 1 });
  expect(c.feeding("obj-lpf-l", 0)).toEqual(["obj-plugin"]);
  expect(c.feeding("obj-gain-l", 0)).toEqual(["obj-lpf-l"]);
  expect(c.feeding("obj-plugout", 0)).toEqual(["obj-gain-l"]);
});

test("remote hands on what it did not match, in series with the next claimant", () => {
  // Same law as every other claimant: the wrapper still has to see `ui_ready`.
  const c = remote();
  expect(c.feeding("obj-remote-route", 0)).toEqual(["obj-jweb"]);
  expect(c.cords).toContainEqual({ src: "obj-remote-route", out: 2, dst: "obj-js", in: 0 });
  expect(c.feeding("obj-js", 0)).not.toContain("obj-jweb");
});

test("a remote chain with no `remotes` count fails the build, rather than doing nothing", () => {
  // 0 slots generates no live.remote~ at all: a device that builds, loads, and silently
  // ignores every modulation it sends. The loudest possible failure is a build error.
  expect(() => compile(null, { name: "fx", type: "audio", chains: ["remote"] })).toThrow(/needs `remotes: <n>`/);
  expect(() => compile(null, { name: "fx", type: "audio", chains: ["remote"], remotes: 0 })).toThrow(/needs `remotes: <n>`/);
});
