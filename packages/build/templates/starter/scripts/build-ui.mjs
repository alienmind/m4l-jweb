/**
 * build-ui.mjs - bundle one self-contained UI per device, plus one per WINDOW.
 *
 * Emits dist/ui/<device>/index.html (the device view) and, for every window the
 * device declares in its surface.ts, dist/ui/<device>/<winId>.html. `m4l-jweb
 * build` embeds all of them into the matching .amxd as base64 payloads.
 *
 * Sequential, not parallel: vite reads DEVICE from the environment, and two
 * concurrent builds would race on it. The builds are ~500 ms each.
 *
 * THE RENAME DANCE around the window builds is load-bearing. Vite always writes
 * its entry as `index.html`, so a window build lands on top of the device view we
 * just produced - and `emptyOutDir` cannot be left on for it either, or the window
 * build wipes the folder instead. So the device view is moved aside, the windows
 * are built and renamed one by one, and it is moved back.
 */
import { build } from "vite";
import { uiDirs } from "./devices.mjs";
// The PACKAGE export, not a path into packages/ - this file is copied verbatim
// into the `m4l-jweb init` scaffold (tests/starter.test.mjs pins that), and a
// scaffolded repo has no packages/ directory to reach into.
import { loadSurface } from "@m4l-jweb/build/surface";
import { renameSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

for (const dir of uiDirs) {
  process.env.DEVICE = dir;
  delete process.env.WINDOW; // ...so this build empties the out dir and is the device view
  console.log(`\nm4l-jweb: bundling UI for ${dir}`);
  await build();

  const outDir = path.join(root, "dist", "ui", dir);
  const surface = await loadSurface(root, dir);
  const windows = surface?.windows ? Object.keys(surface.windows) : [];
  if (!windows.length) continue;

  renameSync(path.join(outDir, "index.html"), path.join(outDir, "_device.html"));
  for (const winId of windows) {
    process.env.WINDOW = winId;
    process.env.WINDOW_ENTRY = surface.windows[winId].entry;
    console.log(`\nm4l-jweb: bundling window ${winId} for ${dir}`);
    await build();
    renameSync(path.join(outDir, "index.html"), path.join(outDir, `${winId}.html`));
  }
  renameSync(path.join(outDir, "_device.html"), path.join(outDir, "index.html"));
}

console.log(`\nm4l-jweb: ${uiDirs.length} UI bundle(s) -> dist/ui/`);
