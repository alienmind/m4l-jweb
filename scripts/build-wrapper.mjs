/**
 * build-wrapper.mjs - compile wrapper/wrapper.ts to ES5 and gate it.
 *
 * Max's [js] runs an ES5-era interpreter. ONE modern token (an arrow function,
 * a `const`, a trailing comma in a call) kills the whole script at load, with a
 * one-line "syntax error" and no stack. So ES5 here is a build gate, not a
 * style preference: tsc emits it, and acorn proves it.
 *
 * Output: dist/wrapper/wrapper.js
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "acorn";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outFile = path.join(root, "dist", "wrapper", "wrapper.js");

execFileSync(process.execPath, [path.join(root, "node_modules", "typescript", "bin", "tsc"), "-p", path.join(root, "wrapper", "tsconfig.json")], {
	stdio: "inherit",
});

const js = readFileSync(outFile, "utf8");
try {
	parse(js, { ecmaVersion: 5 });
} catch (e) {
	console.error(`build-wrapper: emitted wrapper.js is NOT valid ES5: ${e.message}`);
	process.exit(1);
}

console.log(`build-wrapper: dist/wrapper/wrapper.js (${js.length} bytes, ES5 verified)`);
