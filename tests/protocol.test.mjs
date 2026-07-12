/**
 * protocol.test.mjs - CI invariants for the bridge contract.
 *
 * Each device's protocol.ts is the single source of truth for the selectors
 * crossing ITS bridge. A selector the app emits that nothing routes, or one it
 * binds that nothing ever sends, is a message silently falling on the floor -
 * and it produces no error at runtime. So: every selector must be accounted for
 * on the Max side.
 *
 * "The Max side" is several things, and a lint that reads only some of them
 * quietly stops checking: the packaged wrapper and chains, this repo's own
 * patcher/chains.mjs and wrapper/device.ts, the manifest's parameters (a
 * live.dial reaches the UI as `<id> <value>`, so a parameter id IS a selector),
 * and - above all - the GENERATED patchers, which are what actually ships.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const bridge = readFileSync(require.resolve("@m4l-jweb/bridge"), "utf8");

// The Max side. The packaged sources are the library's half; the two optional
// files in this repo are the device's own half.
const { sources } = require("@m4l-jweb/wrapper/sources");
const deviceWrapper = path.join(root, "wrapper/device.ts");
const wrapper = [...sources, ...(existsSync(deviceWrapper) ? [deviceWrapper] : [])].map((f) => readFileSync(f, "utf8")).join("\n");

const deviceChains = path.join(root, "patcher/chains.mjs");
const chains = [require.resolve("@m4l-jweb/build/chains"), ...(existsSync(deviceChains) ? [deviceChains] : [])]
  .map((f) => readFileSync(f, "utf8"))
  .join("\n");

const base = readFileSync(path.join(path.dirname(require.resolve("@m4l-jweb/build")), "..", "templates", "base.json"), "utf8");

const devices = (await import(pathToFileURL(path.join(root, "patcher/devices.mjs")).href)).default;

/**
 * The GENERATED patchers - the text of every box in the device the build emitted.
 *
 * Reading the chain SOURCE is a proxy, and a leaky one: a chain that builds its
 * route dynamically (`route ${ids.map(...)}`) contains no literal `route
 * set_cutoff` anywhere, so a source grep calls the selector unrouted while the
 * shipped patcher routes it perfectly. The artifact is the truth. Fall back to
 * the source only when nobody has built yet.
 */
function patcherText(deviceName) {
  const p = path.join(root, "dist", "patchers", `${deviceName}.json`);
  if (!existsSync(p)) return "";
  return JSON.parse(readFileSync(p, "utf8"))
    .patcher.boxes.map((b) => b.box.text ?? "")
    .join("\n");
}

/**
 * Pull the selector literals out of a protocol.ts's IN/OUT blocks.
 *
 * The blocks SPREAD the library's contracts (`...DEVICE_IN`, `...CHAIN_OUT`)
 * rather than retyping the names, so resolve those spreads against
 * @m4l-jweb/bridge. The whole point of the spread is that a name exists in one
 * place; a lint that could not follow the indirection would quietly stop
 * checking the very selectors it moved there.
 */
function selectors(src, block, where) {
  const body = new RegExp(`export const ${block} = \\{([\\s\\S]*?)\\} as const;`).exec(src);
  expect(body, `${where} must export a ${block} block`).not.toBeNull();

  const own = [...body[1].matchAll(/^\s*(\w+):\s*"([^"]+)"/gm)].map((m) => m[2]);

  const spread = [...body[1].matchAll(/\.\.\.(\w+)/g)].flatMap(([, name]) => {
    const from = new RegExp(`export const ${name} = \\{([\\s\\S]*?)\\} as const;`).exec(bridge);
    expect(from, `${where} spreads ${name}, which @m4l-jweb/bridge does not export`).not.toBeNull();
    return [...from[1].matchAll(/^\s*(\w+):\s*"([^"]+)"/gm)].map((m) => m[2]);
  });

  return [...own, ...spread];
}

test("the library's chain contract is what the packaged chains actually route", () => {
  // CHAIN_IN/CHAIN_OUT are a promise the library makes about the chains it ships.
  // Rename a chain's selector without updating the constant and every device that
  // spread it starts sending into the void, with no error anywhere.
  expect(chains).toContain("prepend notein");
  expect(chains).toMatch(/route [^"']*\bmidinote\b/);
  expect(chains).toMatch(/route [^"']*\bflush\b/);
});

test("every device in the manifest has a UI", () => {
  for (const d of devices) {
    const dir = path.join(root, "src/app", d.ui ?? d.name);
    expect(existsSync(dir), `device "${d.name}" has no UI at src/app/${d.ui ?? d.name}/`).toBe(true);
    expect(existsSync(path.join(dir, "protocol.ts")), `${dir} has no protocol.ts`).toBe(true);
  }
});

// Every device is linted on its OWN protocol - a selector that hello-midi routes
// says nothing about whether hello-audio does.
describe.each(devices.map((d) => [d.name, d]))("%s", (name, d) => {
  const dir = d.ui ?? d.name;
  const src = readFileSync(path.join(root, "src/app", dir, "protocol.ts"), "utf8");
  const where = `src/app/${dir}/protocol.ts`;

  const IN = selectors(src, "IN", where);
  const OUT = selectors(src, "OUT", where);
  const paramIds = new Set((d.parameters ?? []).map((p) => p.id));
  const maxSide = `${chains}\n${patcherText(name)}`;

  test("declares selectors in both directions", () => {
    expect(IN.length).toBeGreaterThan(0);
    expect(OUT.length).toBeGreaterThan(0);
  });

  test("every IN selector is actually sent by the wrapper or a chain", () => {
    for (const sel of IN) {
      const sent = wrapper.includes(`"${sel}"`) || maxSide.includes(`prepend ${sel}`) || maxSide.includes(`"${sel}"`) || paramIds.has(sel);
      expect(sent, `IN selector "${sel}" is never sent from ${name}'s Max side`).toBe(true);
    }
  });

  test("every OUT selector is handled by the wrapper or routed by a chain", () => {
    for (const sel of OUT) {
      const handled = new RegExp(`function ${sel}\\s*\\(`).test(wrapper) || new RegExp(`route [^"']*\\b${sel}\\b`).test(maxSide);
      expect(handled, `OUT selector "${sel}" is never handled or routed on ${name}'s Max side`).toBe(true);
    }
  });
});

test("no [node.script] in the default template", () => {
  // It adds a process manager and a boot handshake, and its failure modes in Live
  // range from silently ignoring `script start` to crashing the host. A Web Worker
  // inside jweb covers pure computation with none of that.
  expect(base).not.toContain("node.script");
  expect(chains).not.toContain("node.script");
  expect(wrapper).not.toContain("node.script");
});

test("no device ships a UI that is not its own", () => {
  // Every device extracts its payload into the SAME folder (next to the .amxd), so
  // a shared payload name would mean two devices overwriting each other's UI on
  // every load - a device showing its sibling's interface. The name is per-device.
  const dist = path.join(root, "dist");
  if (!existsSync(path.join(dist, "ui"))) return; // not built
  const built = readdirSync(path.join(dist, "ui"));
  for (const d of devices) expect(built).toContain(d.ui ?? d.name);
});
