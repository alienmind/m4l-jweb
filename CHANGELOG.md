# Changelog

## 1.1.0 - windows that make sound, and controls that say what they are

**A window can BE the instrument.** `window({ audio: true })` compiles to `[jweb~]`
inside the window's subpatcher, its L/R leaving on a pair of outlets and summed into
the device's audio path at the same `[+~]` stage the `webaudio` chain uses. A
`loadbang` pulses the window open and shut once at device load, because a page in a
window nobody opened never loads at all - and a page that never loaded has no
AudioContext and makes no sound. Verified in Live: the audio starts without the window
ever being opened and keeps running with it closed.

**A window can be a whole prebuilt SITE.** `window({ site: "<dir>" })` takes its
content from a directory instead of a component, delivered as a folder next to the
`.amxd` rather than base64 inside it - the payload path does not scale to tens of MB.
The installers and the release zip carry the folder; the wrapper says so in the console
when it is missing rather than opening a blank window.

**Windows resize now.** A window shown in PRESENTATION cannot have its page resized at
runtime (the rect is accepted and never redrawn), so a sounding window is laid out on
the patching canvas with the page at the origin and the plumbing parked above it. Max
has no resize notification, so the wrapper polls `window getsize` and fits the page.

**Controls can be described at RUNTIME.** `describeParam(id, { name, unit, range })`
and `onParamRange()` in the bridge, `knobPool(8)` and `useControls()` in the surface:
a device whose real controls come from the user's code declares a pool of dials and
lends them out, and each one carries the borrower's name, unit and travel. All three
attributes take on the device panel - an earlier spike recorded the opposite and was
believed for months. `_parameter_range` was never the obstacle: the parameter reports
in the NEW domain afterwards, so a page still normalizing 0..1 scales twice and pins
the control at its minimum. Hence the handshake - the wrapper answers whether the range
took, and exactly one side scales.

**Pages can talk to each other's windows.** `window_send <winId> <selector> <value>`,
`sendToWindow()` app-side. State slots already crossed that gap but a slot SAVES WITH
THE SET, which is wrong for anything continuous - a swept knob would write the Live set
on every frame.

**A sounding window reports its level** (`[peakamp~]` -> `window_level`), because
`[jweb~]` has audio out and no audio in: no page can ever be handed audio, so a device
view that wants to show what its window plays has to be told in messages.

**Native layout takes explicit row sizes.** `rows: [1, 4, 4]` is one control on the
first row and four on each of the next two. Column-major could not express a transport
button above two banks of dials, and interleaved them instead.

**Fixed:** every window URL was sent twice (loadbang and live.thisdevice both call
`loadWebview`), which is invisible for a 250 kB page and a double load for a 17 MB one.

New measured facts in [doc/MAX-FACTS.md](doc/MAX-FACTS.md): runtime rename/unit/range,
`[jweb~]` having no audio input, and presentation windows not resizing.


## 0.9.5 - version alignment for the superdough release

A version bump to align with m4l-strudel 0.9.5, which ships the offline-render
instrument on top of the `saveToFile` + `renderplay` pipe delivered in 0.9.1 (the bridge
save primitive, the double-buffered transport-locked `renderplay` chain, `hello-render`).
No library code change beyond the bump; publishes a pinned version m4l-strudel consumes in
place of the local `link:`.

Backlog added: **hybrid controls - a native-knob POOL the Surface declares**, so any
device can declare a fixed pool of build-time `live.dial`s that dynamic controls borrow
from (with the runtime rename + range folded in), generalising the hand-rolled `S1..S8`
logic in m4l-strudel's superdough device. See [doc/TODO.md](doc/TODO.md) item 2.

## 0.9.0 - modulation, more chains, and observing Live

**The `remote` chain and pattern modulation.** One `live.remote~` per declared slot
goes in the device; `resolveParamId()` + `bindRemote()` point a slot at any Live
parameter by LOM id, and `writeRemote()` streams a value per tick, each ramped into a
signal by `[line~]` - continuous modulation with no automation written. The value is
NOT in the parameter's own units: `live.remote~` treats it as a linear position across
the range and applies the knob's `exponent` on top, so a curved parameter must
pre-warp (measured in Live, not read anywhere).

