# Changelog

## 1.6.0 - Push pads, an optional web UI, and Snake

Two features and one example.

**You can now program the Push's 64 pads.** Read them, light them, from TypeScript.

**A device no longer has to contain a browser.** The web UI is now optional. Set
`target: "headless"` and the build produces a device with no Chromium in it at all.

**`push-snake` is Snake on the pads**, added to show both features working.

### The pads

Declare what your device wants:

```ts
export default defineControls({
  surface: "push",
  controls: { pads: grid({ role: "matrix", rows: 8, cols: 8 }) },
});
```

Then `usePadGrid()` gives you two things: `draw()`, where you paint the whole grid using
colour names, and `onPad()`, where presses arrive with `x`, `y`, a velocity and `down`.
`x` runs left to right and `y` runs bottom to top.

You name a **role**, not a Max control name. The library keeps the name table and picks
the right one at runtime by asking the connected hardware. A Push 3 answers with 176
control names, and they are not the same as a Push 2's.

**Takeover is a normal Live parameter, and it is off by default.** Declaring controls
adds two parameters to your device: `takeover` and `focus` (Device / Track / Always). So
the user can give the pads back from a Push encoder, the device view or an automation
lane. Two copies of the device in one set take turns instead of fighting.

**Encoder roles are refused.** You can grab the eight encoders, and if you do they stop
moving their parameters - which loses automation, MIDI mapping and the automation lane.
The library will not let you declare one.

**Pad presses do not go through `[js]`.** The generated `takeover` chain puts a
`[live.observer]` between the hardware and your app. Painting goes the other way and is
compared twice: once in the page against the last frame sent, and once in the wrapper
against what the hardware is already showing. Live repaints the pads as it hands them
over, so those really are two different questions.

**The dev harness has a mock 8x8 grid.** It paints from the real messages your app sends
and produces real pad events when you click. A y flip in the wrong place shows up as an
upside-down picture in a browser tab, instead of a rebuild, a reinstall and a squint at
64 LEDs.

### No browser

`target: "headless"` in `patcher/devices.mjs` and the build emits only the `[js]` wrapper
and the patcher. No `[jweb]`, no HTML payload, no Chromium.

You declare the device's interface exactly as before - `defineSurface`, `defineControls`,
`defineWatch`. The device view is the native `live.*` dials the build already generated.
Your logic goes in `src/app/<device>/headless.ts`, which is compiled to ES5 and runs
inside Max.

**A declared parameter becomes a function name.** `[live.dial rate] -> [prepend rate] ->
[js]` calls `function rate(v)`, and `outlet(0, "set_rate", v)` writes it back. There is
no store and no handshake, and no `protocol.ts` either, because there is no bridge to
have a contract across.

The change inside the build is small: every chain that used to name `[jweb]` now names
`ctx.appIn` / `ctx.appOut`, which is `[jweb]` under one target and `[js]` under the
other.

`hello-headless` is a MIDI arpeggiator built this way. It is 167 KB. The same device with
a page is 437 KB.

**What you lose is refused at build time, not discovered in Live:** the `webaudio` chain
(its sound comes out of the page), floating windows (a window is a second page), and
`latency` (there is no `[jweb~]` to buffer).

### push-snake

Snake on the 8x8 grid. The border ring is the scoreboard: a 20-cell length gauge filled
from the bottom-left upwards, three lives at the bottom right spent right to left, and
two turn pads at the bottom left.

A crash costs a life and restarts the snake. Filling the gauge wins and paints a green
smiley. Losing all three lives paints a red frown. Either blinks three times and stays
until you start another game.

It draws the same grid in the device view, so you can play it with no Push in the room -
click the pads or use the arrow keys.

The soundtrack is four loop layers, sparsest to densest, moving up one level every two
segments. All four are the same length to the sample, start at the same moment and play in
sync, and a level change crossfades their volumes - so transitions are exact. Winning
plays a fifth file, the full track, once.

### Fixed

- **The takeover said it was on and never grabbed anything.** A `[js]` property observer
  splits an object-valued property into two atoms, so `selected_track` arrives as
  `["selected_track", "id", 5]`. Reading `a[1]` gave `Number("id")` = NaN, which never
  equals anything, so the focus check was false in every set. Nothing reported it, because
  comparing two numbers is not an error.
