/**
 * knob-pool.test.ts - `knobPool(n)`, and the reason its KEYS are load-bearing.
 *
 * A pool is how a device declares controls it cannot know at build time: a frozen
 * `.amxd` cannot grow a `live.dial` when the user's pattern asks for a cutoff, so it
 * reserves eight and lends them out. The runtime half of that is small and obvious.
 *
 * The typing half is neither, and it is what this file exists for. `knobPool` is
 * SPREAD into a surface (`params: { ...transportParams, ...knobPool(8) }`), and a
 * spread of `Record<string, DialSpec>` collapses `keyof P` to the keys that were
 * written out longhand. The declaration still compiles and the device still builds -
 * but `useParam(surface, "s3")` and every `layout.native.params` entry naming a pool
 * dial stop being checked against it, which is exactly the class of name Max will
 * accept and silently ignore. Caught by adopting the pool in a real device.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { expect, expectTypeOf, test } from "vitest";

import { composePatcher } from "@m4l-jweb/build";
import { button, defineSurface, knobPool } from "@m4l-jweb/surface";
import type { DialSpec } from "@m4l-jweb/surface";

const require = createRequire(import.meta.url);
const BASE = path.join(path.dirname(require.resolve("@m4l-jweb/build")), "..", "templates", "base.json");

/** A pool device, declared the way a real one is: longhand params, then the spread. */
const pooled = defineSurface({
  params: {
    transport: button({ default: false, label: "Back", short: "Back" }),
    ...knobPool(8),
  },
  layout: { native: { params: ["transport", "s1", "s8"], rows: [1, 2], panel: true, switch: "transport" } },
});

test("the pool declares one 0..1 dial per slot, named for Push", () => {
  const pool = knobPool(8);
  expect(Object.keys(pool)).toEqual(["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"]);
  for (const [id, spec] of Object.entries(pool)) {
    expect(spec.kind).toBe("dial");
    // A borrower's real range is not known at build time, so the dial carries travel
    // and the page scales. `describeParam` widens it later, if Live takes it.
    expect(spec.range).toEqual([0, 1]);
    expect(spec.default).toBe(0);
    // What Push prints before anything has borrowed the slot.
    expect(spec.short).toBe(id.toUpperCase());
  }
});

test("a prefix renames both the ids and the shortnames", () => {
  const pool = knobPool(3, "fx");
  expect(Object.keys(pool)).toEqual(["fx1", "fx2", "fx3"]);
  expect(pool.fx2.short).toBe("FX2");
});

test("the KEYS survive the spread, so a pool dial can be named elsewhere", () => {
  // The regression: with `Record<string, DialSpec>` this is `"transport"` alone, and
  // every reference to a pool dial silently stops being checked.
  expectTypeOf<keyof typeof pooled.params>().toEqualTypeOf<
    "transport" | "s1" | "s2" | "s3" | "s4" | "s5" | "s6" | "s7" | "s8"
  >();
  expectTypeOf(knobPool(8)).toEqualTypeOf<Record<"s1" | "s2" | "s3" | "s4" | "s5" | "s6" | "s7" | "s8", DialSpec>>();
  expectTypeOf(knobPool(2, "fx")).toEqualTypeOf<Record<"fx1" | "fx2", DialSpec>>();
});

test("a spread pool compiles to real live.dial objects", () => {
  const base = JSON.parse(readFileSync(BASE, "utf8"));
  const { patcher } = composePatcher(base, { name: "test", type: "audio", chains: [] }, pooled);
  const find = (id: string) => patcher.boxes.find((b: { box: { id: string } }) => b.box.id === id)?.box;

  for (let i = 1; i <= 8; i++) {
    const dial = find(`obj-param-s${i}`);
    expect(dial, `s${i} produced no object`).toBeTruthy();
    expect(dial.maxclass).toBe("live.dial");
    // Without this the dial is not a Live parameter at all: no automation lane, no
    // MIDI map, nothing on Push - and no error either.
    expect(dial.parameter_enable).toBe(1);
  }
});
