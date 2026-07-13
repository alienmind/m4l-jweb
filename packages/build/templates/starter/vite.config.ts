import { defineConfig, type UserConfig } from "vite";
import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";
import pkg from "./package.json";
import { devices, uiDir } from "./scripts/devices.mjs";

/**
 * ONE BUILD PER DEVICE.
 *
 * A repo can hold several devices, each .amxd embeds its OWN UI bundle, and a
 * device should ship what it is - not its siblings' code. So the app to bundle is
 * chosen here, by DEVICE, and src/main.tsx imports it through the `@device`
 * alias. There is no `if (mode === ...)` anywhere in the app.
 *
 * DEVICE is set by scripts/dev.mjs and scripts/build-ui.mjs (which read the
 * device list from patcher/devices.mjs). It is an env var rather than vite's
 * `--mode` deliberately: `--mode` also flips `import.meta.env.DEV`, and a build
 * with DEV=true would ship the dev harness inside the device.
 */
//
// NOTE this is a FACTORY, not a plain object. scripts/build-ui.mjs sets DEVICE
// and calls vite's build() once per device in the same process; a top-level
// `const DEVICE = process.env.DEVICE` would be evaluated once, when the module
// was first loaded, and every device after the first would be built from the
// first one's sources. Vite invokes the factory on each config load, so reading
// the env var HERE is what makes the loop work.
export default defineConfig(() => {
  // Falls back to the first device in the manifest, so a bare `vite` still runs
  // something and this config carries no device name of its own.
  const DEVICE = process.env.DEVICE ?? uiDir(devices[0]);

  // The device UI is bundled into ONE self-contained index.html (every script,
  // style and asset inlined) so it can be embedded in the .amxd as a base64
  // payload and extracted to a real file:// path that jweb (Chromium) reads.
  const WINDOW_ENTRY = process.env.WINDOW_ENTRY;

  const config: UserConfig = {
    base: "./",
  plugins: [react(), viteSingleFile()],
  resolve: {
    alias: [
      { find: "@device/App", replacement: fileURLToPath(new URL(`./src/app/${DEVICE}/${WINDOW_ENTRY ? WINDOW_ENTRY : "App"}`, import.meta.url)) },
      { find: "@device", replacement: fileURLToPath(new URL(`./src/app/${DEVICE}`, import.meta.url)) },
      { find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) },
    ],
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __DEVICE__: JSON.stringify(DEVICE),
  },
  // A compute worker (src/app/shared/worker.ts) is inlined into the single chunk:
  // a ?worker&inline blob URL cannot resolve relative chunk imports at runtime,
  // so bundle dynamic imports in too.
  worker: {
    format: "es",
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
    build: {
      // dist/ui/<device>/index.html - one per device, picked up by `m4l-jweb build`.
      outDir: `dist/ui/${DEVICE}`,
      emptyOutDir: !process.env.WINDOW,
    },
  };
  return config;
});
