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
 * patcher/chains.mjs and wrapper/device.ts, the device's SURFACE (a live.dial
 * reaches the UI as `<id> <value>` and takes `set_<id>` back, so a parameter id
 * IS a selector, in both directions), and - above all - the GENERATED patchers,
 * which are what actually ships.
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
 * A device's parameters, from its own surface.ts - the one declaration the Max
 * objects are generated from. Vitest transforms the TypeScript, so this is the
 * SAME module the build compiles, not a copy of it: a parameter renamed there is
 * renamed here, and the lint below moves with it.
 */
const surfaces = Object.fromEntries(
  await Promise.all(
    devices.map(async (d) => {
      const src = path.join(root, "src/app", d.ui ?? d.name, "surface.ts");
      if (!existsSync(src)) return [d.name, null];
      return [d.name, (await import(pathToFileURL(src).href)).default];
    }),
  ),
);

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
  // SUBPATCHERS COUNT. A floating window's [jweb] and the [r window-read-<id>]
  // feeding it live inside a [p <title>], and a lint that read only the top level
  // would call a perfectly wired window unrouted - or, worse, call an unwired one
  // fine, because it could not see the box that was missing.
  const texts = (boxes) => boxes.flatMap(({ box: b }) => [b.text ?? "", ...(b.patcher?.boxes ? texts(b.patcher.boxes) : [])]);
  return texts(JSON.parse(readFileSync(p, "utf8")).patcher.boxes).join("\n");
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
function bridgeBlock(name, where) {
  const from = new RegExp(`export const ${name} = \\{([\\s\\S]*?)\\} as const;`).exec(bridge);
  expect(from, `${where} refers to ${name}, which @m4l-jweb/bridge does not export`).not.toBeNull();
  return Object.fromEntries([...from[1].matchAll(/^\s*(\w+):\s*"([^"]+)"/gm)].map((m) => [m[1], m[2]]));
}

function selectors(src, block, where) {
  const body = new RegExp(`export const ${block} = \\{([\\s\\S]*?)\\} as const;`).exec(src);
  expect(body, `${where} must export a ${block} block`).not.toBeNull();

  const own = [...body[1].matchAll(/^\s*(\w+):\s*"([^"]+)"/gm)].map((m) => m[2]);

  const spread = [...body[1].matchAll(/\.\.\.(\w+)/g)].flatMap(([, name]) => Object.values(bridgeBlock(name, where)));

  // `fetch_done: CHAIN_IN.fetch_done` - taking ONE name from a library contract
  // rather than the whole block. An audio effect wants the download selectors and
  // not `midinote`, and spreading CHAIN_OUT to get one of them declares two
  // selectors the device has no ports for. Resolve the reference like a spread: a
  // name the lint cannot follow is a name it silently stops checking.
  const picked = [...body[1].matchAll(/^\s*\w+:\s*(\w+)\.(\w+)/gm)].map(([, name, key]) => {
    const value = bridgeBlock(name, where)[key];
    expect(value, `${where} refers to ${name}.${key}, which @m4l-jweb/bridge's ${name} does not have`).toBeDefined();
    return value;
  });

  return [...own, ...spread, ...picked];
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
  const surface = surfaces[name];
  const maxSide = `${chains}\n${patcherText(name)}`;

  test("declares selectors in both directions", () => {
    expect(IN.length).toBeGreaterThan(0);
    expect(OUT.length).toBeGreaterThan(0);
  });

  test("every IN selector is actually sent by the wrapper or a chain", () => {
    for (const sel of IN) {
      const sent = wrapper.includes(`"${sel}"`) || maxSide.includes(`prepend ${sel}`) || maxSide.includes(`"${sel}"`);
      expect(sent, `IN selector "${sel}" is never sent from ${name}'s Max side`).toBe(true);
    }
  });

  test("every OUT selector is handled by the wrapper or routed by a chain", () => {
    for (const sel of OUT) {
      const handled = new RegExp(`function ${sel}\\s*\\(`).test(wrapper) || new RegExp(`route [^"']*\\b${sel}\\b`).test(maxSide);
      expect(handled, `OUT selector "${sel}" is never handled or routed on ${name}'s Max side`).toBe(true);
    }
  });

  /**
   * The PARAMETERS get the same lint, from the declaration rather than from
   * protocol.ts - which is the whole point of generating them. A parameter is two
   * selectors, and the patcher must carry BOTH: `<id>` out of the live.* object,
   * `set_<id>` back into it. One without the other is a control that reads but
   * cannot be moved, or moves but never reports - and neither raises an error.
   *
   * Note this reads the GENERATED patcher, not the chain source: the Surface's
   * route is built from the declaration (`route set_a set_b`), so there is no
   * literal to grep for anywhere in the source.
   */
  test.skipIf(!surface?.ids.length || !patcherText(name))("every declared parameter is wired in both directions", () => {
    const patcher = patcherText(name);
    for (const id of surface.ids) {
      expect(patcher, `parameter "${id}" never reaches ${name}'s UI - no [prepend ${id}]`).toContain(`prepend ${id}`);
      expect(patcher, `parameter "${id}" cannot be written by ${name}'s UI - no [route ... set_${id}]`).toMatch(
        new RegExp(`route [^"']*\\bset_${id}\\b`),
      );
    }
  });

  /**
   * ...and a parameter must NOT also be hand-declared in protocol.ts. Two sources
   * of truth for one selector is exactly the drift the Surface deletes: rename it
   * in surface.ts and the stale copy here keeps type-checking, keeps passing the
   * lint above, and silently binds a message nothing sends any more.
   */
  test.skipIf(!surface?.ids.length)("a declared parameter is not re-declared by hand", () => {
    for (const id of surface.ids) {
      expect(IN, `"${id}" is generated from surface.ts - remove it from ${where}`).not.toContain(id);
      expect(OUT, `"set_${id}" is generated from surface.ts - remove it from ${where}`).not.toContain(`set_${id}`);
    }
  });

  /**
   * A declared WINDOW is two more generated selectors, and it got no lint at all -
   * so when the codegen emitted a [route] that matched them into boxes that had
   * failed to instantiate, nothing here noticed. This checks the shipped patcher.
   */
  const windowIds = Object.keys(surface?.windows ?? {});
  test.skipIf(!windowIds.length || !patcherText(name))("every declared window is routed in the patcher", () => {
    const patcher = patcherText(name);
    for (const id of windowIds) {
      for (const sel of [`window_${id}_open`, `window_${id}_close`]) {
        expect(patcher, `window "${id}" cannot be opened by ${name}'s UI - no [route ... ${sel}]`).toMatch(new RegExp(`route [^"']*\\b${sel}\\b`));
      }
      // The page reaches the window's [jweb] by NAME, not by a cord - there is no
      // cord into a subpatcher. If the receive is missing, the window opens EMPTY.
      expect(patcher, `window "${id}" has no [r window-read-${id}] for the wrapper to send its URL to`).toContain(`r window-read-${id}`);
    }
  });

  /**
   * ...and a declared STATE slot is a [dict] the wrapper addresses BY NAME
   * (`new Dict("obj-state-<id>")`), so the name in the patcher and the name in the
   * wrapper are one string in two languages. Nothing but this checks that they
   * still agree.
   */
  const stateIds = Object.keys(surface?.state ?? {});
  test.skipIf(!stateIds.length || !patcherText(name))("every declared state slot has a [dict] and a [pattr] that saves it", () => {
    const patcher = patcherText(name);
    for (const id of stateIds) {
      expect(patcher, `state "${id}" has no [dict obj-state-${id}] - the wrapper's Dict("obj-state-${id}") binds to nothing`).toContain(
        `dict obj-state-${id}`,
      );
      expect(patcher, `state "${id}" has no [pattr] bound to it, so Live never saves it`).toMatch(
        new RegExp(`pattr [^"']*@bindto obj-state-${id}\\b`),
      );
    }
    // The wrapper's half of the contract: the id is an ARGUMENT of a fixed
    // selector. `sync_state_<id>` would dispatch to nothing at all.
    expect(wrapper).toMatch(/function sync_state\s*\(/);
    expect(wrapper).toMatch(/function get_state\s*\(/);
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
