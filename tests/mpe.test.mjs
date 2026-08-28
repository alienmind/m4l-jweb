/**
 * mpe.test.mjs - `mpe: true` in the manifest sets the patcher's `is_mpe`.
 *
 * `is_mpe` is a PATCHER attribute, not a box one, so nothing else in this suite
 * would see it: the chain tests read boxes and the protocol lint reads box text. A
 * device that quietly stopped declaring MPE would keep building, keep passing, and
 * simply never be sent per-note expression again - with the badge gone from the
 * title bar as the only symptom, in Live, on someone else's machine.
 *
 * The name is Max's, read off `refpages/max-ref/patcher.maxref.xml` ("Patch supports
 * MPE (Max for Live). If enabled, a Max for Live device will receive MPE data from
 * Live") and confirmed set to 1 in a shipping device that carries the badge. It is
 * exactly the kind of name CLAUDE.md's first hard rule is about: spell it wrong and
 * Max ignores it, forever, without a word.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

import { composePatcher } from "@m4l-jweb/build";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const templates = path.join(path.dirname(require.resolve("@m4l-jweb/build")), "..", "templates");
const base = () => JSON.parse(readFileSync(path.join(templates, "base.json"), "utf8"));

const midi = { name: "t", type: "midi", chains: [], unmatchedTo: "js" };

test("the template declares MPE OFF, explicitly", () => {
  // Not absent - present and 0. An attribute Max does not find falls back to its own
  // default, and this one is not ours to leave to chance.
  expect(base().patcher.is_mpe).toBe(0);
});

test("a device without `mpe` stays off", () => {
  const p = composePatcher(base(), midi, null);
  expect(p.patcher.is_mpe).toBe(0);
});

test("`mpe: true` sets is_mpe on the PATCHER, not on a box", () => {
  const p = composePatcher(base(), { ...midi, mpe: true }, null);
  expect(p.patcher.is_mpe).toBe(1);
  for (const { box: b } of p.patcher.boxes) expect(b.is_mpe).toBeUndefined();
});

test("push-probe declares MPE and something reads it", async () => {
  // The two halves have to travel together: the flag asks Live to SEND per-note
  // expression, and it arrives as ordinary MIDI that some object still has to parse.
  // A device with the flag and no reader is a device Live feeds for no reason.
  const devices = (await import(path.join(root, "patcher/devices.mjs"))).default;
  const probe = devices.find((d) => d.name === "push-probe");
  expect(probe, "push-probe is not in the manifest").toBeDefined();
  expect(probe.mpe).toBe(true);
  expect(probe.chains).toContain("mpein");
});
