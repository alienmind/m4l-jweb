# M4L-JWEB

**Build Ableton Live devices like a web developer.**

M4L-JWEB lets you author Ableton Live Max for Live devices (`.amxd`) in an
ordinary TypeScript repo, with the tools any developer already expects: a package
manager, a typechecker, unit tests, CI. The device UI is a React app, and it can
be run, simulated and tested **outside Ableton and outside Max** - against a
mocked Live, in a browser.

*(Quick remark: this project is a developer tool, not a DAW replacement.
It doesn't replace Ableton Live or generate audio on its own.
You will still need a licensed copy of Ableton Live (Suite or with Max for Live extras) to
actually load these devices and produce sound!)*

Moreover, because M4L-JWEB is based entirely on declarative code, it not only provides
an improved developer experience, but also natively enables LLM-assisted development of
Max patches and devices—just as an LLM would assist with any other text-based
programming language.

The glue that a device needs is provided rather than rewritten each time: the
message bridge between the browser and Max, the `[js]` script that talks to
Live's object model, the generated patcher, and the binary `.amxd` writer. So
`pnpm build` produces installable devices on a machine that has never had Max on
it, which means CI can ship them.

```bash
pnpm install
pnpm dev:hello-midi   # the device in a browser, with a mocked Live beside it
pnpm build            # .amxd files, no Max installed
pnpm install:device   # into Ableton's User Library
```

The repo builds several example devices out of the box to demonstrate the architecture:

| Device | Type | What it is |
|---|---|---|
| **hello-midi** | MIDI effect | A pulse generator. A Rate slider (off, 1/4, 1/8, 1/16, 1/32) plays C3 on every division, placed on Max's scheduler. |
| **hello-audio** | audio effect | Three effects in series - a lowpass, a soft-clipping drive and a level - each one a *chain* named in the manifest, each with its own Live parameter. |
| **hello-audio-rev** | audio effect | Not an example - a **test case**. The same app, the same parameters, the opposite chain order. You run it with your ears: **[doc/LISTENING.md](doc/LISTENING.md)**. |
| **hello-downloads** | audio effect | Tests the fetch-to-disk capability. It uses a `download` chain to securely bypass `[jweb]`'s lack of disk access via Max's `[maxurl]`. |
| **hello-state** | audio effect | Demonstrates state persistence (`useStateSync`). Proves arbitrary JSON blobs can be saved cleanly into the Ableton Live Set and automatically restored. |
| **hello-window** | MIDI effect | Demonstrates the floating window API (`useWindow`). *Note: Currently PARKED due to Max message routing limits. See `doc/WINDOW.md`.* |

> **Testing the feature examples:** Because `hello-downloads` and `hello-state` are compiled as **audio effects** with a `passthrough` audio chain, they won't swallow or block sound. You can drop them on the Master channel (or any audio track) to test their UI and features without disrupting your musical signal flow!

Each lives in its own folder under `src/app/`, and each builds into its own
`.amxd` carrying its own UI bundle. (`hello-audio-rev` is the exception that
proves it: it *shares* `hello-audio`'s folder, via the manifest's `ui` field, so
that the order of its chains is the only thing about it that differs.)

### Both of them, in a real chain

![hello-midi, an instrument, and hello-audio on a Live track](doc/screenshot-midi-audio-chain.png)

**hello-midi** (left, a MIDI effect) is pulsing C3 at 1/16. It feeds **Hello
Bass** - an ordinary Ableton instrument, nothing to do with this repo - which
turns those notes into audio. That audio then runs through **hello-audio**
(right, an audio effect), whose Cutoff slider is riding a real lowpass filter at
10.7 kHz.

Two devices built from TypeScript, sitting in a normal Live device chain either
side of a stock instrument, behaving like any other device. Note that hello-midi
says *"free-running"*: the transport is stopped, so it is pulsing off its own
fallback clock rather than Live's - see the tutorial for why a sequencer must use
the transport when it is running.

For how any of it works underneath - the message protocol, the generated
patchers, the `.amxd` container writer, Push support - see
**[doc/ARCHITECTURE.md](doc/ARCHITECTURE.md)**.

---

## What is supported

M4L-JWEB handles the entire Max bridge so your React app feels like a native Ableton device. Out of the box, it supports:

