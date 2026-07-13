/**
 * bundle.test.mjs - what each device's bundle must and must not contain.
 *
 * Two invariants, both of which fail SILENTLY in Live if they break:
 *
 * 1. The dev harness (@m4l-jweb/surface/dev) renders a mocked Live beside the
 *    app. Wonderful in dev; an embarrassment inside someone's .amxd, and a quiet
 *    one - a shipped harness throws no error, it just sits there in the device.
 *    src/main.tsx imports it behind `import.meta.env.DEV`, which a production
 *    build replaces with `false`, so rollup drops the branch and the module with
 *    it. This asserts the drop actually happened rather than trusting that it did.
 *
 * 2. Each device ships ITS OWN app. The whole point of one bundle per device is
 *    that hello-midi carries no filter code and hello-audio carries no sequencer.
 *    If the vite config ever stops rebinding `@device` per build, every device
 *    would get the first one's UI - and it would still build, install and load.
 *
 * Reads the built bundles, so it only runs after `pnpm build`.
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { name: pkgName } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));

const devices = (await import(pathToFileURL(path.join(root, "patcher/devices.mjs")).href)).default;

// The marker the harness stamps on itself, read from the source rather than
// retyped - so renaming it cannot quietly disarm this test.
const harnessSrc = readFileSync(require.resolve("@m4l-jweb/surface/dev"), "utf8");
const MARKER = /HARNESS_MARKER = "([^"]+)"/.exec(harnessSrc)?.[1];

/** The UI each device actually ships, as installed next to the .amxd. */
const shipped = (d) => path.join(root, "dist", pkgName, `${d.name}.html`);
const built = devices.every((d) => existsSync(shipped(d)));

test("the harness stamps itself with a marker this test can look for", () => {
  expect(MARKER, "@m4l-jweb/surface/dev must export HARNESS_MARKER").toBeTruthy();
});

describe.skipIf(!built)("each device's shipped UI", () => {
  test.each(devices.map((d) => [d.name, d]))("%s does not contain the dev harness", (_name, d) => {
    const html = readFileSync(shipped(d), "utf8");
    expect(html).not.toContain(MARKER);
    // The mocked transport is the harness's most recognisable payload. If the
    // marker were ever stripped by a minifier but the code survived, this catches it.
    expect(html).not.toContain("LIVE (mocked)");
  });

  test("hello-midi ships the sequencer and NOT the filter", () => {
    const html = readFileSync(shipped(devices.find((d) => d.name === "hello-midi")), "utf8");
    expect(html).toContain("HELLO MIDI");
    expect(html).not.toContain("HELLO AUDIO");
  });

  test("hello-audio ships the filter and NOT the sequencer", () => {
    const html = readFileSync(shipped(devices.find((d) => d.name === "hello-audio")), "utf8");
    expect(html).toContain("HELLO AUDIO");
    expect(html).not.toContain("HELLO MIDI");
  });

  test("no device ships another device's PARAMETERS", () => {
    // src/main.tsx reaches each device's surface.ts through import.meta.glob, so
    // the harness can render the parameter panel. The glob must stay LAZY: an
    // eager one resolves every match at build time and inlines all of them into
    // every bundle, so hello-midi would carry hello-audio's cutoff declaration.
    // It would still build, install and run - it would just quietly stop being one
    // device per bundle.
    const midi = readFileSync(shipped(devices.find((d) => d.name === "hello-midi")), "utf8");
    const audio = readFileSync(shipped(devices.find((d) => d.name === "hello-audio")), "utf8");
    expect(midi).not.toContain("Cutoff"); // hello-audio's parameter short name
    expect(audio).not.toContain("Dens"); // hello-midi's
  });
});

test.skipIf(built)("SKIPPED: run `pnpm build` first to check the shipped bundles", () => {});
