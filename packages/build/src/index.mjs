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
import { createReadStream, createWriteStream, existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { copyFile, rename, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { AMXD_TYPES, assertES5, buildAmxd, extraPayloadsJs, payloadJs } from "./amxd.mjs";
import { CHAINS, addParameters, resetLayout } from "./chains.mjs";

const require = createRequire(import.meta.url);
const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const templates = path.join(pkgDir, "templates");

const UI_NAME = "ui.html";

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

/* ------------------------------------------------------------------ *
 * Step 2: the patchers
 * ------------------------------------------------------------------ */

async function readManifest(root) {
	const p = path.join(root, "patcher", "devices.mjs");
	if (!existsSync(p)) throw new Error("patcher/devices.mjs not found - a device repo needs a manifest");
	return (await import(pathToFileURL(p).href)).default;
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

export async function generatePatchers(root) {
	const devices = await readManifest(root);
	const base = readBase(root);
	await loadDeviceChains(root);
	const outDir = path.join(root, "dist", "patchers");
	mkdirSync(outDir, { recursive: true });

	for (const d of devices) {
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

		const unmatchedId = d.unmatchedTo === "js" ? "obj-js" : (d.unmatchedTo ?? "obj-js");

		for (const name of d.chains ?? []) {
			const chain = CHAINS[name];
			if (!chain) throw new Error(`unknown chain "${name}" for device "${d.name}" (known: ${Object.keys(CHAINS).join(", ")})`);
			chain({ boxes, lines, jwebId: "obj-jweb", unmatchedId, device: d });
		}

		// Parameters feed the UI: a knob move arrives as just another inlet message.
		addParameters(boxes, lines, d.parameters ?? [], "obj-jweb");

		writeFileSync(path.join(outDir, `${d.name}.json`), JSON.stringify(p, null, "\t"));
		console.log(`m4l-jweb: ${d.name}.json (${d.type}, chains: ${(d.chains ?? []).join(", ") || "none"})`);
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
export async function packageDevices(root) {
	const dist = path.join(root, "dist");
	const { name, version } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
	const devices = await readManifest(root);

	const outDir = path.join(dist, name);
	mkdirSync(outDir, { recursive: true });

	// vite emits dist/index.html (everything inlined by vite-plugin-singlefile).
	const uiPath = path.join(outDir, UI_NAME);
	const viteOut = path.join(dist, "index.html");
	if (existsSync(viteOut)) await rename(viteOut, uiPath);
	if (!existsSync(uiPath)) throw new Error(`no UI at ${uiPath} - run \`vite build\` first`);

	const uiHtml = readFileSync(uiPath);
	const wrapperJs = readFileSync(path.join(dist, "wrapper", "wrapper.js"), "utf8");

	// The build stamp is what makes a stale install visible: the wrapper posts it
	// and the UI renders it. Live embeds a copy of the device in the set, so an
	// instance already on a track does NOT update when you reinstall.
	const stamp = `${version} ${new Date().toISOString()}`;
	const banner = `var BUILD_STAMP = ${JSON.stringify(stamp)};\n`;

	for (const d of devices) {
		const deviceName = `${d.name}.amxd`;

		/**
		 * Payloads ride inside wrapper.js as base64 and are written to real files
		 * next to the .amxd on first load, because Chromium and any external
		 * process are blind to Max's frozen virtual filesystem. The UI is always
		 * one; a device can declare more (`payloads: ["dist/foo.cjs"]`).
		 */
		let wrapperData = banner + wrapperJs + payloadJs("UI_PAYLOAD", UI_NAME, uiHtml);
		const payloads = (d.payloads ?? []).map((f) => ({ name: path.basename(f), data: readFileSync(path.join(root, f)) }));
		if (payloads.length) wrapperData += extraPayloadsJs(payloads);

		const amxd = buildAmxd({
			patcherJson: readFileSync(path.join(dist, "patchers", `${d.name}.json`), "utf8"),
			wrapperJs: wrapperData,
			deviceName,
			// Frozen dependencies: readable by Max-native objects only (a poly~
			// voice patcher, say), which is exactly why they can stay frozen.
			extras: (d.extraFiles ?? []).map((f) => ({ name: path.basename(f), data: readFileSync(path.join(root, f)) })),
		});
		writeFileSync(path.join(outDir, deviceName), amxd);
		console.log(`m4l-jweb: ${deviceName} (${d.type}, ${amxd.length} bytes)`);
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
		const files = [...devices.map((d) => `${d.name}.amxd`), ...loose.map((f) => path.basename(f)), "wrapper.js", UI_NAME];
		for (const f of files) {
			archive.append(createReadStream(path.join(outDir, f)), { name: `${name}/${f}` });
		}
		for (const f of installers) {
			archive.file(path.join(templates, f), { name: f, mode: 0o755 });
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
