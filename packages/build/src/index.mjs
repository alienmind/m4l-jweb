/**
 * index.mjs - the build pipeline: wrapper -> patchers -> package.
 *
 * Everything here is conventional over configurable. A device repo owns exactly
 * two things: `src/app/` (the web app) and `patcher/devices.mjs` (the manifest).
 * Optional escape hatches:
 *   patcher/base.json  - override the patcher template
 *   wrapper/device.ts  - extra [js] message handlers, concatenated last
 */
import archiver from "archiver";
import { cpSync, createReadStream, createWriteStream, existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from "node:fs";
import { copyFile, rename, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { AMXD_TYPES, assertES5, buildAmxd, extraPayloadsJs, payloadJs } from "./amxd.mjs";
import { CHAINS, assertUniqueBoxIds, closeAudio, openAudio, registerChain, resetLayout } from "./chains.mjs";
import { CONTROLS_CHAIN, controlsSpecBanner, takeoverChain, withControlsChain } from "./controls.mjs";
import { deviceTarget, isHeadless, openApp } from "./target.mjs";
import { applySurface, applyWindows, applyPersistence, loadSurface, parameterRegistry, surfaceContext } from "./surface.mjs";
import { effectiveChains, filesSpecBanner, loadFiles } from "./files.mjs";
import { loadWatch, watchSpecsBanner } from "./watch.mjs";

// The takeover chain lives in controls.mjs beside the rest of defineControls()'s
// build half, and joins the vocabulary here rather than in chains.mjs - which it
// imports for box()/line()/fanParamInto(), and which must not import it back.
registerChain(CONTROLS_CHAIN, takeoverChain);

const require = createRequire(import.meta.url);
const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const templates = path.join(pkgDir, "templates");

/* ------------------------------------------------------------------ *
 * Step 1: the wrapper
 * ------------------------------------------------------------------ */

/**
 * Compile the wrapper to ONE ES5 script.
 *
 * Max's [js] has no module system, so @m4l-jweb/wrapper ships SOURCES, not a
 * library: core.ts + liveapi.ts (+ the device's own wrapper/device.ts) are
 * compiled together as one TypeScript program - so they typecheck across the
 * seam and see each other's globals - and their outputs are concatenated in
 * order.
 */
export function buildWrapper(root) {
  const { sources, types } = require("@m4l-jweb/wrapper/sources");
  const deviceExt = path.join(root, "wrapper", "device.ts");
  const files = [...sources, ...(existsSync(deviceExt) ? [deviceExt] : [])];

  const outDir = path.join(root, "dist", "wrapper");
  const tmp = path.join(root, "dist", ".wrapper-tsc");
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  mkdirSync(outDir, { recursive: true });

  // Copy every source next to each other FIRST, then compile in place.
  //
  // tsc derives its output layout from the common root of its inputs. The
  // packaged sources live in node_modules and the device's own device.ts lives
  // in the repo, so that common root can be some ancestor of both - and the
  // outputs land in a mirrored directory tree instead of flat. Staging them in
  // one directory makes the output names predictable, which is what lets us
  // concatenate them in order below.
  const staged = files.map((f, i) => {
    // Prefix with the index: order is the contract (core must precede the rest),
    // and two sources could share a basename.
    const dest = path.join(tmp, `${String(i).padStart(2, "0")}-${path.basename(f)}`);
    writeFileSync(dest, readFileSync(f, "utf8"));
    return dest;
  });
  const stagedTypes = path.join(tmp, path.basename(types));
  writeFileSync(stagedTypes, readFileSync(types, "utf8"));

  // The ES5 target is a build gate, not a style preference. `module: "none"`
  // forbids imports, which is exactly the [js] constraint.
  const tsconfig = path.join(tmp, "tsconfig.json");
  writeFileSync(
    tsconfig,
    JSON.stringify({
      compilerOptions: {
        target: "ES5",
        lib: ["ES5"],
        module: "none",
        outDir: tmp,
        strict: true,
        // At [js] global scope `this` IS the jsthis object - that is how
        // `this.patcher.filepath` works.
        noImplicitThis: false,
        // ...and that is ONLY true in sloppy mode. `strict: true` makes tsc emit
        // "use strict" at the top of every file, under which `this` inside a plainly
        // called function is UNDEFINED - so `this.patcher` would throw. Max's [js] is
        // an ES5-era interpreter that does not enforce strict semantics, so the
        // device works anyway; it works by accident, on a technicality of a very old
        // engine, and any [js] that ever grew a real strict mode would take every
        // device down with it. Emit what we actually target.
        alwaysStrict: false,
        noImplicitAny: false,
        skipLibCheck: true,
        types: [],
      },
      files: [stagedTypes, ...staged],
    }),
  );

  execFileSync(process.execPath, [require.resolve("typescript/bin/tsc"), "-p", tsconfig], { stdio: "inherit" });

  // Concatenate the emitted scripts in source order: core's lifecycle first, the
  // device's own handlers last.
  const js = staged.map((f) => readFileSync(f.replace(/\.ts$/, ".js"), "utf8")).join("\n");
  assertES5(js, "wrapper");

  const out = path.join(outDir, "wrapper.js");
  writeFileSync(out, js);
  rmSync(tmp, { recursive: true, force: true });

  console.log(`m4l-jweb: wrapper.js (${js.length} bytes, ES5 verified, from ${files.length} sources)`);
  return out;
}

/**
 * Compile ONE headless device's own `[js]` logic to ES5.
 *
 * `src/app/<device>/headless.ts` is what `App.tsx` is for a jweb device: the thing the
 * device actually does. It is concatenated after the packaged wrapper, so it sees the
 * wrapper's globals (`post`, `outlet`, `Task`, `LiveAPI`, `MODE`) and typechecks
 * against them - which is why the wrapper sources are in the program even though only
 * this file's output is kept.
 *
 * ONE PROGRAM PER DEVICE, deliberately. Compiling every device's headless source
 * together would put them all in one global scope, where two devices could not both
 * declare a `var step` - a constraint invented by the build, paid by the author, for
 * nothing. A tsc run is about a second.
 *
 * The ES5 gate is the same one the wrapper passes and for the same reason: Max's [js]
 * is an ES5-era interpreter, and this file runs inside it.
 */
export function buildHeadless(root, uiDir) {
  const src = path.join(root, "src", "app", uiDir, "headless.ts");
  if (!existsSync(src)) return null;

  const { sources, types } = require("@m4l-jweb/wrapper/sources");
  const deviceExt = path.join(root, "wrapper", "device.ts");
  const context = [...sources, ...(existsSync(deviceExt) ? [deviceExt] : [])];

  const tmp = path.join(root, "dist", `.headless-${uiDir}`);
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });

  // Staged flat, like buildWrapper: tsc derives its output layout from the common root
  // of its inputs, and the packaged sources live in node_modules while this one lives
  // in the repo.
  const staged = context.map((f, i) => {
    const dest = path.join(tmp, `${String(i).padStart(2, "0")}-${path.basename(f)}`);
    writeFileSync(dest, readFileSync(f, "utf8"));
    return dest;
  });
  const mine = path.join(tmp, "device-headless.ts");
  writeFileSync(mine, readFileSync(src, "utf8"));
  const stagedTypes = path.join(tmp, path.basename(types));
  writeFileSync(stagedTypes, readFileSync(types, "utf8"));

  const tsconfig = path.join(tmp, "tsconfig.json");
  writeFileSync(
    tsconfig,
    JSON.stringify({
      compilerOptions: {
        target: "ES5",
        lib: ["ES5"],
        module: "none",
        outDir: tmp,
        strict: true,
        noImplicitThis: false,
        alwaysStrict: false,
        noImplicitAny: false,
        skipLibCheck: true,
        types: [],
      },
      files: [stagedTypes, ...staged, mine],
    }),
  );
  execFileSync(process.execPath, [require.resolve("typescript/bin/tsc"), "-p", tsconfig], { stdio: "inherit" });

  const js = readFileSync(mine.replace(/\.ts$/, ".js"), "utf8");
  assertES5(js, `headless logic for ${uiDir}`);
  rmSync(tmp, { recursive: true, force: true });
  console.log(`m4l-jweb: headless logic for ${uiDir} (${js.length} bytes, ES5 verified)`);
  return js;
}

