/**
 * amxd.mjs - write a Max for Live .amxd container, headless. No Max in the loop.
 *
 * The format is undocumented but simple, reverse-engineered from devices saved
 * by Max 8/9:
 *
 *   'ampf' <u32le 4> <'aaaa'|'mmmm'|'iiii'>   audio / midi / instrument
 *   'meta' <u32le 4> <u32le 7>
 *   'ptch' <u32le size-to-EOF>
 *     'mx@c' <u32be 16> <u32be 0> <u32be 16 + payload sizes (excl. dlst)>
 *     <patcher JSON> <dependency payloads...>
 *     'dlst' <u32be chunk size incl. header>   directory: one 'dire' per file
 *
 * The device is written "frozen", with the wrapper embedded (the same shape Max
 * produces when you freeze), so Max never resolves it via a search path. The
 * internal main-patcher name is set to the output file's basename.
 *
 * This is the piece that removes Max from the loop entirely.
 */
import { parse } from "acorn";

/** 'aaaa' audio effect / 'mmmm' MIDI effect / 'iiii' instrument. */
export const AMXD_TYPES = {
  midi: 0x6d6d6d6d,
  audio: 0x61616161,
  instrument: 0x69696969,
};

const TAG_BY_CODE = { 0x61616161: "aaaa", 0x6d6d6d6d: "mmmm", 0x69696969: "iiii" };

/**
 * Max's [js] is an ES5-era interpreter: one modern token (an arrow function, a
 * `const`, a trailing comma in a call) kills the whole script at load with a
 * bare "syntax error" and no stack. So ES5 is a build GATE, not a style
 * preference. Call this on the exact bytes that will ship.
 */
export function assertES5(js, label = "wrapper") {
  try {
    parse(js, { ecmaVersion: 5 });
  } catch (e) {
    throw new Error(`${label} is not valid ES5: ${e.message}`);
  }
}

/**
 * Encode a Buffer as base64 chunks assigned to `<prefix>_B64`, plus its name and
 * byte count, as ES5 source appended to the wrapper.
 *
 * Why: Chromium (jweb) cannot read Max's frozen virtual filesystem, so a UI
 * frozen into the device is invisible to it. The wrapper, however, always runs -
 * so it carries the payload and writes it to a real file on first load.
 */
export function payloadJs(prefix, name, buf) {
  const CHUNK = 30000; // multiple of 3 -> each chunk is padding-free base64
  const chunks = [];
  for (let i = 0; i < buf.length; i += CHUNK) {
    chunks.push(JSON.stringify(buf.subarray(i, i + CHUNK).toString("base64")));
  }
  return (
    `\n// ---- generated: embedded ${prefix} payload ----\n` +
    `var ${prefix}_NAME = ${JSON.stringify(name)};\n` +
    `var ${prefix}_BYTES = ${buf.length};\n` +
    `var ${prefix}_B64 = [\n${chunks.join(",\n")}\n];\n`
  );
}

/**
 * Additional self-extracting payloads, beyond the UI.
 *
 * Same reasoning as the UI payload: anything that is NOT a Max-native object
 * (an external process, a Node bundle, a data file read by the web app) cannot
 * see a frozen dependency, so it has to become a real file on disk. The wrapper
 * writes each of these next to the .amxd on load - see extractExtraPayloads() in
 * the wrapper's core.ts.
 */
export function extraPayloadsJs(payloads) {
  const names = payloads.map((p) => JSON.stringify(p.name));
  const bytes = payloads.map((p) => p.data.length);
  const blobs = payloads.map((p) => {
    const CHUNK = 30000;
    const chunks = [];
    for (let i = 0; i < p.data.length; i += CHUNK) {
      chunks.push(JSON.stringify(p.data.subarray(i, i + CHUNK).toString("base64")));
    }
    return `[\n${chunks.join(",\n")}\n]`;
  });
  return (
    `\n// ---- generated: ${payloads.length} extra payload(s) ----\n` +
    `var EXTRA_PAYLOAD_NAMES = [${names.join(", ")}];\n` +
    `var EXTRA_PAYLOAD_BYTES = [${bytes.join(", ")}];\n` +
    `var EXTRA_PAYLOAD_B64 = [\n${blobs.join(",\n")}\n];\n`
  );
}

const u32be = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0);
  return b;
};
const u32le = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
};
const field = (tag, payload) => Buffer.concat([Buffer.from(tag, "latin1"), u32be(8 + payload.length), payload]);
const paddedName = (name) => {
  const raw = Buffer.from(name + "\0", "latin1");
  return Buffer.concat([raw, Buffer.alloc((4 - (raw.length % 4)) % 4)]);
};

/**
 * Build the .amxd bytes.
 *
 * @param {object}   o
 * @param {string}   o.patcherJson  the patcher, as JSON text
 * @param {string}   o.wrapperJs    the ES5 wrapper (payloads already appended)
 * @param {string}   o.deviceName   basename of the output file, e.g. "my-device.amxd"
 * @param {Array<{name,data,type?}>} [o.extras]  extra frozen dependencies
 * @returns {Buffer}
 */
export function buildAmxd({ patcherJson, wrapperJs, deviceName, extras = [] }) {
  assertES5(wrapperJs, "wrapper.js");

  const amxdtype = JSON.parse(patcherJson).patcher?.project?.amxdtype;
  const deviceTag = TAG_BY_CODE[amxdtype];
  if (!deviceTag) throw new Error(`unknown project.amxdtype ${amxdtype}`);

  const macDate = Math.floor(Date.now() / 1000) + 2082844800; // secs since 1904-01-01

  const files = [
    { type: "JSON", name: deviceName, data: Buffer.from(patcherJson, "utf8"), flag: 0x11 },
    { type: "TEXT", name: "wrapper.js", data: Buffer.from(wrapperJs, "utf8"), flag: 0 },
    ...extras.map((e) => ({
      type: e.type ?? (/\.(maxpat|json)$/.test(e.name) ? "JSON" : "TEXT"),
      name: e.name,
      data: e.data,
      flag: 0,
    })),
  ];

  // Payload region: the patcher JSON first, at offset 16 (right after mx@c).
  let offset = 16;
  const entries = [];
  for (const f of files) {
    const at = offset;
    offset += f.data.length;
    entries.push(
      field(
        "dire",
        Buffer.concat([
          field("type", Buffer.from(f.type, "latin1")),
          field("fnam", paddedName(f.name)),
          field("sz32", u32be(f.data.length)),
          field("of32", u32be(at)),
          field("vers", u32be(0)),
          field("flag", u32be(f.flag)),
          field("mdat", u32be(macDate)),
        ]),
      ),
    );
  }

  const payload = Buffer.concat(files.map((f) => f.data));
  const mxc = Buffer.concat([Buffer.from("mx@c", "latin1"), u32be(16), u32be(0), u32be(16 + payload.length)]);
  const ptchBody = Buffer.concat([mxc, payload, field("dlst", Buffer.concat(entries))]);

  return Buffer.concat([
    Buffer.from("ampf", "latin1"),
    u32le(4),
    Buffer.from(deviceTag, "latin1"),
    Buffer.from("meta", "latin1"),
    u32le(4),
    u32le(7),
    Buffer.from("ptch", "latin1"),
    u32le(ptchBody.length),
    ptchBody,
  ]);
}