- **Parameter Automation:** Your UI components drive real Max parameters underneath. Recording an automation lane in Live, automating via clip envelopes, or MIDI-mapping a physical controller just works without fighting your app.
- **Push Integration:** Parameters declared in your code are automatically exposed and grouped for Ableton Push encoders.
- **Accurate MIDI Timing:** Notes are placed on Max's scheduler. Your JavaScript sequencer computes *when* a note should fall, and Max places it with sample-accurate precision despite the UI's 20Hz refresh rate.
- **Audio DSP Chains:** Declarative audio signal paths (filters, gains, overdrives) that process sound at native C++ speeds. Audio never crosses the JS bridge.
- **Mocked Development:** A simulated Live environment runs in the browser, providing transport controls, tempo, and message logs so you can build the UI without opening Ableton.

---

## What you need

### To build

- **Node.js 20+** and **pnpm 10+**.
- **No Max license, and no Max editor.** The patcher is generated, and the
  container is written byte-for-byte by `packages/build/src/amxd.mjs`.
- **No Ableton Live.** The entire UI develops in a browser, against a mocked Live.

### To run the device: Live, and not every edition

**Not every Ableton edition can run Max for Live devices:**

| Edition | Runs this device? |
|---|---|
| **Live Suite** | Yes. Max for Live is included. This is the normal path. |
| **Live Standard** | Only with the paid **Max for Live add-on**. Not included by default. |
| **Live Intro** | No. Max for Live is not available, and there is no add-on path. |
| **Live Lite** (bundled with hardware) | No. Same as Intro. |

So **the entry-level Ableton license cannot run this.** You need Suite, or
Standard plus the Max for Live add-on. You do **not** need a separate Cycling '74
Max license on top - Max for Live bundles the Max runtime, and this repo never
opens the Max editor anyway.

**Versions.** Developed and tested against **Live 12 with Max 9** on Windows. The
`[jweb]` object the whole UI depends on arrived in **Max 8**, so Live 10 and 11
should work in principle - but that is reasoning from the docs, not something I
have run. Treat anything below Live 12 as unverified.

**Platforms.** Live runs on **macOS and Windows** only. The build runs anywhere
Node does, so CI on Linux is fine - you just cannot run the result there.

---

## Build, run, install

### Develop without Live

```bash
pnpm dev:hello-midi     # or dev:hello-audio, or dev:spike
```

A **mocked Live** renders beside your device: a transport (play/stop, BPM)
driving real `tick` and `tempo` messages at the same 20 Hz cadence the wrapper
polls Live at, and a **log of every message crossing the bridge**, in both
directions. A sequencer becomes developable, and debuggable, in a browser tab.

The device keeps its true **169 px** height there, deliberately: the Live device
view does not scroll, it silently clips, and that is the cheapest bug to catch
early.

**A mock is a mock.** It gives you the entire message-level contract without a
DAW - the tedious, easy-to-get-wrong part. It cannot tell you about MIDI jitter,
real DSP, or LiveAPI on a loaded set. Keep "load it in Live" for those.

### Build and test

```bash
pnpm build   # one UI bundle per device, then one .amxd per device
pnpm test    # container round-trip, ES5 gate, protocol lint, bundle separation
```

### Install into Live

```bash
pnpm install:device
```

That picks the right script for your platform, finds your User Library, and
replaces any previous install of this device folder:

```
  installed hello-midi.amxd
  installed hello-audio.amxd
Installed to <User Library>\Max For Live\m4l-jweb
```

Then in Live: **User Library > Max For Live > m4l-jweb**.

> **The one gotcha:** Live embeds a **copy** of a device into the set. Instances
> already sitting on a track will **not** update when you reinstall - delete them
> and re-drag from the browser. Every device prints a build stamp in its footer,
> so a stale one is visible rather than mysterious.

The User Library is read from Live's own preferences (`Library.cfg`, the
`ProjectPath` value), newest version first, falling back to Live's default
location. No registry keys and no environment variables are involved, so a custom
library location is picked up automatically.

`pnpm install:device` wraps the same per-platform scripts the build copies into
`dist/` and into the release zip, so you can run them yourself
(`dist\install-windows.ps1`, `dist/install-mac.sh`). Both accept an optional
device name and source folder, which is how the CLI drives them - someone who
receives only the release zip runs the script sitting next to the device folder,
with no repo and no Node. There is no Linux installer: Live has no Linux build.

---

## Why: what Max for Live development normally costs

Ableton has no public plugin SDK for its device area. What it has is **Max for
Live**: an embedding of Cycling '74's Max, a visual programming environment with
four decades of history. A device is a Max *patcher* - a graph of boxes connected
by patch cords - wrapped in a binary `.amxd` container and hosted in Live's
device chain.

