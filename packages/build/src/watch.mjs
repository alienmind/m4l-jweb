/**
 * watch.mjs - the build side of defineWatch().
 *
 * The twin of surface.mjs's loadSurface: it imports a device's watch declaration
 * and turns it into the WATCH_SPECS the packaged wrapper reads. The wrapper is
 * generic; this is where a device's specific list of Live properties to observe
 * enters, as an injected data banner - exactly as BUILD_STAMP and the payloads do.
 *
 * There is no patcher wiring here, and that is the point: an observer is pure
 * LiveAPI, created in [js] from bang(), so nothing crosses into the patcher graph.
 * The declaration produces DATA, not boxes.
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Load a device's `src/app/<uiDir>/watch.ts`, or null if it declares none.
 *
 * Bundled with esbuild exactly like loadSurface, for the same reason: the
 * declaration is TypeScript importing @m4l-jweb/surface, and Node cannot import
 * that directly.
 */
export async function loadWatch(root, uiDir) {
  const src = path.join(root, "src", "app", uiDir, "watch.ts");
  if (!existsSync(src)) return null;

  const { build } = await import("esbuild");
  const tmp = mkdtempSync(path.join(tmpdir(), "m4l-watch-"));
  const out = path.join(tmp, "watch.mjs");
  try {
    await build({
      entryPoints: [src],
      outfile: out,
      bundle: true,
      format: "esm",
      platform: "node",
      logLevel: "silent",
      external: ["react", "react-dom"],
    });
    const mod = await import(pathToFileURL(out).href);
    const watch = mod.default;
    if (!watch?.keys) {
      throw new Error(`${src} must \`export default defineWatch({...})\``);
    }
    return watch;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * The `var WATCH_SPECS = [...]` banner prepended to a device's wrapper.js.
 *
 * Only what the wrapper needs to ATTACH the observer travels: the selector key,
 * the LOM path, the property. The `default` is the app's business (it seeds
 * useWatch before Live replies) and never reaches Max, so it is dropped here -
 * shipping it would be dead weight inside every .amxd.
 *
 * A device with no watches gets no banner ("") - `typeof WATCH_SPECS === "undefined"`
 * is exactly the guard the wrapper's setupWatches() checks.
 */
export function watchSpecsBanner(watch) {
  if (!watch || !watch.keys.length) return "";
  const specs = watch.keys.map((key) => {
    const w = watch.watches[key];
    return { key, path: w.path, property: w.property };
  });
  return `var WATCH_SPECS = ${JSON.stringify(specs)};\n`;
}
