/**
 * protocol.test.mjs - CI invariants for the bridge contract.
 *
 * src/app/protocol.ts is the single source of truth for the selectors crossing
 * the UI <-> device boundary. A selector the app emits that nothing routes, or
 * one the app binds that nothing ever sends, is a message silently falling on
 * the floor - and it produces no error at runtime. So: every selector must be
 * accounted for on the Max side.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const protocol = readFileSync(path.join(root, "src/app/protocol.ts"), "utf8");

// The Max side now lives in the packages: the wrapper sources are what [js]
// runs, and the chain vocabulary is what the generated patcher routes.
const { sources } = require("@m4l-jweb/wrapper/sources");
const wrapper = sources.map((f) => readFileSync(f, "utf8")).join("\n");
const chains = readFileSync(require.resolve("@m4l-jweb/build/chains"), "utf8");
const base = readFileSync(path.join(path.dirname(require.resolve("@m4l-jweb/build")), "..", "templates", "base.json"), "utf8");

/** Pull the selector string literals out of protocol.ts's IN/OUT blocks. */
function selectors(block) {
	const body = new RegExp(`export const ${block} = \\{([\\s\\S]*?)\\} as const;`).exec(protocol);
	expect(body, `protocol.ts must export a ${block} block`).not.toBeNull();
	return [...body[1].matchAll(/^\s*(\w+):\s*"([^"]+)"/gm)].map((m) => m[2]);
}

const IN = selectors("IN");
const OUT = selectors("OUT");

test("protocol.ts declares selectors in both directions", () => {
	expect(IN.length).toBeGreaterThan(0);
	expect(OUT.length).toBeGreaterThan(0);
});

test("every IN selector is actually sent by the wrapper or a chain", () => {
	// Device -> UI: the wrapper outlets it, or a chain prepends it (e.g.
	// `prepend notein`), or it is a manifest parameter id.
	for (const sel of IN) {
		const sent = wrapper.includes(`"${sel}"`) || chains.includes(`prepend ${sel}`) || chains.includes(`"${sel}"`);
		expect(sent, `IN selector "${sel}" is never sent from the Max side`).toBe(true);
	}
});

test("every OUT selector is handled by the wrapper or routed by a chain", () => {
	// UI -> device: the wrapper has a handler function of that name, or a
	// generated [route ...] claims it.
	for (const sel of OUT) {
		const handled = new RegExp(`function ${sel}\\s*\\(`).test(wrapper) || new RegExp(`route [^"']*\\b${sel}\\b`).test(chains);
		expect(handled, `OUT selector "${sel}" is never handled or routed on the Max side`).toBe(true);
	}
});

test("no [node.script] in the default template", () => {
	// It adds a process manager and a boot handshake, and its failure modes in
	// Live range from silently ignoring `script start` to crashing the host. A Web
	// Worker inside jweb covers pure computation with none of that.
	expect(base).not.toContain("node.script");
	expect(chains).not.toContain("node.script");
	expect(wrapper).not.toContain("node.script");
});
