/**
 * package-readmes.test.mjs - every published package carries a README.
 *
 * npmjs.org renders a package's README on its page. All four of ours shipped through
 * 0.9.9 without one, so the registry showed an empty shell: no idea what the package
 * is, what it needs, or how it relates to the other three.
 *
 * They are GENERATED (scripts/gen-readmes.mjs) and committed. This pins both halves:
 * the files exist, and they still match what the generator would write - so editing a
 * body in the script without regenerating fails here rather than silently publishing a
 * stale page. `--check` is the generator's own dry run; running it in-process would
 * hide an exception, so this shells out and reads the exit code.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGES = ["bridge", "build", "surface", "wrapper"];

describe("published packages carry a README", () => {
  for (const dir of PACKAGES) {
    test(`packages/${dir} has one, and it names the package`, () => {
      const readme = path.join(root, "packages", dir, "README.md");
      expect(existsSync(readme), `packages/${dir}/README.md is missing`).toBe(true);

      const text = readFileSync(readme, "utf8");
      const { name } = JSON.parse(readFileSync(path.join(root, "packages", dir, "package.json"), "utf8"));
      // The heading is what npm shows first; a copy-paste from another package is the
      // failure this catches.
      expect(text.startsWith(`# ${name}\n`), `README does not open with "# ${name}"`).toBe(true);
      expect(text).toContain(`pnpm add ${name}`);
    });
  }

  test("none has drifted from the generator", () => {
    // Throws (non-zero exit) when a README differs from what gen-readmes would write.
    expect(() =>
      execFileSync(process.execPath, ["scripts/gen-readmes.mjs", "--check"], { cwd: root, stdio: "pipe" }),
    ).not.toThrow();
  });
});
