/**
 * @vitest-environment happy-dom
 *
 * clipboard.test.ts - the "where did my file go" helper, and the lie it exists to stop.
 *
 * The whole module is one rule: inside jweb a copy can be CLAIMED but never CONFIRMED,
 * because `document.execCommand("copy")` returns true while copying nothing and
 * `navigator.clipboard.readText()` needs a secure context a `file://` page does not
 * have. So the assertions that matter are not "does it copy" - no test environment can
 * answer that - but "does it ever REPORT a copy it cannot prove". That is the bug that
 * shipped once, as a status line reading "Path copied" next to an empty paste.
 *
 * `inJweb` is read at call time from `window.max`, so each test sets or deletes it.
 */
import { afterEach, expect, test, vi } from "vitest";
import { copyMessage, copyPath, promptCopy } from "@m4l-jweb/bridge";

const PATH = "C:/Users/x/Music/Ableton/Project/samples";

/** Pretend to be a real jweb view (the bridge reads `window.max` to decide). */
const enterJweb = () => {
  (window as unknown as { max: unknown }).max = { bindInlet: () => {}, outlet: () => {} };
};

/**
 * `document.execCommand` is DEPRECATED and happy-dom does not implement it at all, so
 * it cannot be spied on - it has to be installed. Which is itself the point: the one
 * mechanism that does work inside jweb's Chromium is the one the platform has dropped,
 * and the module has to survive its absence as well as its lies.
 */
const stubExecCommand = (impl: (command: string) => boolean) => {
  const fn = vi.fn(impl);
  Object.defineProperty(document, "execCommand", { value: fn, configurable: true, writable: true });
  return fn;
};

afterEach(() => {
  delete (window as unknown as { max?: unknown }).max;
  delete (document as unknown as { execCommand?: unknown }).execCommand;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

/** The prompt is the only thing this module renders; find it the way a user would. */
const prompt = () => document.getElementById("m4l-copy-prompt");
const promptField = () => prompt()?.querySelector("input") as HTMLInputElement;

test("outside jweb, a clipboard write that resolves is reported as copied", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  stubExecCommand(() => false);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

  await expect(copyPath(PATH)).resolves.toBe("copied");
  expect(writeText).toHaveBeenCalledWith(PATH);
  // Nothing was shown: outside jweb the APIs are trustworthy and the user is not asked.
  expect(prompt()).toBeNull();
});

test("outside jweb, a clipboard write that rejects falls through to the prompt", async () => {
  stubExecCommand(() => false);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    configurable: true,
  });

  const result = copyPath(PATH);
  await vi.waitFor(() => expect(prompt()).not.toBeNull());
  promptField().dispatchEvent(new Event("copy"));
  await expect(result).resolves.toBe("manual");
});

test("INSIDE jweb, execCommand's true is not believed - the user is still asked", async () => {
  enterJweb();
  // This is exactly the state that produced the bug: the API says it worked.
  const execCommand = stubExecCommand(() => true);

  const result = copyPath(PATH);
  await vi.waitFor(() => expect(prompt()).not.toBeNull());
  expect(execCommand).toHaveBeenCalledWith("copy");
  expect(promptField().value).toBe(PATH);

  // ...and the outcome is "manual", earned by the browser's own copy event, never the
  // "copied" that execCommand claimed.
  promptField().dispatchEvent(new Event("copy"));
  await expect(result).resolves.toBe("manual");
});

test("INSIDE jweb, a successful navigator.clipboard write is not believed either", async () => {
  enterJweb();
  stubExecCommand(() => false);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  });

  const result = copyPath(PATH);
  await vi.waitFor(() => expect(prompt()).not.toBeNull());
  promptField().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  await expect(result).resolves.toBe("cancelled");
});

test("a missing clipboard API is a false, not an await on undefined", async () => {
  // The original bug in the fallback itself: `navigator.clipboard?.writeText(...)` on a
  // page with no clipboard API yields undefined, and `await undefined` RESOLVES - so
  // the attempt reported success precisely where there was nothing to succeed.
  Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
  stubExecCommand(() => false);

  const result = copyPath(PATH);
  await vi.waitFor(() => expect(prompt()).not.toBeNull());
  promptField().dispatchEvent(new Event("copy"));
  await expect(result).resolves.toBe("manual");
});

test("the copy attempt focuses before selecting, and cleans up after itself", async () => {
  enterJweb();
  const order: string[] = [];
  const execCommand = stubExecCommand(() => {
    order.push("execCommand");
    return true;
  });
  const focus = vi.spyOn(HTMLTextAreaElement.prototype, "focus").mockImplementation(() => {
    order.push("focus");
  });
  const select = vi.spyOn(HTMLTextAreaElement.prototype, "select").mockImplementation(() => {
    order.push("select");
  });

  const result = copyPath(PATH);
  await vi.waitFor(() => expect(prompt()).not.toBeNull());

  // select() alone leaves the selection unowned in CEF and copies nothing.
  expect(order).toEqual(["focus", "select", "execCommand"]);
  expect(focus).toHaveBeenCalled();
  expect(select).toHaveBeenCalled();
  expect(execCommand).toHaveBeenCalled();
  // The scratch textarea does not outlive the attempt.
  expect(document.querySelectorAll("textarea")).toHaveLength(0);

  promptField().dispatchEvent(new Event("copy"));
  await result;
});

test("the prompt cancels on the close button and on a click outside, but NOT on blur", async () => {
  const closed = promptCopy(PATH);
  const box = prompt() as HTMLElement;
  // Focus can be lost to Max itself; a field that vanishes when you look away is
  // a field you cannot use.
  promptField().dispatchEvent(new Event("blur"));
  expect(prompt()).not.toBeNull();

  (box.querySelector("button") as HTMLButtonElement).click();
  await expect(closed).resolves.toBe("cancelled");
  expect(prompt()).toBeNull();

  const outside = promptCopy(PATH);
  const box2 = prompt() as HTMLElement;
  const down = new MouseEvent("mousedown", { bubbles: true });
  box2.dispatchEvent(down);
  await expect(outside).resolves.toBe("cancelled");
});

test("a click INSIDE the prompt does not cancel it", async () => {
  const open = promptCopy(PATH);
  let settled = false;
  void open.then(() => (settled = true));

  promptField().dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  await Promise.resolve();
  expect(settled).toBe(false);
  expect(prompt()).not.toBeNull();

  promptField().dispatchEvent(new Event("copy"));
  await expect(open).resolves.toBe("manual");
});

test("only one prompt exists at a time", async () => {
  const first = promptCopy("first");
  const second = promptCopy("second");
  expect(document.querySelectorAll("#m4l-copy-prompt")).toHaveLength(1);
  expect(promptField().value).toBe("second");

  promptField().dispatchEvent(new Event("copy"));
  await expect(second).resolves.toBe("manual");
  // The displaced promise is left to the caller that owns it; what matters is that the
  // DOM never carries two.
  void first;
});

test("the message never claims a copy that did not happen", () => {
  expect(copyMessage("copied", PATH)).toBe(`Path copied: ${PATH}`);
  expect(copyMessage("manual", PATH)).toBe(`Path copied: ${PATH}`);
  expect(copyMessage("cancelled", PATH)).toBe(`Not copied - the folder is ${PATH}`);
  expect(copyMessage("cancelled", PATH)).not.toContain("copied:");
});
