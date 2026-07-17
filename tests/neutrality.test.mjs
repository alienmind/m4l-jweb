/**
 * neutrality.test.mjs - the NEUTRALITY CONTRACT (doc/TODO.md item 2A).
 *
 * The DSP graph is written at BUILD time and every stage is ALWAYS in the signal
 * path, whether or not a device's line names it. That is only honest if each stage
 * has a setting where it is bit-for-bit a wire - otherwise a rack with a reverb in
 * it is a rack you cannot switch off, and nobody can find the colouration.
 *
 * The wet/dry chains (`delay`, `reverb`) reach neutral by SUMMING a wet branch,
 * scaled by a mix parameter, onto a dry path they leave at unity. At mix = 0 the
 * output is `dry + 0` - a null-test we can run with no Max in the loop, by tracing
 * the graph: the dry wire must survive at unity, and every other path into the
 * output must pass through the gain-0 mix. cverb~ being wet-only, this dry/wet is a
 * property of the CHAIN, and this file is what pins that it stays one.
 *
 * These patchers come through `composePatcher()` - the build's own pipeline.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { expect, test } from "vitest";

import { composePatcher } from "@m4l-jweb/build";
import { CHAIN_NEUTRAL, WET_DRY_CHAINS } from "@m4l-jweb/build/chains";
import { defineSurface, dial } from "@m4l-jweb/surface";

const require = createRequire(import.meta.url);
const BASE = path.join(path.dirname(require.resolve("@m4l-jweb/build")), "..", "templates", "base.json");

function compile(surface, device) {
  const base = JSON.parse(readFileSync(BASE, "utf8"));
  const { patcher } = composePatcher(base, { name: "fx", ...device }, surface);
  const { boxes, lines } = patcher;
  const cords = lines.map(({ patchline: pl }) => ({ src: pl.source[0], out: pl.source[1], dst: pl.destination[0], in: pl.destination[1] }));
  return {
    boxes,
    cords,
    textOf: (id) => boxes.find((b) => b.box.id === id)?.box.text,
    feeding: (dstId, dstIn) => cords.filter((c) => c.dst === dstId && c.in === dstIn).map((c) => c.src),
  };
}

/** m4l-strudel's `fx` parameters - the ones the delay/reverb chains require. */
const surface = defineSurface({
  params: {
    cutoff: dial({ range: [40, 18000], unit: "Hz", exponent: 4, default: 18000, short: "Cutoff" }),
    hpfreq: dial({ range: [0, 8000], unit: "Hz", exponent: 4, default: 0, short: "HP Freq" }),
    drive: dial({ range: [1, 10], unit: "x", default: 1, short: "Drive" }),
    crush: dial({ range: [1, 24], unit: "bit", default: 24, short: "Crush" }),
    delay: dial({ range: [0, 1], default: 0, short: "Delay" }),
    delaytime: dial({ range: [1, 2000], unit: "ms", default: 250, short: "Dly Time" }),
    delayfeedback: dial({ range: [0, 1], default: 0, short: "Feedback" }),
    room: dial({ range: [0, 1], default: 0, short: "Room" }),
    gain: dial({ range: [0, 2], default: 1, short: "Gain" }),
  },
});

const audio = (chains) => compile(surface, { name: "fx", type: "audio", chains });

/* ------------------------------------------------------------------ *
 * delay
 * ------------------------------------------------------------------ */

test("delay is a send: the dry input reaches the output at unity, the tap is scaled on top", () => {
  const c = audio(["delay"]);
  for (const s of ["l", "r"]) {
    const [ch] = s === "l" ? [0] : [1];
    const mix = `obj-delay-mix-${s}`;
    // Output summing node fed by exactly two sources: the dry wire and the wet gain.
    expect(c.textOf(mix)).toBe("+~");
    expect(c.feeding(mix, 0)).toEqual(["obj-plugin"]); // dry, straight off the input, unity
    expect(c.feeding(mix, 1)).toEqual([`obj-delay-wet-${s}`]); // the only other path
    expect(c.feeding("obj-plugout", ch)).toEqual([mix]);
  }
});

test("delay's wet gain IS the `delay` parameter, and it is neutral at 0", () => {
  const c = audio(["delay"]);
  // The wet [*~]'s right inlet is fed from BOTH the parameter object and the route -
  // the fan-out that keeps the app's `set` write from being silently dropped.
  const sources = c.feeding("obj-delay-wet-l", 1).sort();
  expect(sources).toEqual(["obj-param-delay", "obj-surface-route"].sort());
  // ...and the declared neutral is 0: wet * 0 = silence, output = dry.
  expect(CHAIN_NEUTRAL.delay.delay).toBe(0);
});

