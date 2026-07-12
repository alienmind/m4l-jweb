import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";
import pkg from "./package.json";

// The device UI is bundled into ONE self-contained index.html (every script,
// style and asset inlined) so it can be embedded in the .amxd as a base64
// payload and extracted to a real file:// path that jweb (Chromium) reads.
export default defineConfig({
	base: "./",
	plugins: [react(), viteSingleFile()],
	resolve: {
		alias: [{ find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) }],
	},
	define: {
		__APP_VERSION__: JSON.stringify(pkg.version),
	},
	// A compute worker (src/app/worker.ts) is inlined into the single chunk:
	// a ?worker&inline blob URL cannot resolve relative chunk imports at
	// runtime, so bundle dynamic imports in too.
	worker: {
		format: "es",
		rollupOptions: {
			output: {
				inlineDynamicImports: true,
			},
		},
	},
	build: {
		outDir: "dist",
		emptyOutDir: true,
	},
});