- **A device inside a Rack could never hold the grid.** `this_device canonical_parent` is
  the Chain, not the Track, and a Chain's id matches no selected track. It now reuses
  `ownTrack()` from `liveapi.ts`, which already climbed the parent chain for clip I/O.
- **"The pads are dark" now says which of four reasons it is.** `off`, `no_surface`,
  `unresolved` and `not_focused` all look identical on the hardware, and Live reports none
  of them - a refused grab is a console line and a normal return. The reason now goes to
  the Max console and the device view.
- **A saved `focus` came back as the default.** Live restores a parameter during patcher
  load, before setup runs, and setup then wrote the declared default over it. A set saved
  with `Always` reopened as `Track`.
- **Observers acted while they were still attaching.** Every LiveAPI observer fires once as
  it is created, so the device was resolving control names before it knew which track it
  was on.
- **`tsc -b` failed on an asset import the app compiled fine.** `tsconfig.test.json` could
  not see vite's asset type declarations, and `vitest.config.ts` did not use the app's JSX
  runtime. Both fixed.

### Also

- `push-snake`'s speed dial in hertz became a **difficulty menu** (Easy / Normal / Hard).
  The number on Push stopped matching the grid once the snake grew, and most of the dial's
  range was unplayable.
- `CLAUDE.md` now has a rule for writing Markdown in this repo: plain language, short
  sentences, and headings that say what a section is about. 49 headings were renamed across
  the docs and every internal link updated.

### Not yet checked in Live

The win face, the difficulty curve, two copies in one set, and all of `hello-headless`.
The checklist is `doc/TODO.md` item 2b.

## 1.3.1 - maintenance

No new features. `docs` beside the device manifest missed 1.3.0 by one commit, and npm
versions cannot be replaced, so it goes out as a patch release.

`docs` is a named export listing files that travel in the release zip and the installed
folder without belonging to any device - a manual, a licence. A listed file that is not
there is a warning, not a build failure: a generated PDF may not exist on a machine with
no browser, and that is never worth failing a build that produced every device correctly.

## 1.3.0 - put a rendered file straight into a Live clip

A device that bounces audio used to stop at a file on disk, leaving the user to copy the
path and do five steps in Explorer. This release closes that.

**`createAudioClip(path, target, setup)`.** It puts the file into a clip slot and sets the
clip up from what the render already knows: the name, warping, and loop points from the
exact cycle count. It answers `clip_created` or `clip_error <reason>`.

`ClipSlot.create_audio_clip` turned out to be ordinary LOM. This repo carried "the LOM
cannot make an audio clip" as a fact for months, and it was false. There is no chain and
there are no patcher boxes - it is pure LiveAPI, like `defineWatch()`.

**It checks the Live version rather than catching an error.** The call is documented well
before Live 12.0.5 and does nothing there, so there is no error to catch - the slot just
stays empty. The wrapper answers `needs_live_1205` instead, and the device keeps offering
the clipboard.

**The request travels as one base64 atom.** A file path and a clip name both contain
spaces in real use ("Ableton Library", or whatever the user typed), and Max splits a
message on whitespace, so two such fields in one flat message cannot be pulled apart
again. LiveAPI's own `call` does not split a string argument, which had to be true first.
Both are measured in `doc/MAX-FACTS.md`, along with the finding that Live references the
file where it is rather than copying it into the project.

**`onTrackKind()`** tells a page which kind of track it is on. An audio clip only lands on
an audio track and a MIDI clip only on a MIDI one, so a device needs to know. The wrapper
answers `track_kind audio|midi|none` at `ui_ready`. The alternative was baking the answer
into the build, which means two manifest entries differing in a fact Live already knows.

**An instrument cannot target an audio track from its own view.** That is a UI fact, not a
LOM one: a device's view is on screen only while its track is selected, so the highlighted
clip slot is always one of its own. `{ target: "new" }` is the way out. Shipping the
device as an audio effect is the better answer.

**Releases can carry docs.** See 1.3.1 - this landed one commit late.

## 1.2.1 - where files went, and two dials that were not what they seemed

Mostly fixes.

**A runtime range costs a dial its automation.** `describeParam(id, { range })` no longer
widens `_parameter_range` unless you pass `widenRange: true`, and `useControls()` now
leaves dials at 0..1 by default.

