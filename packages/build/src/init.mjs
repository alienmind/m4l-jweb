/**
 * init.mjs - `m4l-jweb init [dir] [--name <name>]`: scaffold a new device repo.
 *
 * The template lives in templates/starter/ and mirrors this repo's own layout:
 * the same scripts/, vite.config.ts, tsconfig and src/app/shared/, with one
 * device instead of three.
 *
 * Those shared files are checked for drift by tests/starter.test.mjs, which
 * compares them byte-for-byte against the root repo's. The template used to be
 * kept in sync by hand and by good intentions, and it fell behind.
 *
 * `{{name}}` is substituted in file CONTENTS and in PATHS - the device's app
 * lives at src/app/{{name}}/, so the folder is named after the device too.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const starter = path.join(pkgDir, "templates", "starter");

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

export async function initProject(cwd, args = []) {
  const positional = args.filter((a) => !a.startsWith("--"));
  const nameFlagIndex = args.indexOf("--name");
  const target = positional[0] ? path.resolve(cwd, positional[0]) : cwd;
  const name = nameFlagIndex >= 0 ? args[nameFlagIndex + 1] : path.basename(target);

  if (existsSync(target) && readdirSync(target).length > 0) {
    throw new Error(`${target} is not empty - init needs an empty (or new) directory`);
  }
  mkdirSync(target, { recursive: true });

  const files = walk(starter);
  for (const src of files) {
    // The device's app folder is named after the device, so {{name}} has to be
    // substituted in the PATH as well as in the contents.
    const rel = path.relative(starter, src).replaceAll("{{name}}", name);
    const dest = path.join(target, rel);
    mkdirSync(path.dirname(dest), { recursive: true });
    const contents = readFileSync(src, "utf8").replaceAll("{{name}}", name);
    writeFileSync(dest, contents);
  }

  console.log(`m4l-jweb: scaffolded "${name}" at ${target} (${files.length} files)`);
  console.log(`m4l-jweb: next steps:\n  cd ${path.relative(cwd, target) || "."}\n  pnpm install\n  pnpm dev`);
  return target;
}