The canonical workflow:

1. Open Live, drop a Max device on a track, click Edit. The Max editor opens.
2. Drag objects onto a canvas: `midiin`, `live.dial`, `[js]`, MSP signal objects.
   Draw cords between them. Position everything by pixel.
3. For anything algorithmic, write ES5 JavaScript inside the `[js]` object, which
   also carries **LiveAPI** - the only scriptable access to Live's object model
   (tracks, clips, scenes, transport, scale).
4. Save. "Freeze" the device so its file dependencies travel inside the `.amxd`.
   Distribute that file.

This workflow has real strengths: it is direct, live-editable, and the Max object
library is enormous. Thousands of excellent devices are built this way. **None of
this is a criticism of Max** - it was designed for musicians patching live, and it
excels at that. It just means a software engineer's entire toolbox sits unused:

| What is missing | What M4L-JWEB does instead |
|---|---|
| **No components, no CSS, no state management.** The UI toolkit is Max's own, positioned visually and styled sparsely. | **The UI is a React app**, running in the `[jweb]` Chromium view that ships with Max. Components, CSS, canvas, WebGL, Web Workers. |
| **No modern language.** `[js]` runs an ES5-era interpreter: no modules, no `let`/`const`, no promises, no npm. | **You write TypeScript**, everywhere, including the `[js]` glue. ES5 is a compiler target, not a way of life - and the build re-parses the emitted glue to *prove* it is ES5 before it will package. |
| **No build, no diff, no CI.** The patcher is both source and artifact; version control sees JSON full of pixel coordinates; producing a distributable needs a human clicking inside a licensed Max editor. | **Patchers are generated from a manifest**, so patch cords become code review, and `pnpm build` emits `.amxd` files on a runner that has never had Max on it. |
| **A virtual filesystem quirk.** Frozen dependencies live inside the device where only Max-native objects can read them - an embedded browser cannot open the files you shipped with your own device. | **The UI travels inside the device** as a payload the `[js]` wrapper extracts to a real file on load, then points `[jweb]` at. |

The result is an Ableton device you build the way you build anything else: edit
text, run tests, push, let CI produce the artifact. No editor in the loop, no
pixel coordinates in your diffs.

**What it does not change.** Push still sees only Live *parameters*, never your
UI. Audio still belongs to Max's signal path, not to your app. Timing still
belongs to Max's scheduler. M4L-JWEB moves the *authoring*, not the runtime - and
the tutorial below is mostly about respecting that line.

It also makes the repo unusually agent-friendly, for the same reason: every
artifact is text, and every invariant is enforced by the build (ES5 gate,
container round-trip, protocol lint, bundle separation), so an LLM can implement a
device end to end and verify its own work. `CLAUDE.md` spells out the guardrails.

---

## Tutorial: author a device

### 1. Scaffold a repo

`m4l-jweb init` creates a new device repo, with `@m4l-jweb/bridge` and
`@m4l-jweb/build` as published dependencies rather than workspace links:

```bash
pnpm dlx @m4l-jweb/build init my-device
cd my-device && pnpm install
pnpm dev
```

You get a working `hello-midi` device that builds and runs unmodified. The rest
of this tutorial is what you change in it.

The template lives inside `@m4l-jweb/build` at
`packages/build/templates/starter/`, and most of it is this repo's own
infrastructure - the same `scripts/`, `vite.config.ts`, `tsconfig` and
`src/app/shared/`, with one device instead of three. `tests/starter.test.mjs`
compares those files byte-for-byte and fails if they diverge, so the template
cannot quietly fall behind the library again.

### 2. Declare the device - `patcher/devices.mjs`

The manifest says what the device *is*. The patcher is generated from it, so
patch cords become something you review rather than something you drag.

```js
export default [
  {
    name: "my-device",
    type: "midi",                    // midi | audio | instrument
    chains: ["midiin", "midiout"],   // canned wiring, applied in order
    unmatchedTo: "js",
  },
];
```

Parameters are *not* here - they live in `src/app/<device>/surface.ts` (step 4),
and the build generates the Max objects and their wiring from that declaration.

A **chain** is a small function that adds boxes and cords. Shipped today:

