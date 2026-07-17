/**
 * watch-codegen.test.mjs - what defineWatch() compiles to, and what the wrapper
 * does with it.
 *
 * A watch is the read-only twin of a parameter: declared once, the build injects
 * WATCH_SPECS, and the packaged wrapper attaches a LiveAPI observer per entry FROM
 * bang() - the one place LiveAPI is not dead (hard rule 4). This pins the two seams
 * that make that work and are both silent when wrong:
 *
 *   1. the banner the build emits carries the key/path/property (and NOT the
 *      app-only default), or "" for a device with no watches - exactly the shape
 *      the wrapper's `typeof WATCH_SPECS === "undefined"` guard expects;
 *   2. the shipped wrapper, given that banner, creates the observers on bang() and
 *      resends each current value on ui_ready as `watch_<key>`.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { beforeAll, expect, test } from "vitest";

import { buildWrapper } from "@m4l-jweb/build";
import { watchSpecsBanner } from "@m4l-jweb/build/watch";
import { defineWatch, watch } from "@m4l-jweb/surface";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* ------------------------------------------------------------------ *
 * The declaration and its banner
 * ------------------------------------------------------------------ */

test("the banner carries key/path/property, and drops the app-only default", () => {
  const w = defineWatch({
    watches: {
      scale: watch({ path: "live_set", property: "scale_name", default: "C" }),
      tempo: watch({ path: "live_set", property: "tempo", default: 120 }),
    },
  });
  const banner = watchSpecsBanner(w);
  const specs = JSON.parse(banner.replace(/^var WATCH_SPECS = /, "").replace(/;\n$/, ""));

  expect(specs).toEqual([
    { key: "scale", path: "live_set", property: "scale_name" },
    { key: "tempo", path: "live_set", property: "tempo" },
  ]);
  // The default seeds useWatch before Live replies; it is the app's business and
  // has no reason to bloat every .amxd. It must not be in the wire shape.
  expect(banner).not.toContain("default");
  expect(banner).not.toContain("120");
});

test("a device with no watches emits nothing, so WATCH_SPECS stays undefined", () => {
  expect(watchSpecsBanner(null)).toBe("");
  expect(watchSpecsBanner(defineWatch({ watches: {} }))).toBe("");
});

test("a key with whitespace is refused - it would become a selector Max splits", () => {
  // watch_<key> is dispatched on the first word; a space in the key would land the
  // message on a handler no device has. Fail at declaration, where it is cheap.
  expect(() => defineWatch({ watches: { "bad key": watch({ path: "live_set", property: "tempo", default: 0 }) } })).toThrow(/whitespace/);
});

test("an empty path or property is refused - an observer attached to nothing is silent", () => {
  expect(() => defineWatch({ watches: { x: watch({ path: "", property: "tempo", default: 0 }) } })).toThrow(/path/);
  expect(() => defineWatch({ watches: { x: watch({ path: "live_set", property: "", default: 0 }) } })).toThrow(/property/);
});

/* ------------------------------------------------------------------ *
 * The shipped wrapper, driven by the banner
 *
 * The same approach wrapper-max.test.mjs uses: load the REAL concatenated wrapper
 * into a fake Max, but prepend a WATCH_SPECS banner first - which is exactly what
 * the build's packageDevices() does per device.
 * ------------------------------------------------------------------ */

let wrapperSrc = "";
beforeAll(() => {
  const built = path.join(root, "dist", "wrapper", "wrapper.js");
  if (!existsSync(built)) buildWrapper(root);
  wrapperSrc = readFileSync(built, "utf8");
});

function bootWithWatches(specs) {
  const dir = mkdtempSync(path.join(tmpdir(), "m4l-watch-"));
  const posts = [];
  const sent = [];
  /** Every LiveAPI made with an observer callback: [path, property]. */
  const observers = [];

  const ctx = {
    patcher: { filepath: `${dir}/device.amxd` },
    post: (...a) => posts.push(a.join("")),
    outlet: (n, ...a) => sent.push([n, ...a]),
    messnamed: () => {},
    arrayfromargs: (args) => [...args],
    jsarguments: ["wrapper.js", "midi"],
    autowatch: 0,
    inlets: 1,
    outlets: 2,
    Dict: class {
      constructor(n) {
        this.name = n;
      }
      stringify() {
        return "{}";
      }
      parse() {}
      set() {}
      get() {}
    },
    File: class {
      constructor() {
        this.isopen = false;
      }
      close() {}
    },
    Task: class {
      constructor() {
        this.interval = 0;
      }
      repeat() {}
      cancel() {}
    },
    // Records the observer LiveAPIs (setupWatches path) and answers get() for the
    // resend path. `new LiveAPI(callback, path)` is the observer form; `new
    // LiveAPI(path)` is the plain read form.
    LiveAPI: class {
      constructor(a, b) {
        if (typeof a === "function") observers.push([b, null]);
        this.property = null;
      }
      get() {
        return [128];
      }
      set() {}
      getcount() {
        return 0;
      }
    },
  };
  ctx.global = ctx;

  const src = specs === null ? wrapperSrc : `var WATCH_SPECS = ${JSON.stringify(specs)};\n` + wrapperSrc;
  vm.createContext(ctx);
  vm.runInContext(src, ctx);

  return {
    ctx,
    posts,
    observers,
    toUi: (selector) => sent.filter(([n, sel]) => n === 0 && sel === selector).map(([, , ...args]) => args),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test("bang() attaches one observer per declared watch", () => {
  const h = bootWithWatches([
    { key: "scale", path: "live_set", property: "scale_name" },
    { key: "tempo", path: "live_set", property: "tempo" },
  ]);
  try {
    h.ctx.bang();
    // The tempo observer (setupTempoObserver) is one; the two watches are two more.
    const watchPaths = h.observers.map(([p]) => p).filter((p) => p === "live_set");
    expect(watchPaths.length).toBeGreaterThanOrEqual(2);
    expect(h.posts.some((p) => p.indexOf("watching 2 Live properties") >= 0)).toBe(true);
  } finally {
    h.cleanup();
  }
});

test("ui_ready resends each watch's current value as watch_<key>", () => {
  const h = bootWithWatches([{ key: "tempo", path: "live_set", property: "tempo" }]);
  try {
    h.ctx.ui_ready();
    // The mock LiveAPI.get() returns [128]; resendWatches spreads the array so the
    // scalar arrives as one atom, matching the observer's own shape.
    expect(h.toUi("watch_tempo")).toEqual([[128]]);
  } finally {
    h.cleanup();
  }
});

test("with no WATCH_SPECS, the wrapper touches nothing - the guard holds", () => {
  const h = bootWithWatches(null);
  try {
    h.ctx.ui_ready();
    expect(h.toUi("watch_tempo")).toEqual([]);
    expect(h.posts.some((p) => p.indexOf("watching") >= 0)).toBe(false);
  } finally {
    h.cleanup();
  }
});