**`defineWatch()` - declared LiveAPI observers.** Declare the Live properties to
observe in `src/app/<device>/watch.ts` (the read-only twin of `defineSurface()`); the
build injects `WATCH_SPECS` and the packaged wrapper attaches every observer from
`bang()` - the one place a LiveAPI object is not born dead (hard rule 4) - forwarding
each change as `watch_<key>`. `useWatch()` reads it in React, typed from the
declaration. The observer is generated, so it cannot be written in `loadbang` where it
would silently watch nothing forever: the lifecycle rule is now structural.

**New chains:** `hpf` (high-pass) and `crush` (bit/sample-rate reduction). Buffer names
are now instance-scoped with Live's `---` prefix, so two copies of a sampler on two
tracks keep their own sound - `#0` never expanded inside a frozen `.amxd`, which had
made the scoping a no-op.

**`window({ alwaysOnTop: true })`** keeps a floating window in front of Live instead of
behind it the moment Live is clicked - for a window you read *while* working (a
reference, a cheatsheet) rather than one you work *in*.

**Clip I/O in the bridge.** The wrapper had `read_notes`/`write_clip` handlers but the
bridge never exposed them; `readClip()`, `writeClip()` and `readSelectedClip()` are now
the shaped API. `readClip()` reads this device's own track (playing-else-first,
selection-blind - what m4l-strudel's engine needs); `readSelectedClip()` reads the clip
the cursor is on and treats an empty highlighted slot as no clip. `hello-clip` and
`hello-remote` are new example devices that make clip I/O and the `remote` path testable
in Live without any other repo.

### Fixes

- **`outlet.apply` crashed Live.** A LiveAPI observer forwarded its value with
  `(outlet as Function).apply` - which faults Max's `[js]` engine (`js.mxe64`, access
  violation, confirmed from a crash minidump) and takes the host down. Every emit is
  fixed-arity now, or a single array for a variadic list (`read_notes`). See
  [MAX-FACTS.md](doc/MAX-FACTS.md).

- **The parameter registry is emitted at the patcher level.** Live ignores per-box
  `parameter_longname`, so `resolveParamId()` now matches against the name Live
  actually registers (the shortname), and banks are written into the registry. Getting
  a `live.remote~` bound to the wrong parameter is a filter sweep on someone else's
  device, so this refuses to guess when two parameters share an accepted name.
- **State-default seeding**, so a slot that Live has never saved starts from its
  declared default rather than an empty dict. Presets ride along into the installers.
- **A state slot can hold a string or an array**, not only an object - every value now
  travels inside a `{"__value": ...}` envelope, because a Max `[dict]` is a key/value
  map and a bare scalar had nowhere to live (it silently persisted as `{}`).

## 0.7.0 - native layout

**`layout.native`** renders declared parameters as native `live.*` objects in the
device view, beside a right-shifted `[jweb]` - the same parameters, the same fan-out
graph, `useParam()` still reads them, now drawn by Max. A **two-screen panel**
(`useNativePanel`, `layout.native.panel`) layers the web UI and a native control panel
and flips between them by `hidden`: runtime reposition/resize of presentation objects
does NOT take in a frozen M4L device (measured - `presentation_rect` writes are stored
but never redrawn), but `hidden` does. `layout.native.switch` pins a view-toggle
parameter top-right, out of the grid. New **`button`** parameter kind (a labelled
`live.text` toggle), for the way back from a native panel.

## 0.6.5 - polyphony and FX

**The `instrument` chain:** a generated `[poly~]` voice patch, frozen into the device,
playing a keymap of buffers via `playVoice()`. Polyphony and voice-stealing are Max's
job - send overlapping notes across any slots and each lands on a free voice.
Confirmed in Live. **`delay` and `reverb`** FX chains, each held to the neutrality
contract (a chain the manifest does not name changes nothing). CI now **publishes over
OIDC trusted publishing** rather than a token - pnpm packs, npm verifies provenance,
and there is no `NPM_TOKEN` to leak.

