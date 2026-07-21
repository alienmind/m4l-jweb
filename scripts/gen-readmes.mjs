/**
 * gen-readmes.mjs - write a README.md into every publishable package.
 *
 * WHY THIS EXISTS: npmjs.org renders a package's README on its page, and a package
 * without one shows an empty shell - no idea what it is, what it needs, or how it
 * relates to the other three. All four of ours shipped that way through 0.9.9.
 *
 * WHY GENERATED rather than four hand-written files: three of the fields (name,
 * version, description) already live in each package.json, and the install/links/
 * license half is identical everywhere. Hand-maintained copies drift - one package
 * gets updated and the other three quietly rot. Here the per-package prose is the
 * only thing written by hand (BODIES below), and everything else is derived.
 *
 * npm ALWAYS publishes a README.md next to package.json, whatever the `files` field
 * says (package.json, README and LICENSE are special-cased), so nothing needs adding
 * to `files` for these to reach the registry.
 *
 *   node scripts/gen-readmes.mjs           write them
 *   node scripts/gen-readmes.mjs --check   verify they match, exit 1 if not (CI/test)
 *
 * The generated files ARE committed: they show up in the package folder on GitHub, and
 * a diff is how a reviewer sees the registry page change. tests/package-readmes.test.mjs
 * runs --check, so a body edited here without regenerating fails the suite.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = "https://github.com/alienmind/m4l-jweb";

/**
 * The hand-written half: what each package IS, and the smallest honest example of
 * using it. Keyed by directory under packages/.
 */
const BODIES = {
  bridge: {
    blurb:
      "The browser half of a device. Your React UI runs inside `[jweb~]`, Max's embedded Chromium; this is how it talks to the Max patcher around it - messages out, messages in, MIDI, clip I/O, and files.",
    usage: `import { bindInlet, outlet, onNote, onNoteOff, sendNote, uiReady } from "@m4l-jweb/bridge";

// Tell the wrapper the page is up, and ask for current state.
uiReady();

// Incoming MIDI (needs the \`midiin\` chain). Both binders share one subscription.
onNote((pitch, velocity) => voiceOn(pitch, velocity));
onNoteOff((pitch) => voiceOff(pitch));

// Outgoing MIDI (needs the \`midiout\` chain). Max applies the delay, not the browser,
// so note timing does not depend on a Chromium timer.
sendNote({ pitch: 60, velocity: 100, durationMs: 250, delayMs: 80 });

// Anything else you route yourself.
bindInlet("tick", (playing, beats) => setTransport(Boolean(playing), Number(beats)));
outlet("my_selector", 1, "two");`,
    notes: [
      "**Audio does not go through here.** Under `[jweb~]` the page's Web Audio output is carried on the object's signal outlets, straight into the track. The bridge is a control plane; sound never crosses it as messages.",
      "`fetchToFile()` and `saveToFile()` move bytes between the page and disk via Max's `[maxurl]`, so large files never travel through the message bridge either.",
      "`tapMessages()` observes every message in both directions - the whole contract of a device, live.",
    ],
  },

  build: {
    blurb:
      "The CLI. It reads a device manifest and writes finished, installable `.amxd` files - generating the Max patcher, compiling the `[js]` wrapper, and freezing your UI bundle inside the device. No Max editor is opened at any point.",
    usage: `# in a device repo
pnpm m4l-jweb build       # patchers + wrapper + .amxd, end to end
pnpm m4l-jweb patchers    # just regenerate the patcher JSON
pnpm m4l-jweb wrapper     # just recompile the [js] wrapper
pnpm m4l-jweb install     # copy the built devices into your User Library
pnpm m4l-jweb init        # scaffold a new device repo`,
    notes: [
      "Devices are declared as data in `patcher/devices.mjs` - a name, a `type` (`midi` / `audio` / `instrument`), and a list of **chains**. Patch cords become code review.",
      "Chains are small functions that each claim a stage of the signal or message path: `webaudio` (the page's own audio, via `[jweb~]`), `midiin`, `midiout`, `lowpass`, `gain`, `download`, `remote`, and your own in `patcher/chains.mjs`.",
      "The generated patcher is checked before it is written - duplicate box ids and unrouted selectors fail the build rather than producing a device that loads and silently does nothing.",
    ],
  },

  surface: {
    blurb:
      "Declare a device's Live parameters once, as code, and get the real thing: native `live.dial` / `live.text` objects in the patcher, automatable lanes, MIDI mapping, and Push. Plus React hooks to read and write them, and a mocked-Live harness so the UI runs in an ordinary browser.",
    usage: `// surface.ts - the declaration
import { defineSurface } from "@m4l-jweb/surface";

export default defineSurface({
  params: {
    cutoff: { type: "float", min: 20, max: 18000, unit: "Hz", default: 18000, exponent: 3 },
    play:   { type: "bool", default: 0 },
  },
});

// App.tsx - the same parameter, from React
import { useParam, useStateSync } from "@m4l-jweb/surface/react";

const [cutoff, setCutoff] = useParam(surface, "cutoff");   // a real Live parameter
const [notes, setNotes]   = useStateSync(surface, "notes"); // arbitrary JSON, saved in the Set`,
    notes: [
      "A parameter declared here is generated into the patcher AND into the wrapper - one declaration, both sides, so they cannot disagree.",
      "`useStateSync()` persists arbitrary JSON into the Ableton Live Set itself, per device instance, restored on load.",
      "`@m4l-jweb/surface/dev` renders the device against a mocked Live, so the UI is developed with hot reload in a browser rather than by reopening Live.",
    ],
  },

  wrapper: {
    blurb:
      "The Max-side glue: the ES5 `[js]` script that owns a device's lifecycle, its LiveAPI work, transport polling, clip I/O and file writes. You do not usually import this - `@m4l-jweb/build` compiles it into every device it produces.",
    usage: `// Only a device repo extending the wrapper needs this: wrapper/device.ts is
// compiled together with the packaged sources into one ES5 script.
//
// Everything here must be ES5 - Max's [js] is not a modern JavaScript engine, and the
// build proves it with acorn before packaging.`,
    notes: [
      "`[js]` runs even inside a frozen device, and it is the only place LiveAPI exists - which is why the lifecycle lives here rather than in the browser.",
      "This package exists mainly so the build can find the wrapper sources (`@m4l-jweb/wrapper/sources`). It has no browser-facing API of its own.",
      "**`[node.script]` is never used.** It proved unstable in the field - silent non-start, then a full Live crash.",
    ],
  },
};