Measured in Live: a widened dial stops following its automation lane and any Rack macro
mapped to it. Both keep driving the parameter in the build-time range the frozen device
gave them. A sibling dial left at 0..1 in the same device works normally. The page scales
instead, which is what it did before 1.1.0. You lose the dial reading `600 Hz` and see
`0.44`; you gain a control the musician can automate. See `doc/MAX-FACTS.md`.

**`useControls({ describe: false })`.** A device with two pages sharing one pool of dials -
a device view and a window - had both naming the dials, so the name depended on which page
rendered last. Now one page describes and the other still gets its controls to draw.

**The device page's `[jweb~]` can carry a `latency`.** `window({ audio: true, latency })`
took one from 1.1.0 and the device's own page could not, so a device that made sound from
both had one clean page and one dropping out at the default (~21 ms at 48 kHz). A manifest
`latency` now reaches `obj-jweb`.

**`copyPath()` in the bridge.** A device that writes files has to answer "where did it
go", and nothing in Max opens a file manager - `; max launchbrowser <folder>` is the only
door offered and it does not open one. That leaves the clipboard, and inside `[jweb~]` the
clipboard lies: `document.execCommand("copy")` returns true while copying nothing, and the
page cannot tell, because `navigator.clipboard.readText()` needs a secure context a
`file://` page does not have.

So `copyPath()` tries the copy, then shows a focused, pre-selected field and waits for the
browser's own `copy` event. It reports `copied`, `manual` or `cancelled` rather than a
boolean that might be lying. Three devices had worked this out separately; the
measurements are in `doc/MAX-FACTS.md`.

**`deviceBufName` / `voiceBufName` removed.** 0.9.9 deleted the `samples`, `instrument`
and `renderplay` chains, because a `[jweb~]` page decodes and plays its own audio. These
two outlived them with no callers. What they knew stays in `doc/MAX-FACTS.md`, because it
is true of Max rather than of this library: a leading `---` is Max for Live's
per-device-instance substitution, scoped across subpatchers and `[poly~]` voices, while
`#0` stays literal in an `.amxd`.

## 1.1.0 - windows that make sound, and controls that say what they are

**A window can be the instrument.** `window({ audio: true })` compiles to `[jweb~]` inside
the window's subpatcher. Its L/R leave on a pair of outlets and are summed into the
device's audio path at the same `[+~]` stage the `webaudio` chain uses.

A `loadbang` opens and shuts the window once at device load, because a page in a window
nobody opened never loads, and a page that never loaded has no AudioContext and makes no
sound. Verified in Live: the audio starts without the window ever being opened, and keeps
running with it closed.

**A window can be a whole prebuilt site.** `window({ site: "<dir>" })` takes its content
from a directory instead of a component, delivered as a folder next to the `.amxd` rather
than base64 inside it - the payload path does not scale to tens of MB. The installers and
the release zip carry the folder, and the wrapper says so in the console when it is
missing rather than opening a blank window.

**Windows resize now.** A window shown in presentation cannot have its page resized at
runtime - the rect is accepted and never redrawn - so a sounding window is laid out on the
patching canvas with the page at the origin and the plumbing parked above it. Max has no
resize notification, so the wrapper polls `window getsize` and fits the page.

**Controls can be described at runtime.** `describeParam(id, { name, unit, range })` and
`onParamRange()` in the bridge, `knobPool(8)` and `useControls()` in the surface. A device
whose real controls come from the user's code declares a pool of dials and lends them out,
and each one carries the borrower's name, unit and travel.

All three attributes take on the device panel. An earlier spike recorded the opposite and
that was believed for months. `_parameter_range` was never the obstacle: after it is
widened, the parameter reports in the new range, so a page still normalizing 0..1 scales
twice and pins the control at its minimum. Hence the handshake - the wrapper answers
whether the range took, and exactly one side scales.

**Pages can talk to each other's windows.** `window_send <winId> <selector> <value>`, or
`sendToWindow()` from the app. State slots already crossed that gap, but a slot saves with
the set, which is wrong for anything continuous - a swept knob would write the Live set on
every frame.

**A sounding window reports its level** (`[peakamp~]` -> `window_level`). `[jweb~]` has
audio out and no audio in, so no page can ever be handed audio. A device view that wants to
show what its window is playing has to be told in messages.

**Native layout takes explicit row sizes.** `rows: [1, 4, 4]` is one control on the first
row and four on each of the next two. Column-major could not express a transport button
above two banks of dials, and interleaved them instead.