## 0.6.0 - declarations that persist, and samples

**Floating windows and state persistence are declarations.** `window()` compiles a
second page into its own subpatcher; `state()` + `useStateSync()` give a
`useState`-shaped binding to arbitrary JSON saved inside the Live set, per instance.
Two bugs that had made both useless were fixed: **state persistence was never saving
into the set** (`parameter_enable` is what a `[pattr]` needs; `@save`/`@autorestore`
are not it), and a window/state selector carried its id in the selector word, where
Max dispatched it to a handler no device had.

**The `samples` chain:** a named `[buffer~]` per slot, previewed through the track, and
the path resolution that lets `[buffer~]` open the file the download just wrote (a bare
name goes to Max's search path, which the device folder is not in).

**Fetch-to-disk hardened:** the last `[node.script]` is gone, and a 404 can no longer
destroy a cached file - every fetch downloads to a `.part`, validates status/error/
bytes, and only then asks `[maxurl]` to copy it into place. The shipped wrapper is now
tested against a fake Max (and the [maxurl] simulator encodes what Max was measured to
do), so the orchestration is pinned even where Live's behaviour cannot be.

## 0.5.0 - composable audio chains

**Audio chains stack.** `chains: ["lowpass", "drive", "gain"]` is a series -
`plugin~ -> onepole~ -> overdrive~ -> *~ -> plugout~` - and the **order of the list
is the signal path**. Confirmed by ear, in Live.

Before this, they did not stack: they **mixed**, silently. Every audio chain created
its own `plugin~` and `plugout~` and wired itself between them, so two of them were
two devices fighting over one patcher - duplicate box ids, and the dry signal summed
back over the wet one. No error at build time, none in Live; the device just sounded
wrong in a way you would blame on your own DSP.

The endpoints now belong to the **device**, created once by the build for any `audio`
or `instrument` type, and a chain claims one **stage** between them. It is the twin
of `claimAppMessages()`: one stream, several claimants, chained in series with an
explicit hand-off rather than hung off the source in parallel.

New chain: **`drive`** (`overdrive~`, soft-clipping distortion, 1 = clean to 10 =
filthy). It is in the vocabulary for testability as much as for sound - `lowpass` and
`gain` are both linear and therefore *commute*, so a composition built only from
those two sounds identical whichever way round it goes, and cannot be verified by
ear.

### Breaking

**A chain must not create `plugin~` / `plugout~`.** Take the stage before you and
hand yours on:

```js
const [srcId, srcOutlet] = ctx.audioIn(channel);   // whatever the last stage left
// ...create your DSP, wire srcId -> yours...
ctx.setAudioOut(channel, myId, 0);                 // you are the tail now
```

A chain that still creates the endpoints now **fails the build**: a second box with
an existing id throws (`assertUniqueBoxIds()`), because a patcher with two boxes
sharing an id is one Max resolves however it likes. That guard is the error message
this bug never had.

**An audio chain on a `type: "midi"` device fails the build** too, instead of
conjuring endpoints and quietly making the device something the manifest never
declared.

### Also

- **`composePatcher()`** is exported from `@m4l-jweb/build`: the build's own
  per-device pipeline (endpoints, chains, surface, close, validate), so a test can
  generate a patcher exactly as the build does rather than re-implementing the order
  of its steps.
- **A chain takes a parameter in REAL units and does no arithmetic on it.** The range,
  the unit and the curve live on the parameter (`range: [40, 18000]`, `unit: "Hz"`,
  `exponent`). A chain that re-introduces an `[expr]` mapping double-maps a parameter
  that already carries its own curve.
- **`hello-audio` is now three chains** (`lowpass`, `drive`, `gain`), and
  **`hello-audio-rev`** is the same app and the same parameters with the *opposite*
  order - the pair that proves the series is real. See below.

## 0.4.0 - the Surface

A device's Live parameters are declared **once**, in `src/app/<device>/surface.ts`,
and everything else is generated from that declaration: the `live.*` objects, their
patcher wiring in both directions, the protocol selectors the lint checks, and a
typed React binding. See [doc/ARCHITECTURE.md](doc/ARCHITECTURE.md).

```ts
// src/app/<device>/surface.ts
export default defineSurface({
	params: {
		cutoff: dial({ range: [40, 18000], unit: "Hz", exponent: 4, default: 18000, short: "Cutoff" }),
	},
});
```

```tsx
const [cutoff, setCutoff] = useParam(surface, "cutoff"); // number, typed, two-way
```

### Breaking

**1. `parameters` is gone from `patcher/devices.mjs`.** Declare them in
`surface.ts`. The build **fails** on a leftover `parameters` field rather than
ignoring it - a silently dropped parameter is a device whose knobs vanished.

**2. A custom chain must claim the app's messages with `claimAppMessages()`.**
Routes are chained in **series**, each handing its unmatched outlet to the next
(`[jweb] -> [route midinote flush] -> [route set_*] -> [js]`), because two routes
hanging off `[jweb]` in parallel each pass the unrouted messages on - so the
wrapper sees every `ui_ready` twice. If your chain does this:

```js
removeLine(lines, jwebId, unmatchedId);
lines.push(line(jwebId, 0, "obj-my-route", 0));
lines.push(line("obj-my-route", 2, unmatchedId, 0)); // unmatched carries on
```

replace all three lines with:

```js
claimAppMessages(ctx, "obj-my-route", 2); // ctx, the route's id, its unmatched outlet
```

The build **fails** if a chain cut `[jweb]`'s cord without saying where the messages
went. A chain that never touched that cord (it only *taps* `[jweb]`'s outlet in
parallel) needs no change.

> Do **not** find the cord to cut by searching for whatever feeds `[js]`.
> `live.thisdevice` feeds it too, and cutting *that* cord kills every LiveAPI
> observer in the device, silently.

**3. A parameter's selectors must not be re-declared in `protocol.ts`.** `<id>` and
`set_<id>` are generated; the lint fails if a device also names them by hand. Bind
them with `useParam()`, which derives both from the declaration.

**4. A chain that drives DSP from a parameter reads it from the surface.** `lowpass`
needs a `cutoff`, `gain` needs a `gain`, and the build fails with a clear message if
the device's `surface.ts` does not declare it. Wire a parameter into DSP only via
`fanParamInto()`, which wires the object's outlet **and** the route's, or neither -
`set` silences a `live.*` object's outlet for *everyone*, including whatever it
drives inside the patcher.

### Fixed - three bugs that were silent in Live

- **A range was written to a key Max ignores.** `parameter_range` is not what Max
  uses for a continuous parameter (it appears in none of the patchers Ableton
  ships); the range is `parameter_mmin` / `parameter_mmax`. Every declared range was
  quietly discarded and the object kept its default.
- **A float parameter was printed as an integer.** With no `parameter_unitstyle`,
  Live rounds the *readout*: a smooth 0-1 cutoff reads "0" or "1" on a Push.
  Declare `unit` (`"Hz"`, `"dB"`, `"ms"`, `"%"`, `"st"`, or any custom string) and
  put the range in **real units**, with `exponent` for the knob's curve.
- **`live.thisdevice`'s cord could be cut** by the Surface interposing its route -
  which would kill every LiveAPI observer in the device. Routes now hand off
  explicitly.

### Added

- `@m4l-jweb/surface/react` - `useParam()`, `useSurface()`.
- `@m4l-jweb/surface/store` - the same state with no React in it.
- The dev harness renders the **parameter panel** and a **Push preview** from the
  declaration.
- `esbuild` is now a dependency of `@m4l-jweb/build` (it bundles `surface.ts`, which
  is TypeScript importing TypeScript, so Node can import it at build time).

### Not yet (at 0.4.0)

**Push banks** were deferred here - they needed patcher-JSON archaeology and blocked
nothing (Live falls back to declaration order). **They shipped in 0.7.0**: `banks` in
the surface declaration are emitted as `parameterbanks` in the patcher-level registry,
so a Push page turn lands on the group you declared.