/* ------------------------------------------------------------------ *
 * Step 2: the patchers
 * ------------------------------------------------------------------ */

async function readManifest(root) {
  const p = path.join(root, "patcher", "devices.mjs");
  if (!existsSync(p)) throw new Error("patcher/devices.mjs not found - a device repo needs a manifest");
  return (await import(pathToFileURL(p).href)).default;
}

/**
 * Files that ride along with the release without being part of any device.
 *
 * A user manual, a licence, a chart - things a person opens, not things Max loads. They
 * are declared as a named `docs` export next to the manifest:
 *
 *   export const docs = ["USERSMANUAL.md", "dist/manual/USERSMANUAL.pdf"];
 *
 * MISSING IS NOT FATAL, and that is the whole reason this is a list rather than a
 * `looseFiles` entry: a generated doc (a PDF rendered by a headless browser) may not
 * exist on a machine that has no browser, and a manual is never worth failing a build
 * that produced every device correctly. What is missing is named in the log.
 */
async function readDocs(root) {
  const p = path.join(root, "patcher", "devices.mjs");
  if (!existsSync(p)) return [];
  const mod = await import(pathToFileURL(p).href);
  return Array.isArray(mod.docs) ? mod.docs : [];
}

/** patcher/base.json in the device repo wins; otherwise the packaged template. */
function readBase(root) {
  const local = path.join(root, "patcher", "base.json");
  const src = existsSync(local) ? local : path.join(templates, "base.json");
  return JSON.parse(readFileSync(src, "utf8"));
}