| Chain | What you get |
|---|---|
| `midiin` | Notes played into the device arrive in your app. |
| `midiout` | Notes your app generates are placed by Max, with sample-accurate timing. |
| `lowpass` | An audio effect you can hear: a filter with a Cutoff parameter. |
| `drive` | Soft-clipping distortion (`overdrive~`), with a Drive parameter. |
| `gain` | An audio effect with a Live parameter on the level. |
| `passthrough` | A straight wire. It does *nothing* to the audio - a scaffold, not a feature. |

**The order of the list is the signal path.** An audio device's `plugin~` and
`plugout~` come from the build, and each audio chain claims one *stage* between
them - so `hello-audio`'s `chains: ["lowpass", "drive", "gain"]` is
`plugin~ -> onepole~ -> overdrive~ -> *~ -> plugout~`. Reorder those three words and
the device is rewired: no patcher is opened, no cord is drawn, and no line of the
app changes.

That reordering is *audible*, which is worth knowing before you test it. Move
`gain` before `drive` and a quiet signal barely clips; leave it after and the
distortion happens at full level and is then turned down. Swapping `lowpass` and
`gain`, on the other hand, would generate a different patcher and sound **identical** -
they are both linear, so they commute. If you reorder two linear stages and hear
nothing, the build is not broken.

Adding an effect to a device is therefore a one-word diff, and this is the whole
argument for generating patchers rather than drawing them:

```diff
-    chains: ["lowpass"],
+    chains: ["lowpass", "drive"],
```

```diff
     cutoff: dial({ range: [40, 18000], unit: "Hz", exponent: 4, default: 18000, short: "Cutoff" }),
+    drive:  dial({ range: [1, 10], unit: "x", default: 1, short: "Drive" }),
```

`pnpm build`, and the device has an `overdrive~` in its signal path, a Drive dial in
Live, an automation lane, a Push encoder and a typed `useParam(surface, "drive")` in
the app. Nothing was wired by hand, and if you forget the second diff the **build
fails**: a chain that drives DSP from a parameter says which one it needs, and no
device ships a distortion with no drive control.

Write your own in `patcher/chains.mjs`. A chain that drives DSP from a parameter
(`lowpass` wants `cutoff`, `gain` wants `gain`) fails the build if the device's
surface does not declare it - and it takes that parameter in **real units**, doing
no arithmetic on it: the range, the unit and the curve belong to the parameter.

### 3. Define the protocol - `src/app/<device>/protocol.ts`

Every message crossing the bridge is a **selector** (a word) followed by
arguments. This file is the single source of truth for both sides, and `pnpm
test` fails if you name a selector nothing on the Max side handles - because an
unrouted selector produces no error at runtime, it just falls on the floor.

Spread in the library's contracts rather than retyping the names. `DEVICE_IN` is
what the wrapper sends every device; `CHAIN_IN`/`CHAIN_OUT` are what the chains
own.

```ts
import { CHAIN_IN, CHAIN_OUT, DEVICE_IN } from "@m4l-jweb/bridge";

export const IN = {
  ...DEVICE_IN,         // mode, build, tick, tempo
  ...CHAIN_IN,          // notein <pitch> <velocity>
  density: "density",   // a parameter is just another message
} as const;

export const OUT = {
  ...CHAIN_OUT,         // midinote ..., flush
  ui_ready: "ui_ready",
} as const;
```

### 4. Write the device - `src/app/<device>/App.tsx`

It is a React app. The only thing that makes it a *device* is the bridge.

```tsx
import { flushNotes, onNote, sendNote } from "@m4l-jweb/bridge";
import { useDevice } from "../shared/device";

// mode, build stamp, tempo, transport - and the `ui_ready` handshake, which is
// not optional: the page loads asynchronously, so anything the wrapper sent
// before your handlers existed is simply gone.
const device = useDevice((playing, beats) => {
  // Called on every transport poll. Send your notes from in here.
});

// Notes played INTO the device. Note-offs are filtered - Max owns the release.
onNote((pitch, velocity) => { /* ... */ });

// Notes OUT of it. You compute WHEN; Max places the note on its scheduler.
sendNote({ pitch: 60, velocity: 100, durationMs: 120, delayMs: 80 });

// Notes are HELD by Max. A device that just stops sending leaves them sounding.
flushNotes();
```

**`delayMs` is the whole point of the split.** Live's transport reaches you at
20 Hz, so each tick covers a *slice* of musical time rather than an instant - and
a note almost never falls exactly on a poll. Work out which notes land inside the
slice, send each one with the delay that carries it to its true position, and Max
places them precisely. The notes land tight even though the clock driving them is
coarse, and your app never touches a timer.

