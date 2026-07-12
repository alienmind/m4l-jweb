/**
 * amxd.test.mjs - CI invariant: the built container round-trips.
 *
 * Build a real .amxd, then parse it back byte-for-byte and assert the header,
 * the directory entries and every payload's size/offset. The container writer is
 * ~150 lines of Buffer code against an undocumented format - this test is what
 * lets us trust it without ever opening Max.
 */
import { expect, test } from "vitest";
import { AMXD_TYPES, assertES5, buildAmxd, payloadJs } from "../src/amxd.mjs";

const PATCHER = JSON.stringify({
	patcher: { boxes: [], lines: [], project: { amxdtype: AMXD_TYPES.midi } },
});
const WRAPPER_JS = "var x = 1;\nfunction bang() { post('hi'); }\n"; // valid ES5
const UI_HTML = Buffer.from("<!doctype html><title>t</title><p>hello</p>");
const DEVICE = "test-device.amxd";

const wrapperWithPayload = 'var BUILD_STAMP = "1.2.3 now";\n' + WRAPPER_JS + payloadJs("UI_PAYLOAD", "ui.html", UI_HTML);

const amxd = buildAmxd({ patcherJson: PATCHER, wrapperJs: wrapperWithPayload, deviceName: DEVICE });

/** Walk the container back into { deviceType, files: [{name, type, data}] }. */
function parseAmxd(buf) {
	expect(buf.subarray(0, 4).toString("latin1")).toBe("ampf");
	const deviceType = buf.subarray(8, 12).toString("latin1");

	expect(buf.subarray(12, 16).toString("latin1")).toBe("meta");
	expect(buf.subarray(24, 28).toString("latin1")).toBe("ptch");
	const ptch = buf.subarray(32, 32 + buf.readUInt32LE(28));

	expect(ptch.subarray(0, 4).toString("latin1")).toBe("mx@c");
	const payloadEnd = ptch.readUInt32BE(12); // 16 + total payload bytes

	const dlst = ptch.subarray(payloadEnd); // the directory sits after the payloads
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

test("the header carries the device-type tag from project.amxdtype", () => {
	expect(parseAmxd(amxd).deviceType).toBe("mmmm");

	const audio = buildAmxd({
		patcherJson: JSON.stringify({ patcher: { project: { amxdtype: AMXD_TYPES.audio } } }),
		wrapperJs: WRAPPER_JS,
		deviceName: DEVICE,
	});
	expect(parseAmxd(audio).deviceType).toBe("aaaa");
});

test("the directory lists the patcher and the wrapper", () => {
	const { files } = parseAmxd(amxd);
	expect(files.map((f) => f.name)).toEqual([DEVICE, "wrapper.js"]);
	expect(files[0].type).toBe("JSON");
	expect(files[1].type).toBe("TEXT");
});

test("the patcher JSON round-trips", () => {
	const { files } = parseAmxd(amxd);
	expect(JSON.parse(files[0].data.toString("utf8"))).toEqual(JSON.parse(PATCHER));
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

test("extra frozen dependencies are embedded", () => {
	const withExtra = buildAmxd({
		patcherJson: PATCHER,
		wrapperJs: WRAPPER_JS,
		deviceName: DEVICE,
		extras: [{ name: "voice.maxpat", data: Buffer.from('{"patcher":{}}') }],
	});
	const { files } = parseAmxd(withExtra);
	expect(files.map((f) => f.name)).toEqual([DEVICE, "wrapper.js", "voice.maxpat"]);
	expect(files[2].type).toBe("JSON"); // .maxpat is JSON, not TEXT
});

test("the UI survives as a base64 payload the wrapper can extract", () => {
	const wrapper = parseAmxd(amxd).files[1].data.toString("utf8");

	expect(wrapper).toContain("var BUILD_STAMP =");
	expect(wrapper).toContain('var UI_PAYLOAD_NAME = "ui.html";');
	expect(wrapper).toContain(`var UI_PAYLOAD_BYTES = ${UI_HTML.length};`);

	// The bytes it declares must be the bytes we shipped.
	const b64 = /var UI_PAYLOAD_B64 = \[([\s\S]*?)\n\];/.exec(wrapper)[1];
	const decoded = Buffer.concat(JSON.parse(`[${b64}]`).map((c) => Buffer.from(c, "base64")));
	expect(decoded.equals(UI_HTML)).toBe(true);
});

test("a wrapper that is not ES5 fails the build", () => {
	// One arrow function kills the whole script at load in Max, with a one-line
	// error and no stack. Refusing to package is the only sane response.
	expect(() => assertES5("const f = () => 1;")).toThrow(/not valid ES5/);
	expect(() => buildAmxd({ patcherJson: PATCHER, wrapperJs: "let x = () => 1;", deviceName: DEVICE })).toThrow(/not valid ES5/);
});

test("an unknown device type fails the build", () => {
	const bad = JSON.stringify({ patcher: { project: { amxdtype: 12345 } } });
	expect(() => buildAmxd({ patcherJson: bad, wrapperJs: WRAPPER_JS, deviceName: DEVICE })).toThrow(/unknown project.amxdtype/);
});
