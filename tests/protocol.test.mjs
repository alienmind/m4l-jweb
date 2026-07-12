/**
 * protocol.test.mjs - CI invariants for the bridge contract.
 *
 * src/app/protocol.ts is the single source of truth for the selectors crossing
 * the UI <-> device boundary. A selector the app emits that nothing routes, or
 * one the app binds that nothing ever sends, is a message silently falling on
 * the floor - the single most common way to lose an evening here. So: every
 * selector must be accounted for on the Max side.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(path.join(root, p), "utf8");

const protocol = read("src/app/protocol.ts");
const wrapper = read("wrapper/wrapper.ts");
const generator = read("scripts/generate-patchers.mjs");
const base = read("patcher/base.json");

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
	// The device -> UI direction: the wrapper outlets it, or a generated chain
	// prepends it (e.g. `prepend notein`), or it is a manifest parameter id.
	for (const sel of IN) {
		const sent = wrapper.includes(`"${sel}"`) || generator.includes(`prepend ${sel}`) || generator.includes(`"${sel}"`);
		expect(sent, `IN selector "${sel}" is never sent from the Max side`).toBe(true);
	}
});

test("every OUT selector is handled by the wrapper or routed by a chain", () => {
	// The UI -> device direction: the wrapper has a handler function of that
	// name, or a generated [route ...] claims it.
	for (const sel of OUT) {
		const handled = new RegExp(`function ${sel}\\s*\\(`).test(wrapper) || new RegExp(`route [^"']*\\b${sel}\\b`).test(generator);
		expect(handled, `OUT selector "${sel}" is never handled or routed on the Max side`).toBe(true);
	}
});

test("no [node.script] in the default template", () => {
	// It adds a process manager and a boot handshake, and its failure modes in
	// Live range from silently ignoring `script start` to crashing the host.
	// A Web Worker inside jweb covers pure computation with none of that.
	expect(base).not.toContain("node.script");
	expect(generator).not.toContain("node.script");
});