**Audio is not yours to carry.** An audio effect's parameter is wired straight
into the signal path inside the patcher: your React code moves a *value*, never a
sample, and the sound keeps working even if the browser stalls.

### 5. Add parameters - `src/app/<device>/surface.ts`

Push shows Live *parameters*, not your UI - not yours, not anyone's. So every
musically meaningful control has to exist as a real Live parameter as well as in
your app. You declare it **once**:

```ts
import { defineSurface, dial } from "@m4l-jweb/surface";

export default defineSurface({
  params: {
    cutoff: dial({ range: [0, 1], default: 1, short: "Cutoff" }),
  },
});
```

The build generates the rest: a `live.dial` that is automatable, MIDI-mappable
and visible to Push, wired in **both** directions. A knob turn (or an automation
lane, or a Push encoder) arrives in your app as `cutoff 0.42`; your app writes it
back with `set_cutoff 0.42`, which moves the dial *and* the DSP the parameter
drives.

**Set `default`.** Without it a `live.*` object loads at the *bottom* of its
range, and for a filter cutoff that is a device which swallows the signal the
moment you drop it on a track. And **declare the `unit`**: with no unit style Live
prints a float as an integer, so a smooth sweep reads "0" and "1" on a Push.

Bind it in your app with one hook - typed from the declaration, two-way, and
naming no selectors:

```tsx
import { useParam } from "@m4l-jweb/surface/react";
import surface from "./surface";

const [cutoff, setCutoff] = useParam(surface, "cutoff"); // number
```

Turning the Push encoder moves the React state; moving the React control moves the
Live parameter - so automation, MIDI mapping and Push all follow. `pnpm dev:<device>`
renders the same declaration as a parameter panel and a **Push preview**, so you can
see what a performer will see without leaving the browser.

### 6. Declare Floating Windows and State Persistence

If your UI gets too big to fit inside the standard device view, you can offload sections to **floating windows**. You can also declare arbitrary JSON **state** that is automatically saved into the Live Set (so the user doesn't lose their settings when they reopen the project).

Declare them both inside `surface.ts`:

```ts
import { defineSurface, state, window } from "@m4l-jweb/surface";

export default defineSurface({
  params: { /* ... */ },
  windows: {
    drumMap: window({ title: "Drum Mapping", width: 800, height: 600, entry: "DrumMap" })
  },
  state: {
    kitSettings: state({ default: { voices: 4, tuning: "C" } })
  }
});
```

And bind to them in your React app with hooks:

```tsx
import { useWindow, useStateSync } from "@m4l-jweb/surface/react";
import surface from "./surface";

export default function App() {
  const drumWindow = useWindow(surface, "drumMap");
  const [kitSettings, setKitSettings] = useStateSync(surface, "kitSettings");

  return (
    <div>
      <button onClick={drumWindow.open}>Open Drum Mapping</button>
      <button onClick={() => setKitSettings({ ...kitSettings, voices: 8 })}>Set Voices to 8</button>
    </div>
  );
}
```

The build process emits the correct Max `[pcontrol]` objects for the windows, and the exact `[pattr]` and `[dict]` objects needed to safely persist your JSON state inside the DAW. 

### 7. One device, one bundle

Each device is a folder under `src/app/`, and each `.amxd` embeds **its own** UI
bundle: `hello-midi` carries no filter code, `hello-audio` carries no sequencer.
`pnpm dev:<device>` runs one of them; `pnpm build` bundles each in turn. A device
ships what it is, not what its siblings are.

---

## License

**MIT** - see [LICENSE](LICENSE). The published packages (`@m4l-jweb/bridge`,
`@m4l-jweb/surface`, `@m4l-jweb/wrapper`, `@m4l-jweb/build`) carry the same
licence.

In practice that means you can use this commercially, modify it, and ship
closed-source devices built with it, with no obligation to publish your changes.
The only condition is that the copyright notice and licence text travel with
copies or substantial portions of *this* software - not with the devices you
build using it. It comes with no warranty and no liability.

**What it does not cover.** Ableton Live and Max are Cycling '74's and Ableton's,
under their own licences - this project neither redistributes them nor grants any
rights to them. A `.amxd` you build here runs inside Max for Live and needs a
licence for it (see [What you need](#what-you-need)). The dependencies pulled in
at build time (React, vite, and so on) carry their own licences, all permissive.
