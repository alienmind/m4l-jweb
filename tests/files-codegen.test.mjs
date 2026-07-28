/**
 * files-codegen.test.mjs - what defineFiles() compiles to, and what the wrapper
 * and the patcher do with it.
 *
 * Writing a file is three things that must travel together - [maxurl], the device
 * folder, the selectors - and the failure when one is missing is SILENT: the bytes
 * are written, the place request leaves on an outlet with nothing on the other end,
 * and the promise never settles. So all three seams are pinned here:
 *
 *   1. the declaration refuses to mean nothing;
 *   2. the patcher gets [maxurl] from the declaration alone, exactly once, even
 *      when the manifest also asks for the chain;
 *   3. the shipped wrapper, given the banner, hands the page its device folder on
 *      ui_ready - and says so in the console when there is no folder to hand over.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { beforeAll, expect, test } from "vitest";

import { buildWrapper, composePatcher } from "@m4l-jweb/build";
import { effectiveChains, filesSpecBanner } from "@m4l-jweb/build/files";
import { defineFiles } from "@m4l-jweb/surface";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* ------------------------------------------------------------------ *
 * The declaration and its banner
 * ------------------------------------------------------------------ */

test("a declaration that claims neither saves nor fetches is refused", () => {
  // It would still pull [maxurl] into a device that touches no disk, which is a
  // chain nobody can explain rather than a harmless default.
  expect(() => defineFiles({})).toThrow(/at least one/);
  expect(() => defineFiles({ saves: false, fetches: false })).toThrow(/at least one/);
});

test("tellPage defaults on - a file the user cannot find was not written", () => {
  expect(defineFiles({ saves: true }).tellPage).toBe(true);
  expect(defineFiles({ saves: true, tellPage: false }).tellPage).toBe(false);
});

test("the banner carries what the wrapper acts on, and nothing else", () => {
  const banner = filesSpecBanner(defineFiles({ saves: true }));
  const spec = JSON.parse(banner.replace(/^var FILES_SPEC = /, "").replace(/;\n$/, ""));
  expect(spec).toEqual({ saves: true, fetches: false, tellPage: true });
});

test("a device with no declaration emits nothing, so FILES_SPEC stays undefined", () => {
  expect(filesSpecBanner(null)).toBe("");
});

/* ------------------------------------------------------------------ *
 * The derived chain
 * ------------------------------------------------------------------ */

test("declaring files derives the download chain, and appends it last", () => {
  // Last, because chain order IS the signal path: a device that merely started
  // writing files must not have its audio stages re-ordered underneath it.
  expect(effectiveChains(["lowpass", "gain"], defineFiles({ saves: true }))).toEqual(["lowpass", "gain", "download"]);
});

test("a manifest that still lists download keeps exactly one", () => {
  // Twice would emit the same box ids twice, which assertUniqueBoxIds rejects.
  expect(effectiveChains(["passthrough", "download"], defineFiles({ fetches: true }))).toEqual(["passthrough", "download"]);
});

test("no declaration changes nothing", () => {
  expect(effectiveChains(["passthrough"], null)).toEqual(["passthrough"]);
  expect(effectiveChains(undefined, null)).toEqual([]);
});

/**
 * The patcher itself, through the build's own pipeline - the artifact is the truth.
 */
const base = JSON.parse(readFileSync(path.join(root, "packages", "build", "templates", "base.json"), "utf8"));
const boxTexts = (patcher) => patcher.boxes.map(({ box: b }) => b.text ?? "");

test("the declaration alone puts [maxurl] in the patcher", () => {
  const device = { name: "test", type: "audio", chains: ["passthrough"] };
  const without = composePatcher(base, device, null, null);
  expect(boxTexts(without.patcher).some((t) => t.startsWith("maxurl"))).toBe(false);

  const with_ = composePatcher(base, device, null, defineFiles({ saves: true }));
  expect(boxTexts(with_.patcher).filter((t) => t.startsWith("maxurl"))).toHaveLength(1);
});

/* ------------------------------------------------------------------ *
 * The shipped wrapper, driven by the banner
 * ------------------------------------------------------------------ */

let wrapperSrc = "";
beforeAll(() => {
  const built = path.join(root, "dist", "wrapper", "wrapper.js");
  if (!existsSync(built)) buildWrapper(root);
  wrapperSrc = readFileSync(built, "utf8");
});

/**
 * Boot the REAL concatenated wrapper in a fake Max, with a FILES_SPEC banner in
 * front - exactly what packageDevices() does per device.
 *
 * `filepath` is what deviceFolder() reads; pass null for the unsaved-patcher case,
 * which is the one that produces a path relative to nowhere.
 */
function bootWithFiles(spec, { filepath = true } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "m4l-files-"));
  const posts = [];
  const sent = [];

  const ctx = {
    patcher: { filepath: filepath ? `${dir}/device.amxd` : "" },
    post: (...a) => posts.push(a.join("")),
    outlet: (n, ...a) => sent.push([n, ...a]),
    messnamed: () => {},
    arrayfromargs: (args) => [...args],
    jsarguments: ["wrapper.js", "audio"],
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
    LiveAPI: class {
      constructor() {
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

  const src = spec === null ? wrapperSrc : `var FILES_SPEC = ${JSON.stringify(spec)};\n` + wrapperSrc;
  vm.createContext(ctx);
  vm.runInContext(src, ctx);

  return {
    ctx,
    posts,
    dir,
    toUi: (selector) => sent.filter(([n, sel]) => n === 0 && sel === selector).map(([, , ...args]) => args),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test("ui_ready hands the page the device folder, as ONE symbol", () => {
  const h = bootWithFiles({ saves: true, fetches: false, tellPage: true });
  try {
    h.ctx.ui_ready();
    // One atom, not split on the path separators - a real install has spaces in it.
    expect(h.toUi("device_folder")).toEqual([[h.dir]]);
  } finally {
    h.cleanup();
  }
});

test("an unsaved patcher says so, rather than sending a path relative to nowhere", () => {
  const h = bootWithFiles({ saves: true, fetches: false, tellPage: true }, { filepath: false });
  try {
    h.ctx.ui_ready();
    expect(h.toUi("device_folder")).toEqual([]);
    expect(h.posts.some((p) => p.indexOf("not saved") >= 0)).toBe(true);
  } finally {
    h.cleanup();
  }
});

test("tellPage off keeps the folder to itself", () => {
  const h = bootWithFiles({ saves: true, fetches: false, tellPage: false });
  try {
    h.ctx.ui_ready();
    expect(h.toUi("device_folder")).toEqual([]);
  } finally {
    h.cleanup();
  }
});

test("with no FILES_SPEC the wrapper says nothing - the guard holds", () => {
  const h = bootWithFiles(null);
  try {
    h.ctx.ui_ready();
    expect(h.toUi("device_folder")).toEqual([]);
  } finally {
    h.cleanup();
  }
});