test("delay's line, time and feedback are wired where Max's reference says", () => {
  const c = audio(["delay"]);
  // tapin~ sized to the top of delaytime's range; the connection to tapout~ is the
  // delay-line link, and delay time rides the same inlet.
  expect(c.textOf("obj-delay-tapin-l")).toBe("tapin~ 2000");
  expect(c.textOf("obj-delay-tapout-l")).toBe("tapout~ 250");
  expect(c.feeding("obj-delay-tapout-l", 0)).toContain("obj-delay-tapin-l");
  expect(c.feeding("obj-delay-tapout-l", 0)).toContain("obj-param-delaytime");
  // feedback closes the loop THROUGH the pre-tapin sum, not by replacing the input.
  expect(c.textOf("obj-delay-fbsum-l")).toBe("+~");
  expect(c.feeding("obj-delay-fbsum-l", 0)).toEqual(["obj-plugin"]); // dry
  expect(c.feeding("obj-delay-fbsum-l", 1)).toEqual(["obj-delay-fb-l"]); // + feedback
  expect(c.feeding("obj-delay-tapin-l", 0)).toEqual(["obj-delay-fbsum-l"]);
  expect(c.feeding("obj-delay-fb-l", 1).sort()).toEqual(["obj-param-delayfeedback", "obj-surface-route"].sort());
});

/* ------------------------------------------------------------------ *
 * reverb
 * ------------------------------------------------------------------ */

test("reverb is a send too: cverb~ is wet-only, so the dry/wet lives in the chain", () => {
  const c = audio(["reverb"]);
  for (const s of ["l", "r"]) {
    const [ch] = s === "l" ? [0] : [1];
    const mix = `obj-reverb-mix-${s}`;
    expect(c.textOf(`obj-reverb-cverb-${s}`)).toBe("cverb~ 2000.");
    expect(c.feeding(`obj-reverb-cverb-${s}`, 0)).toEqual(["obj-plugin"]); // reverb sees the dry
    expect(c.feeding(mix, 0)).toEqual(["obj-plugin"]); // ...and the dry ALSO reaches the output at unity
    expect(c.feeding(mix, 1)).toEqual([`obj-reverb-wet-${s}`]);
    expect(c.feeding("obj-plugout", ch)).toEqual([mix]);
  }
  const sources = c.feeding("obj-reverb-wet-l", 1).sort();
  expect(sources).toEqual(["obj-param-room", "obj-surface-route"].sort());
  expect(CHAIN_NEUTRAL.reverb.room).toBe(0);
});

/* ------------------------------------------------------------------ *
 * hpf
 * ------------------------------------------------------------------ */

test("hpf is the lowpass's complement: dry at unity MINUS the low end", () => {
  const c = audio(["hpf"]);
  for (const s of ["l", "r"]) {
    const [ch] = s === "l" ? [0] : [1];
    const lp = `obj-hpf-lp-${s}`;
    const sub = `obj-hpf-sub-${s}`;
    // The highpass IS dry - lowpass(dry). A subtraction, not a mix: the dry reaches
    // the LEFT inlet at unity and the only other path is the lowpass being removed.
    expect(c.textOf(sub)).toBe("-~");
    expect(c.feeding(sub, 0)).toEqual(["obj-plugin"]); // dry, straight off the input
    expect(c.feeding(sub, 1)).toEqual([lp]); // minus the low end, nothing else
    expect(c.feeding(lp, 0)).toEqual(["obj-plugin"]); // the filter sees the same dry
    expect(c.feeding("obj-plugout", ch)).toEqual([sub]);
  }
});

test("hpf's cutoff IS the `hpfreq` parameter, and 0 Hz is the wire", () => {
  const c = audio(["hpf"]);
  // A one-pole lowpass at 0 Hz passes nothing, so `dry - 0` is the input, bit for
  // bit. That is what makes 0 a real neutral rather than a quiet colouration.
  expect(c.textOf("obj-hpf-lp-l")).toBe("onepole~ 0.");
  expect(CHAIN_NEUTRAL.hpf.hpfreq).toBe(0);
  const sources = c.feeding("obj-hpf-lp-l", 1).sort();
  expect(sources).toEqual(["obj-param-hpfreq", "obj-surface-route"].sort());
});

/* ------------------------------------------------------------------ *
 * crush
 * ------------------------------------------------------------------ */

