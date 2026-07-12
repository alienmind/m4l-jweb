/**
 * starter.test.mjs - the `m4l-jweb init` template must not drift.
 *
 * The template is a device repo, and most of it is the SAME infrastructure this
 * repo runs on: the same scripts/, vite.config.ts, tsconfig, src/main.tsx and
 * src/app/shared/. Only the manifest and the device's own app differ.
 *
 * It used to be kept in sync by hand, and it fell behind - `init` was scaffolding
 * devices against a protocol and a layout that no longer existed, and nothing
 * failed. So the shared files are compared byte-for-byte here, and the scaffold
 * is generated into a temp dir and checked for the shape the tutorial promises.
 *
 * If this test fails after you changed a root file: copy it into the template.
 * That is the intended fix, not an edit to the assertion.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, expect, test } from "vitest";

import { initProject } from "@m4l-jweb/build/init";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const starter = path.join(root, "packages/build/templates/starter");

/**
 * Files the template copies from this repo verbatim. They are infrastructure: a
 * device author does not edit them, so there is no reason for two versions to
 * exist.
 */
const SHARED = [
  "scripts/devices.mjs",
  "scripts/devices.d.mts",
  "scripts/dev.mjs",
  "scripts/build-ui.mjs",
  "vite.config.ts",
  "vitest.config.ts",
  "tsconfig.json",
  "tsconfig.node.json",
  ".prettierrc",
  "index.html",
  "src/main.tsx",
  "src/index.css",
  "src/vite-env.d.ts",
  "src/app/shared/device.ts",
  "src/app/shared/Frame.tsx",
  "src/app/shared/worker.ts",
];

test.each(SHARED)("template's %s is identical to this repo's", (rel) => {
  const mine = readFileSync(path.join(root, rel), "utf8");
  const theirs = readFileSync(path.join(starter, rel), "utf8");
  expect(theirs, `packages/build/templates/starter/${rel} has drifted - copy ${rel} over it`).toBe(mine);
});

test("no shared file hard-codes one of this repo's device names", () => {
  // The template inherits these files, so a device name baked into one would
  // scaffold a repo that points at an app folder it does not have.
  for (const rel of SHARED) {
    const src = readFileSync(path.join(starter, rel), "utf8");
    expect(src, `${rel} names a device from this repo`).not.toMatch(/hello-midi|hello-audio/);
  }
});

/* ------------------------------------------------------------------ *
 * The scaffold itself
 * ------------------------------------------------------------------ */

const tmp = mkdtempSync(path.join(tmpdir(), "m4l-init-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const NAME = "my-device";
const target = await initProject(tmp, [NAME]);

test("init names the app folder after the device", () => {
  // {{name}} is substituted in PATHS, not only in file contents: the manifest
  // says `name: "my-device"`, and the build looks for src/app/my-device/.
  expect(existsSync(path.join(target, "src/app", NAME, "App.tsx"))).toBe(true);
  expect(existsSync(path.join(target, "src/app", NAME, "protocol.ts"))).toBe(true);
  expect(existsSync(path.join(target, "src/app", NAME, "surface.ts"))).toBe(true);
});

test("no {{name}} placeholder survives the scaffold", () => {
  for (const rel of ["package.json", "patcher/devices.mjs", "tsconfig.app.json", "README.md", `src/app/${NAME}/App.tsx`]) {
    expect(readFileSync(path.join(target, rel), "utf8"), `${rel} still has a placeholder`).not.toContain("{{name}}");
  }
});

test("the scaffolded manifest and the app agree on the device name", () => {
  const manifest = readFileSync(path.join(target, "patcher/devices.mjs"), "utf8");
  expect(manifest).toContain(`name: "${NAME}"`);

  // scripts/devices.mjs maps a device to src/app/<ui ?? name>/ - if these two
  // disagree, `pnpm dev` fails with "device has no UI at ...".
  const tsconfig = readFileSync(path.join(target, "tsconfig.app.json"), "utf8");
  expect(tsconfig).toContain(`./src/app/${NAME}/*`);

  const pkg = JSON.parse(readFileSync(path.join(target, "package.json"), "utf8"));
  expect(pkg.name).toBe(NAME);
  expect(pkg.scripts.dev).toBe(`node scripts/dev.mjs ${NAME}`);
});

test("the scaffolded device uses the library's selector contracts", () => {
  // The whole point of DEVICE_IN/CHAIN_IN/CHAIN_OUT is that a device does not
  // retype them. A template that did would teach the opposite of the docs.
  const protocol = readFileSync(path.join(target, `src/app/${NAME}/protocol.ts`), "utf8");
  expect(protocol).toContain("@m4l-jweb/bridge");
  expect(protocol).toMatch(/\.\.\.DEVICE_IN/);
  expect(protocol).toMatch(/\.\.\.CHAIN_OUT/);
});

test("the scaffolded package.json depends on the published packages, not workspace links", () => {
  const pkg = JSON.parse(readFileSync(path.join(target, "package.json"), "utf8"));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  for (const p of ["@m4l-jweb/bridge", "@m4l-jweb/surface", "@m4l-jweb/build"]) {
    expect(deps[p], `${p} missing from the scaffold`).toBeTruthy();
    expect(deps[p], `${p} must not be a workspace link in a scaffolded repo`).not.toContain("workspace:");
  }
});

test("the scaffold asks for the version of the packages this repo actually builds", () => {
  // A scaffolded repo installs the m4l-jweb packages from npm. If the template's
  // range does not cover what this repo now is, `init` produces a device wired
  // against a library that no longer matches - which is exactly how the template
  // fell behind before, silently.
  const pkg = JSON.parse(readFileSync(path.join(target, "package.json"), "utf8"));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };

  for (const p of ["bridge", "surface", "build"]) {
    const version = JSON.parse(readFileSync(path.join(root, "packages", p, "package.json"), "utf8")).version;
    const minor = version.split(".").slice(0, 2).join(".");
    expect(deps[`@m4l-jweb/${p}`], `@m4l-jweb/${p} is at ${version}; the template asks for ${deps[`@m4l-jweb/${p}`]}`).toContain(minor);
  }
});
