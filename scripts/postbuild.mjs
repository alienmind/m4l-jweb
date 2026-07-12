/**
 * postbuild.mjs - assemble the distributable. Runs after vite build,
 * build-wrapper and generate-patchers.
 *
 * 1. dist/index.html            -> dist/<pkg>/ui.html   (the single-file UI)
 * 2. dist/patchers/<name>.json  -> dist/<pkg>/<name>.amxd, one per manifest entry
 * 3. dist/wrapper/wrapper.js    -> dist/<pkg>/           (loose copy, for reference)
 * 4. dist/<pkg>.zip                                      (release archive + installers)
 *
 * Each .amxd is self-contained: the UI travels inside it as a base64 payload in
 * wrapper.js. The loose ui.html/wrapper.js next to it are for inspection, not a
 * runtime requirement.
 */
import archiver from "archiver";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { rename, copyFile, mkdir, readFile, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");

const { name } = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const devices = (await import(pathToFileURL(path.join(root, "patcher", "devices.mjs")).href)).default;

const outDir = path.join(dist, name);
await mkdir(outDir, { recursive: true });

const uiPath = path.join(outDir, "ui.html");
await rename(path.join(dist, "index.html"), uiPath);
console.log(`postbuild: dist/index.html -> dist/${name}/ui.html`);

const wrapperJs = path.join(dist, "wrapper", "wrapper.js");
for (const d of devices) {
	execFileSync(
		process.execPath,
		[
			path.join(root, "scripts", "build-amxd.mjs"),
			path.join(dist, "patchers", `${d.name}.json`),
			wrapperJs,
			uiPath,
			path.join(outDir, `${d.name}.amxd`),
			...(d.extraFiles ?? []).map((f) => path.join(root, f)),
		],
		{ stdio: "inherit" },
	);
}

await copyFile(wrapperJs, path.join(outDir, "wrapper.js"));
console.log(`postbuild: wrapper.js -> dist/${name}/wrapper.js`);

const zipPath = path.join(dist, `${name}.zip`);
await new Promise((resolve, reject) => {
	const output = createWriteStream(zipPath);
	const archive = archiver("zip", { zlib: { level: 9 } });
	output.on("close", resolve);
	archive.on("error", reject);
	archive.pipe(output);

	const files = [...devices.map((d) => `${d.name}.amxd`), "wrapper.js", "ui.html"];
	for (const f of files) {
		const p = path.join(outDir, f);
		if (existsSync(p)) archive.append(createReadStream(p), { name: `${name}/${f}` });
	}
	for (const installer of ["install-windows.ps1", "install-mac.sh", "install-linux.sh"]) {
		archive.file(path.join(root, "scripts", installer), { name: installer, mode: 0o755 });
	}
	archive.finalize();
});

const { size } = await stat(zipPath);
console.log(`postbuild: dist/${name}.zip (${size} bytes)`);
