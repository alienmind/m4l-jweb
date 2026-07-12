# M4L-JWEB

**Build Ableton Live devices like a web developer.**

Max for Live is the most powerful extension point Ableton ever shipped, and the
least approachable one if you come from modern software engineering. M4L-JWEB is
a scaffold and a set of patterns that let you build, test and ship `.amxd`
devices from an ordinary TypeScript repo, with CI and no Max editor in the loop.

Your UI is a React app. Your Live glue is TypeScript. Your patch cords are code
review. `pnpm build` emits installable devices on a machine that has never seen
Max.

---

## Requirements

### To build

Nothing musical at all. This is the point of the project: `pnpm build` emits
installable `.amxd` devices on a bare CI runner.

- **Node.js 20+** and **pnpm 10+**.
- **No Max license, and no Max editor.** The patcher is generated and the
  container is written byte-for-byte in `packages/build/src/amxd.mjs`.
- **No Ableton Live.** You can develop the entire UI in a browser (`pnpm dev`),
  where `window.maxSimulate(selector, ...args)` fakes the Max bridge.

### To actually run the device in Live

Here you need Live, and **not every edition can run Max for Live devices**:

| Edition | Runs this device? |
|---|---|
| **Live Suite** | Yes. Max for Live is included. This is the normal path. |
| **Live Standard** | Only with the paid **Max for Live add-on**. Not included by default. |
| **Live Intro** | No. Max for Live is not available, and there is no add-on path. |
| **Live Lite** (the version bundled with hardware) | No. Same as Intro. |

So: **the basic/entry-level Ableton license cannot run this.** You need Suite, or
Standard plus the Max for Live add-on.

You do **not** need a separate Cycling '74 Max license on top of that - Max for
Live bundles the Max runtime, and this repo never opens the Max editor anyway.

**Versions.** Developed and tested against **Live 12 with Max 9** on Windows.
The `[jweb]` object (the embedded Chromium view the whole UI depends on) was
introduced in **Max 8**, so Live 10 and 11 should work in principle - but that is
reasoning from the docs, not something I have run. Treat anything below Live 12
as unverified.

**Platforms.** Live runs on **macOS and Windows** only. The build itself runs
anywhere Node does, so CI on Linux is fine - you just cannot run the result
there.

---

## Quick start

```bash
git clone https://github.com/alienmind/m4l-jweb my-device
cd my-device && pnpm install

pnpm dev              # browser dev with the Max bridge simulated
pnpm build            # emits dist/m4l-jweb/<device>.amxd + release zip
pnpm test             # container round-trip + ES5 gate + protocol lint
pnpm install:device   # copy the devices into Ableton's User Library
```

Then open Live: **User Library > Max For Live > m4l-jweb**, and drop
`hello-midi` on a MIDI track.

You edit two places:

- **`src/app/`** - the web app: `App.tsx`, an optional `worker.ts`, and
  `protocol.ts`, the typed list of selectors that is the single source of truth
  for both sides of the bridge.
- **`patcher/devices.mjs`** - the manifest: name, type, chains, parameters.

The wrapper, the patcher generator, the container writer and the installers are
infrastructure you should rarely touch.

`examples/transposer/` is the hello world: a one-knob MIDI transposer, about
fifty lines, wired end to end.

The repo doubles as an agent-friendly codebase. Because every artifact is text
and every invariant is enforced by the build (ES5 gate, container round-trip
test, protocol lint), an LLM can implement a device end to end and verify its
own work. `CLAUDE.md` spells out the guardrails.

---

## Installing the devices

After `pnpm build`, the devices are in `dist/<package-name>/`. Getting them into
Live means copying them into the Ableton **User Library**.

```bash
pnpm install:device
```

That picks the right script for your platform, finds your User Library, and
replaces any previous install of this device folder. It prints where it put
things:

```
  installed hello-midi.amxd
  installed hello-audio.amxd
Installed to <User Library>\Max For Live\m4l-jweb
```

Then in Live: **User Library > Max For Live > m4l-jweb**.

### How the User Library is found