/**
 * A device repo may add its own chains in patcher/chains.mjs - importing it is
 * enough, since registerChain() mutates the shared vocabulary:
 *
 *   import { registerChain, box, line } from "@m4l-jweb/build/chains";
 *   registerChain("poly", ({ boxes, lines, jwebId }) => { ... });
 *
 * The canned chains cover the common shapes; anything device-specific (a
 * synth voice bank, a sample player, an external host) belongs here rather than
 * in the library.
 */
async function loadDeviceChains(root) {
  const p = path.join(root, "patcher", "chains.mjs");
  if (!existsSync(p)) return;
  await import(pathToFileURL(p).href);
  console.log("m4l-jweb: loaded device chains from patcher/chains.mjs");
}

/**
 * One device, one patcher: the template, its chains, its Surface. Pure - it takes
 * the base patcher and the device's declaration and returns the JSON to write.
 *
 * It is exported because the tests generate patchers too, and a test that
 * assembled the pipeline itself could pass while the build wired something else.
 * The ORDER below is the pipeline, and every step of it is load-bearing:
 *
 *   openAudio      the device's plugin~/plugout~, created ONCE, before any chain -
 *                  so a chain is a stage in the signal path, not the owner of it.
 *   the chains     in declaration order, each taking what the last one left, plus
 *                  the `download` chain a files.ts declaration derives (files.mjs).
 *   applySurface   LAST of the message-stream claimants: it routes every `set_<id>`
 *                  off the app's stream and passes on what nobody claimed
 *                  (ui_ready, ...) to the wrapper. Doing it last means no chain has
 *                  to know the Surface exists.
 *   closeAudio     the final stage's output into plugout~.
 *   assertUnique   two boxes with one id is a malformed patcher, and Max resolves
 *                  it however it likes. Nothing else would report it.
 */
