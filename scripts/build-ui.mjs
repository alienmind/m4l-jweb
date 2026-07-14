/**
 * build-ui.mjs - bundle one self-contained UI per device.
 *
 * Emits dist/ui/<device>/index.html, which `m4l-jweb build` then embeds into the
 * matching .amxd as a base64 payload.
 *
 * Sequential, not parallel: vite reads DEVICE from the environment, and two
 * concurrent builds would race on it. The builds are ~500 ms each.
 */
import { build } from "vite";
import { uiDirs } from "./devices.mjs";
import { loadSurface } from "../packages/build/src/surface.mjs";
import { renameSync, copyFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

for (const dir of uiDirs) {
  process.env.DEVICE = dir;
  console.log(`\nm4l-jweb: bundling UI for ${dir}`);
  delete process.env.WINDOW;
  await build();

  const outDir = path.join(root, "dist", "ui", dir);
  renameSync(path.join(outDir, "index.html"), path.join(outDir, "_main_index.html"));

  const surface = await loadSurface(root, dir);
  if (surface && surface.windows) {
    for (const winId of Object.keys(surface.windows)) {
      process.env.WINDOW = winId;
      process.env.WINDOW_ENTRY = surface.windows[winId].entry;
      console.log(`\nm4l-jweb: bundling window ${winId} for ${dir}`);
      await build();
      
      renameSync(path.join(outDir, "index.html"), path.join(outDir, `${winId}.html`));
    }
  }

  renameSync(path.join(outDir, "_main_index.html"), path.join(outDir, "index.html"));
}

console.log(`\nm4l-jweb: ${uiDirs.length} UI bundle(s) -> dist/ui/`);
