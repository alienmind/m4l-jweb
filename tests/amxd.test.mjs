/**
 * amxd.test.mjs - CI invariant: the built container round-trips.
 *
 * Build a real .amxd from fixtures, then parse it back byte-for-byte and
 * assert the header, the directory entries and every payload's size/offset.
 * The container writer is 150 lines of Buffer code against an undocumented
 * format - this test is what lets us trust it without opening Max.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, test } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let dir;
let amxd;

const PATCHER = {
	patcher: {
		boxes: [],
		lines: [],
		project: { amxdtype: 0x6d6d6d6d }, // 'mmmm' - MIDI effect
	},
};
const WRAPPER_JS = "var x = 1;\nfunction bang() { post('hi'); }\n"; // valid ES5
const UI_HTML = "<!doctype html><title>t</title><p>hello</p>";

beforeAll(() => {
	dir = mkdtempSync(path.join(tmpdir(), "m4l-jweb-"));
	const patcherPath = path.join(dir, "p.json");
	const wrapperPath = path.join(dir, "wrapper.js");
	const uiPath = path.join(dir, "ui.html");
	const outPath = path.join(dir, "test-device.amxd");

	writeFileSync(patcherPath, JSON.stringify(PATCHER));
	writeFileSync(wrapperPath, WRAPPER_JS);
	writeFileSync(uiPath, UI_HTML);

	execFileSync(process.execPath, [path.join(root, "scripts", "build-amxd.mjs"), patcherPath, wrapperPath, uiPath, outPath], {
		stdio: "pipe",
	});
	amxd = readFileSync(outPath);
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Walk the container back into { header, files: [{name, type, data}] }. */
function parseAmxd(buf) {
	expect(buf.subarray(0, 4).toString("latin1")).toBe("ampf");
	const deviceType = buf.subarray(8, 12).toString("latin1");

	expect(buf.subarray(12, 16).toString("latin1")).toBe("meta");
	expect(buf.subarray(24, 28).toString("latin1")).toBe("ptch");
	const ptchLen = buf.readUInt32LE(28);
	const ptch = buf.subarray(32, 32 + ptchLen);

	expect(ptch.subarray(0, 4).toString("latin1")).toBe("mx@c");
	const payloadEnd = ptch.readUInt32BE(12); // 16 + total payload bytes

	// The directory sits right after the payload region.
	const dlst = ptch.subarray(payloadEnd);
	expect(dlst.subarray(0, 4).toString("latin1")).toBe("dlst");

	const files = [];
	let p = 8; // past 'dlst' + size
	while (p < dlst.length) {
		expect(dlst.subarray(p, p + 4).toString("latin1")).toBe("dire");
		const direLen = dlst.readUInt32BE(p + 4);
		const dire = dlst.subarray(p + 8, p + direLen);

		const fields = {};
		let q = 0;
		while (q < dire.length) {
			const tag = dire.subarray(q, q + 4).toString("latin1");
			const len = dire.readUInt32BE(q + 4);
			fields[tag] = dire.subarray(q + 8, q + len);
			q += len;
		}
		const size = fields.sz32.readUInt32BE(0);
		const offset = fields.of32.readUInt32BE(0);
		files.push({
			name: fields.fnam.toString("latin1").replace(/\0.*$/, ""),
			type: fields.type.toString("latin1"),
			size,
			offset,
			data: ptch.subarray(offset, offset + size),
		});
		p += direLen;
	}
	return { deviceType, payloadEnd, files };
}

test("header carries the device-type tag from project.amxdtype", () => {
	expect(parseAmxd(amxd).deviceType).toBe("mmmm");
});

test("directory lists the patcher and the wrapper", () => {
	const { files } = parseAmxd(amxd);
	expect(files.map((f) => f.name)).toEqual(["test-device.amxd", "wrapper.js"]);
	expect(files[0].type).toBe("JSON");
	expect(files[1].type).toBe("TEXT");
});

test("the patcher JSON round-trips", () => {
	const { files } = parseAmxd(amxd);
	expect(JSON.parse(files[0].data.toString("utf8"))).toEqual(PATCHER);
});

test("payload offsets are contiguous from 16 and cover the region exactly", () => {
	const { files, payloadEnd } = parseAmxd(amxd);
	let expected = 16;
	for (const f of files) {
		expect(f.offset).toBe(expected);
		expect(f.data.length).toBe(f.size);
		expected += f.size;
	}
	expect(payloadEnd).toBe(expected);
});

test("the wrapper is embedded with the build stamp and the UI payload", () => {
	const { files } = parseAmxd(amxd);
	const wrapper = files[1].data.toString("utf8");

	expect(wrapper).toContain("var BUILD_STAMP =");
	expect(wrapper).toContain(WRAPPER_JS);

	// The UI must survive as a base64 payload the wrapper can extract: the
	// bytes it declares have to be the bytes we shipped.
	expect(wrapper).toContain('var UI_PAYLOAD_NAME = "ui.html";');
	expect(wrapper).toContain(`var UI_PAYLOAD_BYTES = ${Buffer.byteLength(UI_HTML)};`);

	const b64 = /var UI_PAYLOAD_B64 = \[([\s\S]*?)\n\];/.exec(wrapper)[1];
	const decoded = JSON.parse(`[${b64}]`)
		.map((chunk) => Buffer.from(chunk, "base64").toString("utf8"))
		.join("");
	expect(decoded).toBe(UI_HTML);
});

test("a wrapper that is not ES5 fails the build", () => {
	const badWrapper = path.join(dir, "bad-wrapper.js");
	writeFileSync(badWrapper, "const f = () => 1;\n"); // arrow fn + const: ES6

	expect(() =>
		execFileSync(
			process.execPath,
			[
				path.join(root, "scripts", "build-amxd.mjs"),
				path.join(dir, "p.json"),
				badWrapper,
				path.join(dir, "ui.html"),
				path.join(dir, "bad.amxd"),
			],
			{ stdio: "pipe" },
		),
	).toThrow();
});