export function composePatcher(base, d, surface, files = null) {
  const amxdtype = AMXD_TYPES[d.type];
  if (!amxdtype) throw new Error(`unknown type "${d.type}" for device "${d.name}" (midi | audio | instrument)`);

  const p = structuredClone(base);
  const { boxes, lines } = p.patcher;
  p.patcher.project.amxdtype = amxdtype;
  resetLayout();

  // The wrapper is mode-switched by its object-box argument. `mode` defaults
  // to the device type, but they are not always the same thing: a sample
  // player can be an audio-effect device ("type") that the wrapper must treat
  // as a sampler ("mode").
  //
  // jsarguments[0] is the SCRIPT NAME, so the mode lands at jsarguments[1].
  const mode = d.mode ?? d.type;
  boxes.find((b) => b.box.id === "obj-js").box.text = `js wrapper.js ${mode}`;

  /**
   * The ring buffer between Chromium's audio thread and MSP, for the DEVICE PAGE's
   * own `[jweb~]`.
   *
   * `window({ audio: true, latency })` has taken this since 1.1.0, and the device
   * page could not - so a device that put its buffer at the documented maximum for
   * its sounding WINDOW left its own page at the object default (~21 ms at 48 kHz)
   * and went on dropping out. Two pages, one setting, and only one of them had it.
   *
   * Unset keeps the object's default. jweb~ clamps to 3x the minimum.
   */
  if (d.latency != null) {
    // A headless device has no [jweb~] to buffer, and a `latency` on one is a setting
    // for a thing that is not there - worth saying, not ignoring.
    if (isHeadless(d)) {
      throw new Error(`device "${d.name}" is target "headless" and sets \`latency\` - there is no [jweb~] to give a ring buffer to.`);
    }
    boxes.find((b) => b.box.id === "obj-jweb").box.latency = d.latency;
  }

  /**
   * `mpe: true` - ask Live to send this device MPE.
   *
   * `is_mpe` is a PATCHER attribute, not a box one, and it is a declaration rather
   * than machinery: Max's own reference says "If enabled, a Max for Live device will
   * receive MPE data from Live", and a shipping device that carries the MPE badge
   * sets it to 1 while parsing the result with ordinary `midiin` / `midiparse` (see
   * doc/MAX-FACTS.md). The template writes 0, so a device that wants it says so here
   * and something still has to READ the stream - the `mpein` chain, or `midiin`.
   *
   * Off by default. A device declaring MPE it does not handle is a device Live sends
   * per-note channels to for no reason, and the badge tells the user a lie.
   */
  if (d.mpe) p.patcher.is_mpe = 1;

  const unmatchedId = d.unmatchedTo === "js" ? "obj-js" : (d.unmatchedTo ?? "obj-js");

  /**
   * The device's parameters, declared once in src/app/<ui>/surface.ts. A chain
   * that drives DSP from a parameter needs two things from it, and needs BOTH:
   *
   *   paramObject(id)  the live.* object's outlet - a knob turn, an automation
   *                    lane, a Push encoder.
   *   paramValue(id)   the route outlet carrying what the APP wrote. Not
   *                    redundant: the app's write reaches the object as `set`,
   *                    which updates it WITHOUT output, so the object would
   *                    never pass that value on. See surface.mjs.
   */
  // Extra frozen dependencies a chain contributes to the .amxd - a [poly~] voice
  // patch, say, which Max cannot embed inline and must resolve as a named .maxpat
  // from the device's own bundle (the same way a frozen M4L instrument ships its
  // voice abstraction). A chain pushes { name, data } here; generatePatchers writes
  // each next to the device patcher and packageDevices freezes it into the container.
  const extras = [];
  const ctx = { boxes, lines, unmatchedId, device: d, extras, ...surfaceContext(surface) };

  // WHERE THE LOGIC RUNS, decided once and before anything else touches the graph.
  // It sets `ctx.appIn` / `ctx.appOut` - the endpoint every chain reaches "the app"
  // through - and, for a headless device, deletes [jweb] and both of its cords. A
  // chain claims a stage in a stream it did not create and must not know which target
  // created it (target.mjs).
  openApp(ctx);
  openAudio(ctx);

  // A declared takeover contributes its chain the way a declared files.ts
  // contributes `download`: derived from the declaration, never from the manifest
  // remembering to ask. A device whose observers were missing would load, grab, and
  // report every press to nobody.
  for (const name of withControlsChain(effectiveChains(d.chains, files), surface)) {
    const chain = CHAINS[name];
    if (!chain) throw new Error(`unknown chain "${name}" for device "${d.name}" (known: ${Object.keys(CHAINS).join(", ")})`);
    chain(ctx);
  }

  applySurface(ctx);
  applyWindows(ctx);
  applyPersistence(ctx);
  closeAudio(ctx);
  assertUniqueBoxIds(boxes, d.name);

  // The patcher-level parameter registry - without it Live ignores every
  // parameter_longname and renames the parameters after their shortnames,
  // which breaks resolveParamId's contract. See parameterRegistry().
  const registry = parameterRegistry(surface);
  if (registry) p.patcher.parameters = registry;

  // Ride the chain-contributed extras out on the returned object. Destructuring
  // `{ patcher }` (the tests, the writer) ignores it; the packager reads it.
  p.extras = extras;
  return p;
}

