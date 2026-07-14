/**
 * wrapper-max.test.mjs - run the SHIPPED wrapper inside a fake Max.
 *
 * Everything else in this suite tests what the build EMITS. This tests what the
 * wrapper DOES: it loads `dist/wrapper/wrapper.js` - the real, concatenated, ES5
 * script that ships inside every .amxd - into a V8 context holding fake versions of
 * the globals Max provides (`post`, `outlet`, `Dict`, `File`, `Task`, `LiveAPI`), and
 * then plays the part of Max on the other side of the cords.
 *
 * `File` is backed by the REAL filesystem, in a temp dir, and the [maxurl] simulator
 * writes real bytes. So "the destination is untouched after a 404" is not a claim
 * checked against a mock's call log - it is a file on disk that we open and read.
 *
 * ------------------------------------------------------------------------------
 * WHAT THIS CAN AND CANNOT CATCH, because the difference matters.
 *
 * It catches US: a regression in the wrapper's orchestration - the two-phase
 * download, the validation, the selectors, the argument shapes. That is where every
 * bug this file was written after actually lived.
 *
 * It CANNOT catch MAX. The simulator below encodes what maxurl was measured to do
 * (`filename_out` writes the file, an unknown key is ignored, a 404 still writes, a
 * file:// reply has status 0). If a future Max changes one of those, this suite keeps
 * passing and the device breaks in Live - because the simulator is our BELIEF about
 * Max, and a belief cannot falsify itself.
 *
 * That is what `wrapper/device.ts`'s in-Live spike is for, and why the pair exists:
 * this file pins the code against the contract, the spike pins the contract against
 * Max. See doc/ARCHITECTURE.md, "What Max actually does".
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { afterEach, beforeAll, beforeEach, expect, test } from "vitest";

import { buildWrapper } from "@m4l-jweb/build";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let wrapperSrc = "";

beforeAll(() => {
  const built = path.join(root, "dist", "wrapper", "wrapper.js");
  if (!existsSync(built)) buildWrapper(root); // a bare checkout can still run this
  wrapperSrc = readFileSync(built, "utf8");
});

/* ------------------------------------------------------------------ *
 * The fake Max
 * ------------------------------------------------------------------ */

/** Max's [dict]: a bag of key/values, addressable BY NAME from anywhere. */
function makeDictClass(dicts) {
  let anon = 0;
  return class Dict {
    constructor(name) {
      this.name = name ?? `u${++anon}`;
      if (!dicts.has(this.name)) dicts.set(this.name, {});
    }
    set(k, v) {
      dicts.get(this.name)[k] = v;
    }
    get(k) {
      return dicts.get(this.name)[k];
    }
    stringify() {
      return JSON.stringify(dicts.get(this.name));
    }
    parse(json) {
      dicts.set(this.name, JSON.parse(json));
    }
    clear() {
      dicts.set(this.name, {});
    }
  };
}

/**
 * Max's [js] `File`, on the real filesystem.
 *
 * Only the members Max actually has - open, close, eof, and the read/write family. NO
 * rename and NO delete: that absence is the whole reason the wrapper asks maxurl to
 * move a file, so a fake that quietly offered `rename` would test a device we cannot
 * ship. (Confirmed in Live: the File object's members are exactly these.)
 */