function render(dir, pkg) {
  const body = BODIES[dir];
  if (!body) throw new Error(`gen-readmes: no body written for packages/${dir}`);

  const lines = [];
  lines.push(`# ${pkg.name}`);
  lines.push("");
  lines.push(body.blurb);
  lines.push("");
  lines.push(
    `Part of **[m4l-jweb](${REPO})** - build Ableton Live devices (\`.amxd\`) from a TypeScript repo: React UI, LiveAPI glue, CI builds, no Max editor.`,
  );
  lines.push("");
  lines.push("## Install");
  lines.push("");
  lines.push("```bash");
  lines.push(`pnpm add ${pkg.name}`);
  lines.push("```");
  lines.push("");
  lines.push("## Usage");
  lines.push("");
  const fence = dir === "build" ? "bash" : "ts";
  lines.push("```" + fence);
  lines.push(body.usage);
  lines.push("```");
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  for (const n of body.notes) lines.push(`- ${n}`);
  lines.push("");
  lines.push("## Requirements");
  lines.push("");
  lines.push(
    "Ableton Live 12 with Max 9. Devices are built on `[jweb~]`, the browser view with signal outlets; older hosts are unverified.",
  );
  lines.push("");
  lines.push("## Links");
  lines.push("");
  lines.push(`- [Repository and full README](${REPO})`);
  lines.push(`- [Architecture](${REPO}/blob/main/doc/ARCHITECTURE.md)`);
  lines.push(`- [What Max actually does: the measured facts](${REPO}/blob/main/doc/MAX-FACTS.md)`);
  lines.push("");
  lines.push(`## License`);
  lines.push("");
  lines.push(`${pkg.license || "MIT"}`);
  lines.push("");
  return lines.join("\n");
}

const check = process.argv.includes("--check");
const dirs = Object.keys(BODIES);
const drifted = [];

for (const dir of dirs) {
  const pkgPath = path.join(root, "packages", dir, "package.json");
  if (!existsSync(pkgPath)) throw new Error(`gen-readmes: no package at packages/${dir}`);
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const wanted = render(dir, pkg);
  const readmePath = path.join(root, "packages", dir, "README.md");
  const current = existsSync(readmePath) ? readFileSync(readmePath, "utf8") : null;

  if (current === wanted) continue;
  if (check) {
    drifted.push(dir);
    continue;
  }
  writeFileSync(readmePath, wanted, "utf8");
  console.log(`m4l-jweb: wrote packages/${dir}/README.md (${pkg.name})`);
}

if (check && drifted.length) {
  console.error(
    `m4l-jweb: README.md out of date for: ${drifted.join(", ")}\n` +
      `Run \`node scripts/gen-readmes.mjs\` and commit the result.`,
  );
  process.exit(1);
}
if (check) console.log(`m4l-jweb: ${dirs.length} package READMEs up to date`);