export async function generatePatchers(root) {
  const devices = await readManifest(root);
  const base = readBase(root);
  await loadDeviceChains(root);
  const outDir = path.join(root, "dist", "patchers");
  mkdirSync(outDir, { recursive: true });

  for (const d of devices) {
    // The manifest carried `parameters` until 0.4.0. It is now declared in
    // src/app/<ui>/surface.ts and generated from there - so a leftover field is not
    // a harmless extra key, it is a device whose parameters have SILENTLY
    // disappeared. Fail the build and say where they went.
    if (d.parameters) {
      throw new Error(
        `device "${d.name}" still declares \`parameters\` in patcher/devices.mjs. ` +
          `That field is gone: declare them in src/app/${d.ui ?? d.name}/surface.ts with defineSurface(), ` +
          `which generates the live.* objects, both wiring directions and the protocol selectors. ` +
          `See doc/ARCHITECTURE.md - "Parameters: the Surface Push reads".`,
      );
    }

    const surface = await loadSurface(root, d.ui ?? d.name);
    const files = await loadFiles(root, d.ui ?? d.name);
    const p = composePatcher(base, d, surface, files);

    // A chain's frozen dependencies (e.g. a [poly~] voice patch) are written beside
    // the device patcher and their names recorded in a sidecar, so packageDevices -
    // a separate pass that only sees dist/ - knows which files to freeze into which
    // device. Strip them from the patcher json itself; they are not part of it.
    const extras = p.extras ?? [];
    delete p.extras;
    for (const ex of extras) writeFileSync(path.join(outDir, ex.name), typeof ex.data === "string" ? ex.data : JSON.stringify(ex.data));
    writeFileSync(path.join(outDir, `${d.name}.extras.json`), JSON.stringify(extras.map((e) => e.name)));

    writeFileSync(path.join(outDir, `${d.name}.json`), JSON.stringify(p, null, "\t"));
    const params = surface ? surface.ids.join(", ") : "none";
    // The chains it was BUILT with, not the ones the manifest listed - a derived
    // `download` that never appeared in the log would be the same invisible wiring
    // this feature exists to end.
    const chains = withControlsChain(effectiveChains(d.chains, files), surface).join(", ") || "none";
    const target = deviceTarget(d);
    console.log(`m4l-jweb: ${d.name}.json (${d.type}/${target}, chains: ${chains}, params: ${params || "none"})`);
  }
  return devices;
}

/* ------------------------------------------------------------------ *
 * Step 3: package
 * ------------------------------------------------------------------ */

/**
 * Assemble dist/: the single-file UI, one .amxd per manifest entry, the
 * installers, and a release zip.
 *
 * Each .amxd is self-contained - the UI travels inside it as a base64 payload in
 * wrapper.js. The loose ui.html/wrapper.js are for inspection, not a runtime
 * requirement.
 */
/**
 * Deliver a `site:` window's content as a SIDECAR FOLDER, and tell the wrapper
 * where it is.
 *
 * Every other window rides inside wrapper.js as base64 and is written to a real
 * file on first load. That works because a window is one self-contained HTML file
 * of a few hundred kB. A whole prebuilt site is tens of MB across hundreds of
 * files, and base64 is 4 bytes per 3 - so it ships as a plain folder next to the
 * .amxd instead, and the wrapper points the window's [jweb] at
 * `file:///<device folder>/<device>-site/<window>/index.html`.
 *
 * The cost is honest and documented: the .amxd is no longer self-contained, and
 * the folder has to travel with it. The wrapper says so out loud when the folder
 * is missing rather than opening a blank window.
 */
