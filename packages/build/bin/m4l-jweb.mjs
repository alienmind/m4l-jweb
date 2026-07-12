#!/usr/bin/env node
/**
 * m4l-jweb - the device build CLI.
 *
 *   m4l-jweb build      wrapper + patchers + package (the usual one)
 *   m4l-jweb wrapper    compile wrapper/*.ts to one ES5 script, acorn-gated
 *   m4l-jweb patchers   manifest -> one patcher JSON per device
 *   m4l-jweb package    write each .amxd + the release zip
 *
 * Run from a device repo. Bundling the UI (`vite build`) is the app's job and
 * stays in the repo's own npm scripts; everything Max-shaped lives here.
 */
import { buildAll, buildWrapper, generatePatchers, packageDevices } from "../src/index.mjs";

const commands = {
	build: buildAll,
	wrapper: async (root) => void buildWrapper(root),
	patchers: async (root) => void (await generatePatchers(root)),
	package: packageDevices,
};

const cmd = process.argv[2] ?? "build";
const run = commands[cmd];

if (!run) {
	console.error(`m4l-jweb: unknown command "${cmd}"\nusage: m4l-jweb [${Object.keys(commands).join(" | ")}]`);
	process.exit(1);
}

try {
	await run(process.cwd());
} catch (e) {
	console.error(`m4l-jweb: ${e.message}`);
	process.exit(1);
}