It is read from Live's own preferences file (`Library.cfg`, the `ProjectPath`
value), newest Live version first, falling back to Live's default location. No
registry keys and no environment variables are involved - Live keeps all of this
in plain config files, so a custom library location is picked up automatically.

### Running the scripts directly

`pnpm install:device` is a wrapper around the same per-platform scripts the build
copies into `dist/` and into the release zip. You can run them yourself:

```powershell
dist\install-windows.ps1               # Windows
```

```bash
dist/install-mac.sh                    # macOS
```

Both accept an optional device name and source folder
(`install-mac.sh <name> <src-dir>`), which is how the CLI drives them. Someone
who receives only the release zip runs the script sitting next to the device
folder, with no repo and no Node.

There is no Linux installer: Live has no Linux build. The *build* runs anywhere
Node does, so CI on Linux is fine.

> **The one gotcha:** Live embeds a **copy** of a device into the set. Instances
> already sitting on a track will **not** update when you reinstall - delete them
> and re-drag from the browser. The devices show a build stamp so a stale one is
> visible rather than mysterious.

---

## How Max for Live development normally works

Ableton Live has no public plugin SDK for its device area. What it has is
**Max for Live (M4L)**: an embedding of Cycling '74's Max, a visual programming
environment with four decades of history. A device is a Max *patcher* - a graph
of boxes connected by patch cords - wrapped in a binary `.amxd` container and
hosted in Live's device chain.

The canonical workflow looks like this:

1. Open Live, drop a Max device on a track, click its Edit button. The Max
   editor opens.
2. Drag objects onto the canvas: `midiin`, `midiout`, `live.dial`, `[js]`
   scripts, MSP signal objects. Draw cords between them. Position everything by
   pixel.
3. For anything algorithmic, write ES5 JavaScript inside the `[js]` object,
   which also carries **LiveAPI** - the only scriptable access to Live's object
   model (tracks, clips, scenes, transport, scale).
4. Save. "Freeze" the device so its file dependencies travel inside the `.amxd`.
   Distribute that file.

This workflow has real strengths: it is direct, live-editable, and the Max
object library is enormous. Thousands of excellent devices are built this way.
But if your background is software engineering, you will notice what is missing:

- **No components, no CSS, no state management.** The UI toolkit is Max's own,
  positioned visually, styled sparsely.
- **No modern language.** The `[js]` object runs an ES5-era interpreter: no
  modules, no `let`/`const`, no promises, no npm.
- **No build, no diff, no CI.** The patcher is both source and artifact. Version
  control sees JSON blobs full of pixel coordinates. Producing a distributable
  requires a human clicking inside a licensed Max editor.
- **A virtual filesystem quirk.** Frozen dependencies live inside the device
  where only Max-native objects can read them; an embedded browser or external
  process cannot open the files you shipped with your own device.

None of this is a criticism of Max. It was designed for musicians patching live,
and it excels at that. It just means a web developer's entire toolbox sits
unused.

---

## This is exactly what M4L-JWEB brings

Every one of those gaps is a solved problem outside Max, and none of them is
essential to what a device *is*. So M4L-JWEB puts the missing toolbox back:

- **Components, CSS, state management** - the UI is a React app, running in the
  `[jweb]` Chromium view that ships with Max.
- **A modern language** - you write TypeScript, everywhere, including the `[js]`
  glue. The ES5 the interpreter demands is a compiler target, not a way of life.
- **A build, a diff, a CI** - patchers are generated from a manifest, so patch
  cords become code review, and `pnpm build` emits installable `.amxd` files on a
  runner that has never had Max on it.
- **A way past the virtual filesystem** - the UI travels inside the device as a
  payload the wrapper extracts on load, so the browser can read what you shipped.

The result is an Ableton device you build the way you build anything else: edit
text, run tests, push, let CI produce the artifact. No editor in the loop, no
pixel coordinates in your diffs.

Start with the [Quick start](#quick-start) above. When you want to know how any
of it actually works - the message protocol, the generated patchers, the `.amxd`
container, Push support, the roadmap - that is all in
**[doc/ARCHITECTURE.md](doc/ARCHITECTURE.md)**.

---

## License

MIT.