function makeFileClass() {
  return class File {
    constructor(p, mode) {
      this.path = p;
      if (mode === "write") {
        if (!existsSync(p)) writeFileSync(p, Buffer.alloc(0));
        this.isopen = true;
      } else {
        this.isopen = existsSync(p);
      }
      this._sync();
    }
    _sync() {
      this.eof = this.isopen && existsSync(this.path) ? statSync(this.path).size : 0;
    }
    set eof(n) {
      // Max's File truncates when you assign eof - the only "delete" [js] has.
      if (n === 0 && this.isopen) writeFileSync(this.path, Buffer.alloc(0));
      this._eof = n;
    }
    get eof() {
      return this.isopen && existsSync(this.path) ? statSync(this.path).size : (this._eof ?? 0);
    }
    open() {
      this.isopen = existsSync(this.path);
    }
    close() {
      this.isopen = false;
    }
    writebytes(bytes) {
      const cur = existsSync(this.path) ? readFileSync(this.path) : Buffer.alloc(0);
      writeFileSync(this.path, Buffer.concat([cur, Buffer.from(bytes)]));
    }
    readbytes(n) {
      return [...readFileSync(this.path).subarray(0, n)];
    }
    writestring(s) {
      writeFileSync(this.path, s);
    }
    readstring(n) {
      return readFileSync(this.path, "utf8").slice(0, n);
    }
  };
}

/**
 * Boot the wrapper in a fake Max, and hand back the seams a test drives it through.
 */