**Fixed:** every window URL was sent twice, because `loadbang` and `live.thisdevice` both
call `loadWebview`. Invisible for a 250 kB page, a double load for a 17 MB one.

New measured facts in [doc/MAX-FACTS.md](doc/MAX-FACTS.md): runtime rename/unit/range,
`[jweb~]` having no audio input, and presentation windows not resizing.

## 0.9.5 - maintenance

No library code change. A version bump to line up with m4l-strudel 0.9.5, which ships the
offline-render instrument on top of the `saveToFile` + `renderplay` pipeline delivered in
0.9.1. It publishes a pinned version m4l-strudel can consume in place of the local `link:`.

Planned next, and added to the backlog: **a pool of native knobs the Surface declares**, so
any device can reserve a fixed set of build-time `live.dial`s for dynamic controls to
borrow, with the runtime rename and range folded in. This generalises the hand-rolled
`S1..S8` logic in m4l-strudel's superdough device. See [doc/TODO.md](doc/TODO.md) item 2.

## 0.9.0 - modulation, more chains, and observing Live

**The `remote` chain and pattern modulation.** One `live.remote~` per declared slot goes in
the device. `resolveParamId()` + `bindRemote()` point a slot at any Live parameter by LOM
id, and `writeRemote()` streams a value per tick, each one ramped into a signal by
`[line~]`. That is continuous modulation with no automation written.

The value is not in the parameter's own units. `live.remote~` treats it as a linear
position across the range and applies the knob's `exponent` on top, so a curved parameter
has to pre-warp. Measured in Live, not read anywhere.

**`defineWatch()` - declared LiveAPI observers.** Declare the Live properties to observe in
`src/app/<device>/watch.ts`, the read-only twin of `defineSurface()`. The build injects
`WATCH_SPECS`, and the packaged wrapper attaches every observer from `bang()` - the one
place a LiveAPI object is not born dead (hard rule 4) - forwarding each change as
`watch_<key>`. `useWatch()` reads it in React, typed from the declaration.

The observer is generated, so it cannot be written in `loadbang`, where it would silently
watch nothing forever. The lifecycle rule is now structural.

**New chains:** `hpf` (high-pass) and `crush` (bit and sample-rate reduction). Buffer names
are now scoped per instance with Live's `---` prefix, so two copies of a sampler on two
tracks keep their own sound. `#0` never expanded inside a frozen `.amxd`, which had made
the scoping do nothing.

**`window({ alwaysOnTop: true })`** keeps a floating window in front of Live instead of
behind it the moment Live is clicked. For a window you read while working - a reference, a
cheatsheet - rather than one you work in.

**Clip I/O in the bridge.** The wrapper had `read_notes` and `write_clip` handlers, but the
bridge never exposed them. `readClip()`, `writeClip()` and `readSelectedClip()` are now the
shaped API. `readClip()` reads this device's own track - playing clip else first, ignoring
the selection, which is what m4l-strudel's engine needs. `readSelectedClip()` reads the clip
the cursor is on and treats an empty highlighted slot as no clip. `hello-clip` and
`hello-remote` are new example devices that make clip I/O and the `remote` path testable in
Live without any other repo.

### Fixed

- **`outlet.apply` crashed Live.** A LiveAPI observer forwarded its value with
  `(outlet as Function).apply`, which faults Max's `[js]` engine - `js.mxe64`, access
  violation, confirmed from a crash minidump - and takes the host down. Every emit is
  fixed-arity now, or a single array for a variadic list (`read_notes`). See
  [MAX-FACTS.md](doc/MAX-FACTS.md).
- **The parameter registry is emitted at the patcher level.** Live ignores per-box
  `parameter_longname`, so `resolveParamId()` now matches the name Live actually registers,
  which is the shortname, and banks are written into the registry. Binding a `live.remote~`
  to the wrong parameter is a filter sweep on someone else's device, so it refuses to guess
  when two parameters share an accepted name.
- **State-default seeding**, so a slot Live has never saved starts from its declared default
  rather than an empty dict. Presets now ride along into the installers.
- **A state slot can hold a string or an array**, not only an object. Every value now
  travels inside a `{"__value": ...}` envelope, because a Max `[dict]` is a key/value map
  and a bare value had nowhere to live. It used to persist as `{}`.

## 0.7.0 - native layout

**`layout.native`** renders declared parameters as native `live.*` objects in the device
view, beside a right-shifted `[jweb]`. Same parameters, same wiring, `useParam()` still
reads them - now drawn by Max.

