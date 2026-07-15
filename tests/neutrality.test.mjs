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
    drive: dial({ range: [1, 10], unit: "x", default: 1, short: "Drive" }),
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
