/**
 * files.mjs - the build side of defineFiles().
 *
 * The third of the same pipeline: import a device's declaration, and turn it into
 * the two things Max needs. Unlike watch.mjs it produces BOTH kinds of output -
 * data (the FILES_SPEC banner the wrapper reads) and a patcher CHAIN - because a
 * device that writes files needs [maxurl] in the box graph and a folder in the
 * page, and those two travelling separately is the failure the declaration exists
 * to make impossible.
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** The chain that owns [maxurl]. Every file-writing device needs it - see defineFiles. */
export const FILES_CHAIN = "download";

/**
 * Load a device's `src/app/<uiDir>/files.ts`, or null if it declares none.
 *
 * Bundled with esbuild exactly like loadSurface and loadWatch, for the same
 * reason: the declaration is TypeScript importing @m4l-jweb/surface, and Node
 * cannot import that directly.
 */
export async function loadFiles(root, uiDir) {
  const src = path.join(root, "src", "app", uiDir, "files.ts");
  if (!existsSync(src)) return null;

  const { build } = await import("esbuild");
  const tmp = mkdtempSync(path.join(tmpdir(), "m4l-files-"));
  const out = path.join(tmp, "files.mjs");
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
    const files = mod.default;
    if (!files || typeof files.saves !== "boolean" || typeof files.fetches !== "boolean") {
      throw new Error(`${src} must \`export default defineFiles({...})\``);
    }
    return files;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * The chain list this device is actually built with.
 *
 * A declared file device gets `download` whether or not the manifest asked for it,
 * appended LAST so it cannot displace an audio stage: `download` claims no stage of
 * the signal path, but chain order IS the signal path, and inserting anywhere else
 * would be a silent re-routing of a device that merely started writing files.
 *
 * Idempotent. A manifest that still lists `download` keeps exactly one - running the
 * chain twice would emit the same box ids twice, which assertUniqueBoxIds rejects.
 */
export function effectiveChains(chains, files) {
  const declared = chains ?? [];
  if (!files) return declared;
  return declared.includes(FILES_CHAIN) ? declared : [...declared, FILES_CHAIN];
}

/**
 * The `var FILES_SPEC = {...}` banner prepended to a device's wrapper.js.
 *
 * Only what the wrapper ACTS on travels. `tellPage` gates the `device_folder`
 * message at ui_ready; `saves` and `fetches` ride along because a device that has
 * never written anything still says so in the Max console, and a wrapper reporting
 * "this device writes no files" next to a save error is the cheapest possible answer
 * to "is it even wired for this".
 *
 * A device with no declaration gets no banner ("") - `typeof FILES_SPEC === "undefined"`
 * is exactly the guard the wrapper checks.
 */
export function filesSpecBanner(files) {
  if (!files) return "";
  const spec = { saves: !!files.saves, fetches: !!files.fetches, tellPage: !!files.tellPage };
  return `var FILES_SPEC = ${JSON.stringify(spec)};\n`;
}
