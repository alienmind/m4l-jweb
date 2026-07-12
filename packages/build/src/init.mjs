/**
 * init.mjs - `m4l-jweb init [dir] [--name <name>]`: scaffold a new device repo.
 *
 * The template lives in templates/starter/ and is not a hand-maintained copy:
 * it mirrors this repo's own root app (src/app/, patcher/devices.mjs, the
 * config files), which is itself a working hello-world device built on
 * @m4l-jweb/bridge and @m4l-jweb/build. Keeping the template that close to a
 * real, CI-built app is what keeps it from drifting out of sync with the
 * library - change the shape of a real device, then port the same change
 * into templates/starter/ in the same commit.
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
    const rel = path.relative(starter, src);
    const dest = path.join(target, rel);
    mkdirSync(path.dirname(dest), { recursive: true });
    const contents = readFileSync(src, "utf8").replaceAll("{{name}}", name);
    writeFileSync(dest, contents);
  }

  console.log(`m4l-jweb: scaffolded "${name}" at ${target} (${files.length} files)`);
  console.log(`m4l-jweb: next steps:\n  cd ${path.relative(cwd, target) || "."}\n  pnpm install\n  pnpm dev`);
  return target;
}