A **two-screen panel** (`useNativePanel`, `layout.native.panel`) layers the web UI and a
native control panel and flips between them using `hidden`. Moving or resizing presentation
objects at runtime does not work in a frozen M4L device - measured, `presentation_rect`
writes are stored but never redrawn - but `hidden` does.

`layout.native.switch` pins a view-toggle parameter to the top right, outside the grid. New
**`button`** parameter kind (a labelled `live.text` toggle), for the way back from a native
panel.

## 0.6.5 - polyphony and FX

**The `instrument` chain:** a generated `[poly~]` voice patch, frozen into the device,
playing a keymap of buffers via `playVoice()`. Polyphony and voice-stealing are Max's job -
send overlapping notes across any slots and each one lands on a free voice. Confirmed in
Live.

**`delay` and `reverb`** FX chains, each held to the neutrality contract: a chain the
manifest does not name changes nothing.

CI now **publishes over OIDC trusted publishing** rather than a token. pnpm packs, npm
verifies provenance, and there is no `NPM_TOKEN` to leak.

## 0.6.0 - declarations that persist, and samples

**Floating windows and state persistence are declarations.** `window()` compiles a second
page into its own subpatcher. `state()` + `useStateSync()` give a `useState`-shaped binding
to arbitrary JSON saved inside the Live set, per instance.

Two bugs had made both useless. **State was never saving into the set** - `parameter_enable`
is what a `[pattr]` needs, and `@save` / `@autorestore` are not it. And a window or state
selector carried its id inside the selector word, where Max dispatched it to a handler no
device had.

**The `samples` chain:** a named `[buffer~]` per slot, previewed through the track, plus the
path resolution that lets `[buffer~]` open the file the download just wrote. A bare name
goes to Max's search path, which the device folder is not in.

**Fetch-to-disk hardened:** the last `[node.script]` is gone, and a 404 can no longer
destroy a cached file. Every fetch downloads to a `.part`, validates status, error and byte
count, and only then asks `[maxurl]` to copy it into place. The shipped wrapper is now
tested against a fake Max - the `[maxurl]` simulator encodes what Max was measured to do -
so the orchestration is pinned even where Live's behaviour cannot be.

## 0.5.0 - composable audio chains

**Audio chains stack.** `chains: ["lowpass", "drive", "gain"]` is a series -
`plugin~ -> onepole~ -> overdrive~ -> *~ -> plugout~` - and **the order of the list is the
signal path**. Confirmed by ear, in Live.

Before this, they did not stack. They **mixed**, silently. Every audio chain created its
own `plugin~` and `plugout~` and wired itself between them, so two chains were two devices
fighting over one patcher: duplicate box ids, and the dry signal summed back over the wet
one. No error at build time, none in Live. The device just sounded wrong in a way you would
blame on your own DSP.

The endpoints now belong to the **device**, created once by the build for any `audio` or
`instrument` type, and a chain claims one **stage** between them. It is the twin of
`claimAppMessages()`: one stream, several claimants, chained in series with an explicit
hand-off rather than hung off the source in parallel.

New chain: **`drive`** (`overdrive~`, soft-clipping distortion, 1 = clean to 10 = filthy).
It is in the vocabulary for testability as much as for sound. `lowpass` and `gain` are both
linear and therefore commute, so a composition built only from those two sounds identical
whichever way round it goes, and cannot be checked by ear.

### Breaking

**A chain must not create `plugin~` / `plugout~`.** Take the stage before you and hand
yours on:

```js
const [srcId, srcOutlet] = ctx.audioIn(channel);   // whatever the last stage left
// ...create your DSP, wire srcId -> yours...
ctx.setAudioOut(channel, myId, 0);                 // you are the tail now
```

A chain that still creates the endpoints now **fails the build**. A second box with an
existing id throws (`assertUniqueBoxIds()`), because a patcher with two boxes sharing an id
is one Max resolves however it likes. That guard is the error message this bug never had.

**An audio chain on a `type: "midi"` device fails the build** too, instead of conjuring
endpoints and quietly making the device something the manifest never declared.

### Also

- **`composePatcher()`** is exported from `@m4l-jweb/build`: the build's own per-device
  pipeline (endpoints, chains, surface, close, validate), so a test can generate a patcher
  exactly as the build does rather than re-implementing the order of its steps.
