/**
 * param-range.test.ts - why `describeParam` does not widen a dial unless asked.
 *
 * `_parameter_range` takes at runtime, and 1.1.0 shipped on that. What it costs was
 * measured later, in Live: a dial whose range has been widened STOPS FOLLOWING ITS
 * AUTOMATION LANE AND ANY RACK MACRO MAPPED TO IT. Both go on writing the parameter in
 * the BUILD-TIME domain the frozen device gave them, so a macro at 0.5 puts 0.5 into a
 * parameter now spanning 200..2000 and the dial sits at the bottom and never moves. A
 * sibling dial in the same device, left at 0..1, responds normally - which is what
 * isolates the cause to the widening rather than to the renaming that went with it.
 *
 * There is no error, no console line and no failed attribute write, so nothing but a
 * test can hold this: the default has to stay OFF, and `widenRange` has to remain the
 * only way to turn it on.
 */
import { afterEach, expect, test, vi } from "vitest";
import { describeParam, tapMessages } from "@m4l-jweb/bridge";

/** Every message the bridge sent during `fn`, as `[selector, ...args]`. */
function sent(fn: () => void): unknown[][] {
  const out: unknown[][] = [];
  const stop = tapMessages(({ direction, selector, args }) => {
    if (direction === "out") out.push([selector, ...args]);
  });
  try {
    fn();
  } finally {
    stop();
  }
  return out;
}

const selectors = (messages: unknown[][]) => messages.map((m) => String(m[0]));

afterEach(() => vi.restoreAllMocks());

test("a range alone is DESCRIPTIVE - the dial is not widened", () => {
  const messages = sent(() => describeParam("s1", { name: "lpf", range: [200, 2000] }));
  expect(selectors(messages)).toContain("param_label");
  // The regression this file exists for. One line, and it costs the dial its
  // automation lane.
  expect(selectors(messages)).not.toContain("param_range");
});

test("widenRange is the only way to ask for it", () => {
  const messages = sent(() => describeParam("s1", { name: "lpf", range: [200, 2000], widenRange: true }));
  expect(messages).toContainEqual(["param_range", "s1", 200, 2000]);
});

test("an empty or inverted range is never sent, even when asked for", () => {
  // The wrapper rejects these too, but a `param_range s1 600 600` on the wire is a
  // question that should not have been asked.
  expect(selectors(sent(() => describeParam("s1", { range: [600, 600], widenRange: true })))).not.toContain("param_range");
  expect(selectors(sent(() => describeParam("s1", { range: [2000, 200], widenRange: true })))).not.toContain("param_range");
});

test("name and unit are unaffected - they were never the problem", () => {
  // Renaming is what an earlier spike blamed; the sibling dial that kept working had
  // been renamed too. Both still go out with no widening.
  const messages = sent(() => describeParam("s1", { name: "cutoff", unit: "Hz", range: [200, 2000] }));
  expect(messages).toContainEqual(["param_label", "s1", "cutoff"]);
  expect(messages).toContainEqual(["param_unit", "s1", "Hz"]);
  expect(selectors(messages)).not.toContain("param_range");
});

test("nothing is sent for a description that says nothing", () => {
  expect(sent(() => describeParam("s1", {}))).toHaveLength(0);
});
