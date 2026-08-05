/**
 * @vitest-environment happy-dom
 *
 * page-console.test.ts - the page's only voice.
 *
 * A page inside `[jweb]` has no console anyone can read: devtools cannot be opened in
 * Live, and a `file://` page cannot write a log file. So when a user reports "the
 * buttons do nothing", the question is whether a press produces a message AT ALL - and
 * from Max, a message that was never sent and a message nobody handles look identical.
 *
 * These pin the two things that answer it: every outbound selector names itself, and
 * the page says what viewport Chromium actually gave it.
 */
import { afterEach, expect, test } from "vitest";
import { logToMax, outlet, uiReady } from "@m4l-jweb/bridge";

/** Everything the page sent, as Max would receive it. */
let sent: unknown[][] = [];

const enterJweb = () => {
  sent = [];
  (window as unknown as { max: unknown }).max = { bindInlet: () => {}, outlet: (...a: unknown[]) => sent.push(a) };
};

afterEach(() => {
  delete (window as unknown as { max?: unknown }).max;
});

test("every outbound selector echoes itself into the Max console", () => {
  enterJweb();
  outlet("write_clip", 4, "notes");
  expect(sent).toContainEqual(["write_clip", 4, "notes"]);
  expect(sent).toContainEqual(["page_log", "-> write_clip"]);
});

test("the echo skips what a keystroke or a knob repeats", () => {
  enterJweb();
  outlet("sync_state", "code", "{}");
  outlet("save_chunk", "r1", "AAAA");
  // The message still goes; only the echo is withheld, because an instrument that is
  // too expensive to leave on gets turned off before the report that needed it.
  expect(sent.filter(([sel]) => sel === "page_log")).toEqual([]);
  expect(sent.length).toBe(2);
});

test("logToMax does not echo itself, which would not terminate", () => {
  enterJweb();
  logToMax("hello", 42);
  expect(sent).toEqual([["page_log", "hello 42"]]);
});

test("ui_ready reports the viewport, the pixel ratio and the screen", () => {
  enterJweb();
  uiReady();
  const metrics = sent.find(([sel]) => sel === "page_metrics");
  expect(metrics).toBeDefined();
  const [, w, h, dpr] = metrics as [string, number, number, number];
  // The values come from the environment; what is pinned is that all of them travel,
  // as numbers, in this order - the wrapper prints them positionally.
  expect(typeof w).toBe("number");
  expect(typeof h).toBe("number");
  expect(typeof dpr).toBe("number");
});

test("outside jweb nothing is sent, so the dev harness stays quiet", () => {
  sent = [];
  logToMax("nobody is listening");
  expect(sent).toEqual([]);
});

test("the environment block names the display, the window and the agent", () => {
  enterJweb();
  uiReady();
  const lines = sent.filter(([sel]) => sel === "page_log").map(([, text]) => String(text));
  const env = lines.join("\n");
  // Which display the window is on is the first suspect when one machine is wrong and
  // another, same build, is not - a second monitor puts `at=` beyond the primary width.
  expect(env).toMatch(/env window .*inner=\d+x\d+ .*at=-?\d+,-?\d+/);
  expect(env).toMatch(/env screen \d+x\d+ .*dpr=/);
  expect(env).toContain("env agent");
});