function siteWindowsBanner(root, outDir, d, surface) {
  const windows = surface?.windows ?? {};
  const ids = Object.keys(windows).filter((id) => windows[id].site);
  if (!ids.length) return "";

  const map = {};
  for (const id of ids) {
    const from = path.join(root, windows[id].site);
    if (!existsSync(path.join(from, "index.html"))) {
      throw new Error(
        `window "${id}" of "${d.name}" declares site "${windows[id].site}", but there is no index.html there - ` +
          `build the site first (this repo: \`pnpm build:repl\`)`,
      );
    }
    const rel = `${d.name}-site/${id}`;
    cpSync(from, path.join(outDir, rel), { recursive: true });
    map[id] = `${rel}/index.html`;
    console.log(`m4l-jweb: ${windows[id].site} -> dist/${path.basename(outDir)}/${rel}/ (sidecar)`);
  }
  return `var SITE_WINDOWS = ${JSON.stringify(map)};\n`;
}

export async function packageDevices(root) {
  const dist = path.join(root, "dist");
  const { name, version } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const devices = await readManifest(root);

  const outDir = path.join(dist, name);
  mkdirSync(outDir, { recursive: true });

  const wrapperJs = readFileSync(path.join(dist, "wrapper", "wrapper.js"), "utf8");

  // The build stamp is what makes a stale install visible: the wrapper posts it
  // and the UI renders it. Live embeds a copy of the device in the set, so an
  // instance already on a track does NOT update when you reinstall.
  const stamp = `${version} ${new Date().toISOString()}`;
  const banner = `var BUILD_STAMP = ${JSON.stringify(stamp)};\n`;

  for (const d of devices) {
    const deviceName = `${d.name}.amxd`;

    /**
     * Each device embeds its OWN UI bundle, from dist/ui/<ui ?? name>/index.html
     * (see scripts/build-ui.mjs). A device ships what it is, not its siblings'
     * code.
     *
     * The payload NAME is per-device too - `<device>.html`, not a shared
     * `ui.html`. Every device in a repo extracts its payload into the SAME
     * folder (next to the .amxd), so one shared name would mean two devices
     * overwriting each other's UI on every load, each one convinced the file on
     * disk was stale. The symptom would be a device showing its sibling's
     * interface.
     */
    const headless = isHeadless(d);
    const uiName = `${d.name}.html`;
    if (!headless) {
      const uiSrc = path.join(dist, "ui", d.ui ?? d.name, "index.html");
      const legacy = path.join(dist, "index.html"); // single-UI repos (the starter template)
      const uiFrom = existsSync(uiSrc) ? uiSrc : legacy;
      if (!existsSync(uiFrom)) {
        throw new Error(`no UI for "${d.name}" at ${uiSrc} - run \`pnpm build\` (scripts/build-ui.mjs) first`);
      }
      await copyFile(uiFrom, path.join(outDir, uiName));
    }

    /**
     * Payloads ride inside wrapper.js as base64 and are written to real files
     * next to the .amxd on first load, because Chromium and any external
     * process are blind to Max's frozen virtual filesystem.
     * We embed ALL .html files found in the UI directory (including the main UI and any windows).
     */
    // The device's declared watches ride in as a data banner, like the build stamp:
    // WATCH_SPECS is what the packaged wrapper's setupWatches() attaches observers from.
    const watch = await loadWatch(root, d.ui ?? d.name);
    // ...and so do its declared files: FILES_SPEC is what tells the packaged wrapper
    // this device writes to disk, and therefore to hand the page its device folder.
    const files = await loadFiles(root, d.ui ?? d.name);
    // ...and its declared CONTROLS: CONTROLS_SPEC is the role table the packaged
    // wrapper resolves against the connected hardware's own get_control_names.
    const deviceSurface = await loadSurface(root, d.ui ?? d.name);
    let wrapperData =
      banner +
      // The one thing that tells the packaged wrapper there is no page: no [jweb] to
      // point at a URL, no payload to extract, no window sizes to follow. Everything
      // else about the wrapper is unchanged, which is the point of the target being a
      // seam rather than a second wrapper.
      (headless ? "var HEADLESS = 1;\n" : "") +
      watchSpecsBanner(watch) +
      filesSpecBanner(files) +
      controlsSpecBanner(deviceSurface) +
      siteWindowsBanner(root, outDir, d, deviceSurface) +
      wrapperJs;

    const payloads = (d.payloads ?? []).map((f) => ({ name: path.basename(f), data: readFileSync(path.join(root, f)) }));

    if (headless) {
      // The device's OWN [js], where a jweb device would have had a bundle. Nothing
      // else is appended: a headless .amxd contains a patcher and one script, and that
      // is the whole claim the target makes.
      const own = buildHeadless(root, d.ui ?? d.name);
      if (own) wrapperData += "\n" + own;
    } else {
      const uiDirContent = readdirSync(path.join(dist, "ui", d.ui ?? d.name)).filter((f) => f.endsWith(".html"));

      // Main UI payload
      wrapperData += payloadJs("UI_PAYLOAD", uiName, readFileSync(path.join(dist, "ui", d.ui ?? d.name, "index.html")));

      // Additional window payloads
      for (const winHtml of uiDirContent.filter((f) => f !== "index.html")) {
        payloads.push({ name: `${d.name}_${winHtml}`, data: readFileSync(path.join(dist, "ui", d.ui ?? d.name, winHtml)) });
      }
    }

    if (payloads.length) wrapperData += extraPayloadsJs(payloads);

    // Frozen dependencies: readable by Max-native objects only (a poly~ voice
    // patcher, say), which is exactly why they can stay frozen rather than being
    // extracted to disk like the UI. Two sources: manifest `extraFiles` (files in
    // the repo) and chain-generated files recorded in the sidecar by generatePatchers.
    const chainExtrasList = path.join(dist, "patchers", `${d.name}.extras.json`);
    const chainExtras = existsSync(chainExtrasList)
      ? JSON.parse(readFileSync(chainExtrasList, "utf8")).map((name) => ({ name, data: readFileSync(path.join(dist, "patchers", name)) }))
      : [];

    const amxd = buildAmxd({
      patcherJson: readFileSync(path.join(dist, "patchers", `${d.name}.json`), "utf8"),
      wrapperJs: wrapperData,
      deviceName,
      extras: [...(d.extraFiles ?? []).map((f) => ({ name: path.basename(f), data: readFileSync(path.join(root, f)) })), ...chainExtras],
    });
    writeFileSync(path.join(outDir, deviceName), amxd);
    console.log(`m4l-jweb: ${deviceName} (${d.type}/${deviceTarget(d)}, ${amxd.length} bytes)`);
  }

  await copyFile(path.join(dist, "wrapper", "wrapper.js"), path.join(outDir, "wrapper.js"));

  /**
   * Loose files sit NEXT TO the .amxd in the installed folder, as real files.
   *
   * Needed when a Max object resolves a filename when it INSTANTIATES - before
   * the wrapper has run and before it could have extracted anything. Such an
   * object cannot be repointed at runtime, so the file has to be on disk under
   * exactly the name the object was created with. The embedded payload of the
   * same file is then only a fallback for a bare .amxd copied on its own.
   */
  const loose = [...new Set(devices.flatMap((d) => d.looseFiles ?? []))];
  for (const f of loose) {
    await copyFile(path.join(root, f), path.join(outDir, path.basename(f)));
    console.log(`m4l-jweb: ${path.basename(f)} -> dist/${name}/ (loose)`);
  }

  // Presets ride along with the devices. A consumer repo's `presets/` holds
  // hand-saved Live files (an .adg rack is gzipped XML, undocumented - committed,
  // never generated); they land next to the .amxd in dist, the zip and the User
  // Library, all through this one list so the three cannot skew.
  const presetsDir = path.join(root, "presets");
  const presets = existsSync(presetsDir) ? readdirSync(presetsDir).filter((f) => f.endsWith(".adg") || f.endsWith(".adv")) : [];
  for (const f of presets) {
    await copyFile(path.join(presetsDir, f), path.join(outDir, f));
    console.log(`m4l-jweb: ${f} -> dist/${name}/ (preset)`);
  }

  // Documentation for the human, alongside the devices for Max. See readDocs.
  const docs = [];
  for (const f of await readDocs(root)) {
    const from = path.join(root, f);
    if (!existsSync(from)) {
      console.warn(`m4l-jweb: doc ${f} is not there - skipped (it is not part of any device)`);
      continue;
    }
    await copyFile(from, path.join(outDir, path.basename(f)));
    docs.push(path.basename(f));
    console.log(`m4l-jweb: ${path.basename(f)} -> dist/${name}/ (doc)`);
  }

  // Installers go next to the devices so `dist/install-*.ps1` just works.
  const installers = ["install-windows.ps1", "install-mac.sh"];
  for (const f of installers) await copyFile(path.join(templates, f), path.join(dist, f));

  const zipPath = path.join(dist, `${name}.zip`);
  await new Promise((resolve, reject) => {
    const output = createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });
    output.on("close", resolve);
    archive.on("error", reject);
    archive.pipe(output);
    const files = [
      ...devices.map((d) => `${d.name}.amxd`),
      // Each device's own UI, for inspection - a HEADLESS device has none, and there
      // is nothing missing: the .amxd holds the patcher and one script, which is the
      // whole of it.
      ...devices.filter((d) => !isHeadless(d)).map((d) => `${d.name}.html`),
      ...loose.map((f) => path.basename(f)),
      ...presets,
      ...docs,
      "wrapper.js",
    ];
    for (const f of files) {
      archive.append(createReadStream(path.join(outDir, f)), { name: `${name}/${f}` });
    }
    for (const f of installers) {
      archive.file(path.join(templates, f), { name: f, mode: 0o755 });
    }
    // A `site:` window's sidecar folder is part of the release, not an extra: the
    // .amxd alone opens that window empty. It is a directory rather than a listed
    // file, so it is added as a tree.
    for (const d of readdirSync(outDir, { withFileTypes: true })) {
      if (d.isDirectory() && d.name.slice(-5) === "-site") {
        archive.directory(path.join(outDir, d.name), `${name}/${d.name}`);
      }
    }
    archive.finalize();
  });

  const { size } = await stat(zipPath);
  console.log(`m4l-jweb: dist/${name}.zip (${size} bytes)`);
}