test("crush drives degrade~'s bit depth only, and rests at full depth", () => {
  const c = audio(["crush"]);
  for (const s of ["l", "r"]) {
    const [ch] = s === "l" ? [0] : [1];
    const id = `obj-crush-${s}`;
    // Rate ratio 1.0 (untouched) and 24 bits: the arguments ARE the neutral, so the
    // stage is a wire before any parameter loads.
    expect(c.textOf(id)).toBe("degrade~ 1. 24.");
    expect(c.feeding(id, 0)).toEqual(["obj-plugin"]);
    expect(c.feeding("obj-plugout", ch)).toEqual([id]);
    // Inlet 1 is the sample-rate ratio and NOTHING may drive it - that is `.coarse()`,
    // a different effect. If a chain ever fans a parameter in here, crush silently
    // becomes two effects on one knob.
    expect(c.feeding(id, 1)).toEqual([]);
  }
  // The depth rides inlet 2, from both the dial and the app's write.
  expect(c.feeding("obj-crush-l", 2).sort()).toEqual(["obj-param-crush", "obj-surface-route"].sort());
  // NOT Strudel's 16: 16-bit quantisation is a quiet crush, not a wire.
  expect(CHAIN_NEUTRAL.crush.crush).toBe(24);
});

/* ------------------------------------------------------------------ *
 * the contract itself
 * ------------------------------------------------------------------ */

test("every wet/dry chain declares a neutral mix of exactly 0 - its OWN dry/wet", () => {
  // The load-bearing half: a wet-only stage has no neutral without a dry/wet it
  // carries itself. If one is ever added without a 0 neutral, it is an always-on
  // colouration a device cannot switch off - which is the bug this contract forbids.
  for (const name of WET_DRY_CHAINS) {
    const neutral = CHAIN_NEUTRAL[name];
    expect(neutral, `wet/dry chain "${name}" must declare a neutral in CHAIN_NEUTRAL`).toBeDefined();
    const values = Object.values(neutral);
    expect(values.length, `"${name}" must declare its mix parameter's neutral`).toBeGreaterThan(0);
    expect(values, `"${name}" is not neutral: a wet/dry stage is a wire only at mix 0`).toContain(0);
  }
});

test("the frozen FX order composes as a series, each stage feeding the next", () => {
  // filter -> drive -> delay -> reverb -> gain, the order chosen once (doc/TODO.md 2A).
  const c = audio(["lowpass", "drive", "delay", "reverb", "gain"]);
  expect(c.feeding("obj-lpf-l", 0)).toEqual(["obj-plugin"]);
  expect(c.feeding("obj-drive-l", 0)).toEqual(["obj-lpf-l"]);
  expect(c.feeding("obj-delay-fbsum-l", 0)).toEqual(["obj-drive-l"]); // delay's dry is drive's output
  expect(c.feeding("obj-delay-mix-l", 0)).toEqual(["obj-drive-l"]);
  expect(c.feeding("obj-reverb-mix-l", 0)).toEqual(["obj-delay-mix-l"]); // reverb's dry is delay's output
  expect(c.feeding("obj-gain-l", 0)).toEqual(["obj-reverb-mix-l"]);
  expect(c.feeding("obj-plugout", 0)).toEqual(["obj-gain-l"]);
});

test("hpf and crush take their place in the series without disturbing it", () => {
  // The frozen order with both siblings in: each sits next to the stage it is the
  // cheap sibling of - hpf after lowpass (the filter section), crush after drive
  // (the dirt section), and the send/level tail is untouched.
  const c = audio(["lowpass", "hpf", "drive", "crush", "delay", "reverb", "gain"]);
  expect(c.feeding("obj-lpf-l", 0)).toEqual(["obj-plugin"]);
  // hpf's BOTH inputs move to the previous stage's output - the dry it subtracts from
  // and the low end it subtracts must be the same signal, or it stops being a
  // complement and starts being a comb filter.
  expect(c.feeding("obj-hpf-lp-l", 0)).toEqual(["obj-lpf-l"]);
  expect(c.feeding("obj-hpf-sub-l", 0)).toEqual(["obj-lpf-l"]);
  expect(c.feeding("obj-drive-l", 0)).toEqual(["obj-hpf-sub-l"]);
  expect(c.feeding("obj-crush-l", 0)).toEqual(["obj-drive-l"]);
  expect(c.feeding("obj-delay-fbsum-l", 0)).toEqual(["obj-crush-l"]);
  expect(c.feeding("obj-delay-mix-l", 0)).toEqual(["obj-crush-l"]);
  expect(c.feeding("obj-reverb-mix-l", 0)).toEqual(["obj-delay-mix-l"]);
  expect(c.feeding("obj-gain-l", 0)).toEqual(["obj-reverb-mix-l"]);
  expect(c.feeding("obj-plugout", 0)).toEqual(["obj-gain-l"]);
});