- **A chain takes a parameter in real units and does no arithmetic on it.** The range, the
  unit and the curve live on the parameter (`range: [40, 18000]`, `unit: "Hz"`,
  `exponent`). A chain that re-introduces an `[expr]` mapping double-maps a parameter that
  already carries its own curve.
- **`hello-audio` is now three chains** (`lowpass`, `drive`, `gain`), and
  **`hello-audio-rev`** is the same app and the same parameters in the opposite order. The
  pair is what proves the series is real.

## 0.4.0 - the Surface

A device's Live parameters are declared **once**, in `src/app/<device>/surface.ts`, and
everything else is generated from that declaration: the `live.*` objects, their patcher
wiring in both directions, the protocol selectors the lint checks, and a typed React
binding. See [doc/ARCHITECTURE.md](doc/ARCHITECTURE.md).

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

**1. `parameters` is gone from `patcher/devices.mjs`.** Declare them in `surface.ts`. The
build **fails** on a leftover `parameters` field rather than ignoring it - a silently
dropped parameter is a device whose knobs vanished.

**2. A custom chain must claim the app's messages with `claimAppMessages()`.** Routes are
chained in **series**, each handing its unmatched outlet to the next
(`[jweb] -> [route midinote flush] -> [route set_*] -> [js]`). Two routes hanging off
`[jweb]` in parallel each pass the unrouted messages on, so the wrapper sees every
`ui_ready` twice. If your chain does this:

```js
removeLine(lines, jwebId, unmatchedId);
lines.push(line(jwebId, 0, "obj-my-route", 0));
lines.push(line("obj-my-route", 2, unmatchedId, 0)); // unmatched carries on
```

replace all three lines with:

```js
claimAppMessages(ctx, "obj-my-route", 2); // ctx, the route's id, its unmatched outlet
```

The build **fails** if a chain cut `[jweb]`'s cord without saying where the messages went.
A chain that never touched that cord - it only taps `[jweb]`'s outlet in parallel - needs
no change.

> Do **not** find the cord to cut by searching for whatever feeds `[js]`.
> `live.thisdevice` feeds it too, and cutting that cord kills every LiveAPI observer in the
> device, silently.

**3. A parameter's selectors must not be re-declared in `protocol.ts`.** `<id>` and
`set_<id>` are generated, and the lint fails if a device also names them by hand. Bind them
with `useParam()`, which derives both from the declaration.

**4. A chain that drives DSP from a parameter reads it from the surface.** `lowpass` needs
a `cutoff`, `gain` needs a `gain`, and the build fails with a clear message if the device's
`surface.ts` does not declare it. Wire a parameter into DSP only via `fanParamInto()`,
which wires the object's outlet **and** the route's, or neither. `set` silences a `live.*`
object's outlet for everyone, including whatever it drives inside the patcher.

### Fixed - three bugs that were silent in Live

- **A range was written to a key Max ignores.** `parameter_range` is not what Max uses for
  a continuous parameter - it appears in none of the patchers Ableton ships. The range is
  `parameter_mmin` / `parameter_mmax`. Every declared range was quietly discarded and the
  object kept its default.
- **A float parameter was printed as an integer.** With no `parameter_unitstyle`, Live
  rounds the readout: a smooth 0-1 cutoff reads "0" or "1" on a Push. Declare `unit`
  (`"Hz"`, `"dB"`, `"ms"`, `"%"`, `"st"`, or any custom string) and put the range in real
  units, with `exponent` for the knob's curve.
- **`live.thisdevice`'s cord could be cut** by the Surface interposing its route, which
  would kill every LiveAPI observer in the device. Routes now hand off explicitly.

### Added

- `@m4l-jweb/surface/react` - `useParam()`, `useSurface()`.
- `@m4l-jweb/surface/store` - the same state with no React in it.
- The dev harness renders the **parameter panel** and a **Push preview** from the
  declaration.
- `esbuild` is now a dependency of `@m4l-jweb/build`. It bundles `surface.ts`, which is
  TypeScript importing TypeScript, so Node can import it at build time.

### Not in this release

**Push banks** were deferred. They needed patcher-JSON archaeology and blocked nothing,
since Live falls back to declaration order. **They shipped in 0.7.0**: `banks` in the
surface declaration are emitted as `parameterbanks` in the patcher-level registry, so a
Push page turn lands on the group you declared.