export async function buildAll(root) {
  buildWrapper(root);
  await generatePatchers(root);
  await packageDevices(root);
}

/* ------------------------------------------------------------------ *
 * Install
 *
 * Copy the built devices into Ableton's User Library. The per-platform scripts
 * are the real implementation (they have to read Live's own config files to find
 * the library); this just picks the right one and passes the device name.
 *
 * Live has no Linux build, so there is nothing to install there.
 * ------------------------------------------------------------------ */
export async function installDevices(root) {
  const { name } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));

  if (!existsSync(path.join(root, "dist", name))) {
    throw new Error(`nothing built at dist/${name} - run \`pnpm build\` first`);
  }

  // The packaged scripts are the real implementation - they have to read Live's
  // own config files to locate the User Library. Pass the device name and the
  // built folder explicitly, since the script does not live in the repo.
  const src = path.join(root, "dist", name);
  const runners = {
    win32: [
      "powershell",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(templates, "install-windows.ps1"), "-DeviceName", name, "-Src", src],
    ],
    darwin: ["bash", [path.join(templates, "install-mac.sh"), name, src]],
  };
  const runner = runners[process.platform];
  if (!runner) {
    throw new Error(`no installer for ${process.platform} - Ableton Live runs on macOS and Windows only`);
  }

  execFileSync(runner[0], runner[1], { stdio: "inherit", cwd: root });
}