function bootWrapper() {
  const dir = mkdtempSync(path.join(tmpdir(), "m4l-wrapper-"));
  const dicts = new Map();
  const posts = [];
  /** Everything the wrapper sent out, per outlet: [outletIndex, selector, ...args]. */
  const sent = [];

  const ctx = {
    // At [js] global scope `this` IS the jsthis object - that is how the wrapper finds
    // the folder it may write into.
    patcher: { filepath: `${dir}/device.amxd` },
    post: (...a) => posts.push(a.join("")),
    outlet: (n, ...a) => sent.push([n, ...a]),
    messnamed: () => {},
    arrayfromargs: (args) => [...args],
    jsarguments: ["wrapper.js", "audio"],
    autowatch: 0,
    inlets: 1,
    outlets: 2,
    Dict: makeDictClass(dicts),
    File: makeFileClass(),
    // The wrapper builds a Task at load and LiveAPI objects on bang(). Neither is
    // under test here; they only have to exist.
    Task: class {
      constructor() {
        this.interval = 0;
      }
      repeat() {}
      schedule() {}
      cancel() {}
    },
    LiveAPI: class {
      get() {
        return [120];
      }
      set() {}
      call() {}
      getcount() {
        return 0;
      }
    },
  };
  ctx.global = ctx;
  vm.createContext(ctx);
  vm.runInContext(wrapperSrc, ctx);

  return {
    dir,
    ctx,
    dicts,
    posts,
    sent,
    /** The ARGUMENTS of every `<selector> ...` the wrapper sent to the UI on outlet 0. */
    toUi: (selector) => sent.filter(([n, sel]) => n === 0 && sel === selector).map(([, , ...args]) => args),
    /** The request dicts the wrapper handed [maxurl] (outlet 1). */
    maxurlRequests: () => sent.filter(([n, sel]) => n === 1 && sel === "maxurl").map(([, , , name]) => dicts.get(name)),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/**
 * THE [maxurl] SIMULATOR - and every line of it is a fact measured in Live.
 *
 * It is deliberately as nasty as the real thing:
 *   - It writes `filename_out`, and IGNORES any key it does not know (which is how
 *     `downloadfilename` produced a triumphant HTTP 200 and an empty folder).
 *   - A 404 STILL WRITES - the error page goes to the file, like any other body.
 *   - A `file://` GET copies the file and replies with `status 0`: no HTTP happened.
 *   - It replies through the same [prepend maxurl_done] cord the patcher wires.
 */
function maxurl(h, { status = 200, body = "payload", error = null } = {}) {
  const reqs = h.maxurlRequests();
  const req = reqs[reqs.length - 1];
  expect(req, "the wrapper sent no request to [maxurl]").toBeDefined();

  const out = req.filename_out; // an unknown key would leave this undefined - as Max does
  const isFileScheme = String(req.url).indexOf("file:///") === 0;

  if (isFileScheme) {
    // A local copy. libcurl streams the source file to filename_out, and there is no
    // HTTP status to report.
    const src = decodeURI(String(req.url).replace("file:///", ""));
    if (out && existsSync(src)) writeFileSync(out, readFileSync(src));
    h.dicts.set("m4ljweb_place_response", { status: 0 });
    h.ctx.maxurl_done("dictionary", "m4ljweb_place_response");
    return;
  }

  if (error) {
    // A filesystem failure: the SERVER was perfectly happy (200), and nothing landed.
    h.dicts.set("m4ljweb_fetch_response", { status: 200, error });
    h.ctx.maxurl_done("dictionary", "m4ljweb_fetch_response");
    return;
  }

  if (out) writeFileSync(out, body); // a 404 body is a body. It gets written.
  h.dicts.set("m4ljweb_fetch_response", { status });
  h.ctx.maxurl_done("dictionary", "m4ljweb_fetch_response");
}

let h;
beforeEach(() => {
  h = bootWrapper();
});
afterEach(() => h.cleanup());

/* ------------------------------------------------------------------ *
 * Fetch-to-disk
 * ------------------------------------------------------------------ */

test("a fetch downloads to a .part file and never writes the destination first", () => {
  h.ctx.fetch_to_file("r1", "https://example.com/a.json", "out.json");

  const [req] = h.maxurlRequests();
  // THE KEY IS `filename_out`. It was `downloadfilename` for weeks: an unknown key is
  // IGNORED, so every request succeeded and nothing was ever written to disk.
  expect(req.filename_out).toBe(`${h.dir}/out.json.part`);
  expect(req.filename_out).not.toBe(`${h.dir}/out.json`);
  // `overwrite_output_file` defaults to 0 - without it the download works exactly once.
  expect(req.overwrite_output_file).toBe(1);
  expect(req.http_method).toBe("get");
  expect(existsSync(`${h.dir}/out.json`), "the destination was touched before the download was validated").toBe(false);
});

test("a successful fetch places the file and reports the bytes", () => {
  h.ctx.fetch_to_file("r1", "https://example.com/a.json", "out.json");
  maxurl(h, { body: "hello world" }); // the download
  maxurl(h, {}); // ...and the file:// copy the wrapper asked for next

  expect(readFileSync(`${h.dir}/out.json`, "utf8")).toBe("hello world");
  expect(h.toUi("fetch_done")).toEqual([["r1", 11]]);
  expect(h.toUi("fetch_error")).toEqual([]);
});

test("the place step is validated on BYTES, because a file:// reply has no HTTP status", () => {
  h.ctx.fetch_to_file("r1", "https://example.com/a.json", "out.json");
  maxurl(h, { body: "hello world" });
  maxurl(h, {}); // replies `status 0` - measured in Live

  // A 2xx check here would reject a perfectly good copy. Report success on the file.
  expect(h.toUi("fetch_done")).toEqual([["r1", 11]]);
});

/**
 * THE REASON THE TWO PHASES EXIST. Measured in Live: [maxurl] wrote a 355-byte Apache
 * error page over a good 1.2 MB cached .wav, and reported the 404 while doing it.
 */
test("a 404 does NOT destroy the file already at the destination", () => {
  writeFileSync(`${h.dir}/out.json`, "the good cached file");

  h.ctx.fetch_to_file("r1", "https://example.com/gone.json", "out.json");
  maxurl(h, { status: 404, body: "<html>Not Found</html>" });

  expect(readFileSync(`${h.dir}/out.json`, "utf8")).toBe("the good cached file");
  expect(h.toUi("fetch_error")).toEqual([["r1", "HTTP 404"]]);
  expect(h.toUi("fetch_done")).toEqual([]);
  // ...and it did not go on to copy the error page over it either.
  expect(h.maxurlRequests().length).toBe(1);
});

/**
 * The nastiest one: an unwritable path comes back as status 200, because the SERVER
 * was happy. The only sign is an `error` key that is simply absent on success.
 */
test("a filesystem failure is caught even though the status says 200", () => {
  h.ctx.fetch_to_file("r1", "https://example.com/a.json", "out.json");
  maxurl(h, { error: "could not open file" });

  expect(h.toUi("fetch_error")).toEqual([["r1", "could not open file"]]);
  expect(existsSync(`${h.dir}/out.json`)).toBe(false);
});

test("a 200 that wrote nothing at all is a failure, not a zero-byte success", () => {
  // What a wrong `filename_out` key looks like from here: a clean response, no file.
  h.ctx.fetch_to_file("r1", "https://example.com/a.json", "out.json");
  h.dicts.set("m4ljweb_fetch_response", { status: 200 });
  h.ctx.maxurl_done("dictionary", "m4ljweb_fetch_response");

  expect(h.toUi("fetch_done")).toEqual([]);
  expect(h.toUi("fetch_error")[0][0]).toBe("r1");
  expect(String(h.toUi("fetch_error")[0][1])).toContain("nothing was written");
});

test("progress reports the DOWNLOAD, and not the millisecond-long local copy", () => {
  h.ctx.fetch_to_file("r1", "https://example.com/a.json", "out.json");

  // maxurl's progress outlet: <response-dict> <dl total> <dl now> <ul total> <ul now>.
  // FIVE atoms, starting with a SYMBOL - this used to be read as (downloaded, total,
  // percent), so every number the UI showed was the wrong one.
  h.ctx.maxurl_progress("m4ljweb_fetch_response", 1000, 250, 0, 0);
  h.ctx.maxurl_progress("m4ljweb_place_response", 1000, 900, 0, 0); // the copy: not the download
  expect(h.toUi("fetch_progress")).toEqual([["r1", 250, 1000]]);
});

test("fetches are queued, so two downloads cannot be mistaken for each other", () => {
  h.ctx.fetch_to_file("r1", "https://example.com/a.json", "a.json");
  h.ctx.fetch_to_file("r2", "https://example.com/b.json", "b.json");
  expect(h.maxurlRequests().length).toBe(1); // r2 is waiting

  maxurl(h, { body: "aaa" });
  maxurl(h, {});
  expect(h.toUi("fetch_done")).toEqual([["r1", 3]]);

  maxurl(h, { body: "bbbb" });
  maxurl(h, {});
  expect(h.toUi("fetch_done")).toEqual([
    ["r1", 3],
    ["r2", 4],
  ]);
});

/* ------------------------------------------------------------------ *
 * State persistence
 * ------------------------------------------------------------------ */

/**
 * THE SELECTOR. Max dispatches a message on its FIRST WORD, so the app sends
 * `sync_state <id> <json>` - never `sync_state_<id>`, which looks up a handler no
 * device has and is swallowed by anything(). It shipped that way: reads worked, and
 * every write was silently dropped.
 */
test("sync_state writes the slot's dict, and get_state reads it back", () => {
  expect(typeof h.ctx.sync_state, "the wrapper must handle the selector the app sends").toBe("function");
  expect(typeof h.ctx.sync_state_config).toBe("undefined");

  h.ctx.sync_state("config", '{"voices":16}');
  expect(h.dicts.get("obj-state-config")).toEqual({ voices: 16 });

  h.ctx.get_state("config");
  expect(h.toUi("state_config")).toEqual([['{"voices":16}']]);
});

test("JSON arrives split into atoms, and is joined back before parsing", () => {
  // Max parses a message on whitespace, so a string with a space in it reaches [js] as
  // several arguments. Joining them is not a nicety - without it the parse throws.
  h.ctx.sync_state("config", '{"name":"drop', 'd",', '"voices":16}');
  expect(h.dicts.get("obj-state-config")).toEqual({ name: "drop d", voices: 16 });
});

/* ------------------------------------------------------------------ *
 * The lifecycle
 * ------------------------------------------------------------------ */

test("ui_ready resends the state a page that loaded late has missed", () => {
  h.ctx.ui_ready();
  expect(h.toUi("mode")).toEqual([["audio"]]); // jsarguments[1] - [0] is the script name
  expect(h.toUi("build").length).toBe(1); // the stale-install stamp
});
