# M4L-JWEB: architecture

*The mechanics: the two escape hatches Max leaves open, the message protocol
between the layers, the generated patchers, the headless `.amxd` writer, the
parameter surface Push reads, and the invariants CI enforces.*

**Read the [README](../README.md) first.** It covers what this is, what it costs
you to build and run, why Max for Live development normally hurts, and a tutorial
for defining a device. This document is the part after *"yes, but how"* - it
assumes all of that and does not repeat it.

---

## The idea

M4L-JWEB starts from one observation: Max ships two escape hatches, and together
they cover almost everything a device needs.

- **`[jweb]`** is a full Chromium browser view embedded in the device. It runs
  anything the web runs: React, canvas, WebAssembly, Web Workers.
- **`[js]`** is old, but it holds LiveAPI, and it always runs - even inside a
  frozen device.

So the architecture splits a device into three layers, each written as ordinary
text in an ordinary repo:

```
        your repo (TypeScript, JSON, scripts - all reviewable)
  +----------------------------------------------------+
  |  UI + logic:  web app (+ optional Web Worker)       |
  |  Live glue:   wrapper script for [js] (LiveAPI)     |
  |  Structure:   patcher template + device manifest    |
  +-------------------+--------------------------------+
                      |  one build command (no Max, CI-friendly)
                      v
              installable .amxd file(s)
```

Five patterns make it work.

**1. The UI is a web app.** One page, bundled into a single self-contained html
file (every script, style and asset inlined). jweb exposes a two-call bridge to
the page: `window.max.bindInlet(name, handler)` to receive Max messages,
`window.max.outlet(...)` to send them. That is the entire API surface between
your app and the device. Outside Max, a dev shim simulates the bridge so you
develop in a normal browser with hot reload. See `@m4l-jweb/bridge`.

**2. Heavy logic runs in a Web Worker.** Sequencers, analyzers, anything that
must not fight the UI thread. Dedicated workers are also exempt from the timer
throttling Chromium applies to hidden pages - relevant, because your device's
view is often not visible. Design message-driven (Live pushes time in, you push
events out) and you barely depend on timers at all. See `src/app/shared/worker.ts`.

**3. The `[js]` glue stays thin - and you write it in TypeScript.** One file
(`wrapper/wrapper.ts`) owns everything that needs LiveAPI: reading and writing
clips, observing properties, polling transport. It compiles with `tsc` targeting
ES5, and the build refuses to package it if the output does not parse as ES5
(one stray modern token kills the whole script at load, with a one-line error
and no stack). The constraints that remain are runtime, not syntax: no
`setTimeout` (use Max's `Task`), no `console` (use `post()`), no module system
(bundle to one file), and a handful of LiveAPI lifecycle rules covered below.

**4. Patchers are generated, not drawn.** A patcher is just JSON: `boxes`
(objects, e.g. `"route noteevent stop"`) and `lines` (cords, e.g. source
box/outlet to destination box/inlet). M4L-JWEB keeps a minimal hand-made
template (`patcher/base.json`) and generates each device variant from a
declarative manifest (`patcher/devices.mjs`) - device type, chains, routing -
via `box()`/`line()` helpers. Patch cords become code review.

**5. The `.amxd` container is written headless.** The container format is
undocumented but simple, reverse-engineered from devices saved by Max 8/9: a
header carrying the device-type tag, a chunk with the patcher JSON and each
embedded dependency, and a directory of name/size/offset entries. About 150
lines of Buffer code write it byte-for-byte (`packages/build/src/amxd.mjs`). This is
the piece that removes Max from the loop entirely: `pnpm build` on a CI runner
emits installable devices.

One supporting trick holds it together: **self-extracting payloads**. Because
Chromium cannot read Max's frozen virtual filesystem, the build appends the UI
html to the wrapper script as base64. On first load the wrapper - which always
runs - writes the real file next to the `.amxd`, stamps it with the build id,
and points jweb at a cache-busted `file://` URL. Stale or mixed installs become
structurally impossible: the UI and the wrapper each display their build stamp
and complain on mismatch.

## Talking to Live: the protocol

Everything between the layers crosses as **Max messages**: a selector word
followed by arguments (`noteevent 60 96 480 1 35`). Three habits keep this sane:

1. **Selectors are your routing table.** `[route sel1 sel2]` dispatches by first
   word; unmatched messages fall out of the last outlet toward the next
   consumer. One jweb outlet can feed an output chain and the LiveAPI glue at
   once.
2. **Base64 anything structured.** Max splits messages on commas and semicolons;
   encode code, JSON and paths.
3. **Handshake, never assume order.** The page loads asynchronously. Have the UI
   announce `ui_ready`; have the wrapper reply with current state (mode,
   parameters, tempo). Anything that boots late gets the same treatment.

Keep every selector in that device's `src/app/<device>/protocol.ts` so both sides
agree and CI can lint them.

### The library owns the chains' selectors

A chain in `@m4l-jweb/build` is library code - but for a long time the names for
*addressing* one were not. Every device retyped `midinote` and `notein` in its
own `protocol.ts`, and a typo produced no error anywhere: just a note that never
sounded.

So the chain contract lives in the library too. `@m4l-jweb/bridge` exports
`CHAIN_IN` and `CHAIN_OUT` - the selectors the packaged chains own - and a
device spreads them in rather than retyping them:

```ts
import { CHAIN_IN, CHAIN_OUT } from "@m4l-jweb/bridge";

export const IN  = { ...CHAIN_IN,  mode: "mode", build: "build" } as const;
export const OUT = { ...CHAIN_OUT, ui_ready: "ui_ready" } as const;
```

The name you send and the name the generated `[route]` matches now come from one
definition. On top of them sit the typed helpers - `sendNote({ pitch, velocity,
durationMs, delayMs })`, `onNote(cb)`, `flushNotes()` - because
`outlet("midinote", 60, 100, 250, 1, 0)` is five positional ints that are easy
to get subtly wrong and silent when you do.

`flushNotes()` is not an afterthought: notes are *held* by `[makenote]` on the
Max side, so a UI that stops sending without flushing leaves them sounding
forever.

### The bridge is the only channel - so tap it

There is exactly one path between the two halves of a device. That makes it the
one place worth observing: `tapMessages(fn)` sees every message crossing it, in
both directions, which is the device's entire contract, live. The dev harness
below renders it as a log; in a real device you can bind a tap from the Chromium
console.

### The lint reads the device's own Max side too

`tests/protocol.test.mjs` checks that every selector is sent, handled or routed
somewhere on the Max side. "The Max side" is four things, and a lint that reads
only some of them quietly stops checking: the packaged wrapper, the packaged
chains, **this repo's own** `patcher/chains.mjs` and `wrapper/device.ts`, and the
manifest's `parameters` - a `live.dial` reaches the UI as `<id> <value>`, so a
parameter id *is* a selector.

### Reading from Live (events in)

| You want | The M4L-JWEB way |
|---|---|
| Transport position and play state | Poll `live_set is_playing` + `current_song_time` from the wrapper on a 50 ms `Task`; emit `tick <playing> <beats>`. Prefer LiveAPI polling over `plugsync~` signal chains: MIDI-effect devices do not reliably run a DSP graph, and LiveAPI works in every device type. |
| Tempo | A LiveAPI property observer on `live_set tempo` (the signal-domain alternative reports samples-per-beat, not BPM). |
| Any observable property (scale, track name, selected scene...) | `new LiveAPI(callback, "live_set")` + `.property = "..."`; the callback fires on attach and on every change. Forward to the UI as a message. |
| Things with no observer | Poll with a `Task` and push a message only on change. |
| Device lifecycle | `live.thisdevice` fires a bang when the device is fully loaded. Do all LiveAPI bootstrapping there, never in `loadbang` (see `CLAUDE.md`). |

### Acting on Live (events out)

| You want | The M4L-JWEB way |
|---|---|
| Emit live MIDI | Message chain in the patcher: `route` -> `unpack` -> `pipe` (per-note delay for precise timing) -> `makenote` (automatic note-offs) -> `midiformat` -> `midiout`. Compute *when* in your app; let Max place it precisely. This is the `midiout` chain. |
| Create or read MIDI clips | LiveAPI from the wrapper: `clip_slots`, `create_clip`, `add_new_notes`, `get_notes_extended`. |
| Synthesize sound | Instrument device: message-driven `poly~` voices. Audio effect: `plugin~` -> your DSP -> `plugout~`. |
| Schedule against the grid | Send events ahead of time with a delay computed from the tick stream; a lookahead window absorbs jitter, `pipe` applies precision. Add a free-running fallback clock in the worker so your device also works with the transport stopped. |

### The three device types

| Type | Container tag | Sits on | I/O |
|---|---|---|---|
| MIDI effect | `mmmm` | MIDI track, before the instrument | MIDI in -> MIDI out |
| Instrument | `iiii` | MIDI track, as the instrument | MIDI in -> audio out |
| Audio effect | `aaaa` | any audio position | audio in -> audio out |

The type is one field in the device manifest; the same UI and wrapper can ship
as all three variants.

## Parameters: the surface Push reads

The README states the rule (*no custom UI reaches Push - it renders Live
parameters, in banks of eight, and nothing else*). Here is what the build
actually emits for one.

You declare a parameter **once**, in `src/app/<device>/surface.ts`:

```ts
export default defineSurface({
	params: { cutoff: dial({ range: [0, 1], default: 1, short: "Cutoff" }) },
});
```

`applySurface()` in `packages/build/src/surface.mjs` compiles it. The build
imports that file (esbuild, in milliseconds - it is TypeScript, and it imports
`@m4l-jweb/surface`), and emits a `live.*` box with `parameter_enable: 1`, wired
out to `[jweb]` through a `prepend <id>` - so a knob move arrives in your app as
just another message, `cutoff 0.42`.

| Declaration | What it becomes |
|---|---|
| `dial` / `toggle` / `menu` | `live.dial` / `live.toggle` / `live.menu` |
| the key (`cutoff`) | `parameter_longname`, and the selector the app binds |
| `short` | `parameter_shortname` - Push's label, ~8 characters |
| `range`, or `step: 1` | `parameter_range`; `parameter_type` 0 (float) or 1 (int) |
| `options` (menu) | `parameter_enum` |
| `default` | `parameter_initial` **plus** `parameter_initial_enable: 1` |

**`default` is not cosmetic, and its two attributes are a trap.** Without it a
`live.*` object loads at the *bottom* of its range - and for many parameters the
bottom of the range is a broken device (a filter cutoff of 0 loads as a device
that eats the signal, and it looks exactly like a bug in your DSP). And
`parameter_initial` without `parameter_initial_enable` is silently inert: it
stores the value and never applies it. The compiler always emits both.

### Writing a parameter from the app

Reading is the easy direction. *Writing* one - a slider in the device window that
moves the real Live parameter, so automation and Push follow - is the other half
of what the same declaration generates:

```
[jweb] -> [route set_<id>] -> [prepend set] -> [live.dial]
```

`set <value>` rather than the bare value, because feeding a value into a
`live.dial`'s inlet **sets it and makes it output**, straight back to the app,
which may set it again: a feedback loop that with floats can oscillate rather
than settle.

**But `set` suppressing the output is not free, and this is the sharp edge.** It
silences the object for *everyone*, not just for the app - including whatever the
dial drives inside the patcher. So a parameter's consumers must **not** sit
chained behind the parameter object. The value is fanned out instead: to the dial
(so Live's automation, MIDI mapping and Push stay correct) and, in parallel,
straight to whatever the parameter actually controls. The dial's own outlet still
feeds the same destination, because that is the path a knob turn, an automation
lane or a Push encoder travels.

The `lowpass` chain is the worked example, and it had this bug: with the filter
fed from the dial's outlet, writing the parameter moved the dial and told the
filter nothing. So a chain never wires a parameter by hand - it calls
`fanParamInto()`, which wires *both* sources or neither. The fan-out is not a
thing you have to remember; it is the only thing on offer.

### What is left to build

The declaration now drives the Max side. It does not yet drive the *app* side:
`useParam()` / `useSurface()` (Stage 2.3) and the generated protocol selectors
(2.2) are still to come, so a device's `protocol.ts` still names its parameters
by hand and the app still sends `set_<id>` through the bridge itself. Push banks
need patcher-JSON archaeology and are deferred (3.3); until then Live falls back
to declaration order and Push shows every parameter. See [SURFACE.md](SURFACE.md)
for the design and [TODO.md](TODO.md) for the sequence.

## Developing without Live: the mocked harness

`pnpm dev` used to give you `window.maxSimulate()` on the console. That is a
shim, not an environment: to watch a sequencer run you typed ticks in by hand,
and to see what your device was *saying* you had nothing.

`@m4l-jweb/surface/dev` renders the other half of the device, mocked, beside the
app:

- **A transport.** Play/stop and a BPM field driving a real clock that emits
  `tick <playing> <beats>` and `tempo <bpm>` at the same 50 ms cadence the
  wrapper polls Live at. A sequencer becomes developable without a DAW.
- **A message log**, off `tapMessages` - every selector crossing the bridge, both
  directions. The best debugging tool in the stack, and nearly free.

The device keeps its **real 169 px box** in the harness, deliberately: a UI that
clips in Live must clip here too, or the harness is lying about the one
constraint that is cheapest to catch early.

**It must never ship.** `src/main.tsx` imports it behind `import.meta.env.DEV`,
which a production build replaces with the literal `false`, so rollup drops the
branch and the module with it. `tests/bundle.test.mjs` asserts the drop actually
happened - a harness shipped inside someone's `.amxd` would throw no error, it
would just sit there, in Live, in their device.

**The honest limit.** A mock is a mock. It cannot tell you about MIDI jitter,
real DSP, or LiveAPI's behaviour on a loaded set. What it gives you is the whole
*message-level* contract, exercised without Live - the part that is tedious to
test and easy to get wrong. Keep "load it in Live" for what genuinely needs Live.

## The packages

The infrastructure is carved into four packages, so a device repo is only the
parts that are actually about *your* device.

| Package | What it is |
|---|---|
| **`@m4l-jweb/bridge`** | Browser, zero deps. Typed `bindInlet`/`outlet`, the `uiReady()` handshake, the chain contract (`CHAIN_IN`/`CHAIN_OUT`, `sendNote`, `onNote`, `flushNotes`), the `tapMessages` observer, base64 helpers, and the `maxSimulate` dev shim that lets the same code run in a plain browser. |
| **`@m4l-jweb/wrapper`** | The `[js]` glue in TypeScript: payload extraction, lifecycle, LiveAPI helpers (transport poll, tempo/property observers, clip I/O). Shipped as **sources, not a library** - `[js]` has no module system, so the build compiles them as one program and concatenates the output. |
| **`@m4l-jweb/build`** | The Node CLI (`m4l-jweb`): the binary `.amxd` writer, the `box()`/`line()` patcher DSL and chain vocabulary, payload embedding, build stamps, the ES5 gate, installer templates. |
| **`@m4l-jweb/surface`** | The parameter declaration (`defineSurface`, `dial`/`toggle`/`menu`) and, at `/dev`, the mocked-Live harness. **Partial**: the declaration and its validation ship; the codegen that compiles it to `live.*` objects is Stage 2 of [TODO.md](TODO.md). |

## Repo layout

```
m4l-jweb/
  src/
    main.tsx              # the entry point, shared: imports @device/App
    app/
      hello-midi/         # ONE FOLDER PER DEVICE
        App.tsx           #   the jweb UI (React)
        protocol.ts       #   this device's selectors
        surface.ts        #   its Live parameters, declared
      hello-audio/        # ...and another device, entirely separate
      spike/              # the Stage 1 instrument (doc/SPIKES.md)
      shared/
        device.ts         # useDevice(): mode, build, tempo, transport, handshake
        Frame.tsx         # the chrome + the build-stamp footer
        worker.ts         # optional compute worker (inlined automatically)
  scripts/
    devices.mjs           # the manifest -> which UI folder belongs to which device
    dev.mjs               # pnpm dev:<device>  - run ONE device's UI
    build-ui.mjs          # one self-contained bundle per device
  patcher/devices.mjs     # the declarative manifest (see below)
  patcher/chains.mjs      # OPTIONAL: this repo's own chains
  wrapper/device.ts       # OPTIONAL: extra [js] handlers, concatenated last

  packages/
    bridge/src/index.ts   # @m4l-jweb/bridge
    surface/src/
      index.ts            # defineSurface + types + validation
      dev.tsx             # the mocked-Live harness (never shipped)
    wrapper/src/
      core.ts             # lifecycle, the anything() guard, payload extraction
      liveapi.ts          # transport, observers, clip I/O
      max.d.ts            # ambient types for post/outlet/LiveAPI/Task/File/Buffer
    build/
      bin/m4l-jweb.mjs    # the CLI
      src/amxd.mjs        # the headless .amxd container writer
      src/chains.mjs      # box()/line() DSL + chain vocabulary
      src/index.mjs       # wrapper -> patchers -> package
      templates/          # base.json + installers
      tests/amxd.test.mjs # container round-trip + ES5 gate

  tests/
    protocol.test.mjs     # every selector is routed, per device
    surface.test.mjs      # the Surface's validation rules
    bundle.test.mjs       # no harness ships, and no device ships a sibling's UI
  doc/SPIKES.md           # the three unanswered questions about Max
  CLAUDE.md               # agent guardrails
```

### One device, one bundle

Each `.amxd` embeds its **own** UI bundle, so a device ships what it *is*, not
what its siblings are: `hello-midi` carries no filter code, `hello-audio` no
sequencer.

`src/main.tsx` is shared and contains no branching. It imports `@device/App`, an
alias that `vite.config.ts` rebinds per build to `src/app/<device>/`.

Two details that will bite anyone changing this:

- **The vite config is a factory, not an object.** `scripts/build-ui.mjs` sets
  `DEVICE` and calls vite's `build()` once per device *in one process*. A
  top-level `const DEVICE = process.env.DEVICE` would be evaluated once, at first
  module load, and every device after the first would be built from the first
  one's sources.
- **`DEVICE` is an env var, not vite's `--mode`.** `--mode` also flips
  `import.meta.env.DEV`, and a build with `DEV=true` would ship the dev harness
  inside the device.

The payload name is per-device too (`<device>.html`, not a shared `ui.html`).
Every device in a repo extracts its payload into the *same* folder - next to the
`.amxd` - so one shared name would mean two devices overwriting each other's UI on
every load, each convinced the file on disk was stale. The symptom would be a
device showing its sibling's interface.

A device repo owns two files' worth of decisions: `src/app/<device>/` and
`patcher/devices.mjs`. Three escape hatches exist for when that is not enough:
`patcher/base.json` overrides the patcher template, `patcher/chains.mjs` adds your
own chains (importing it is enough - `registerChain()` mutates the shared
vocabulary), and `wrapper/device.ts` adds your own `[js]` message handlers.

## The manifest

`patcher/devices.mjs` is the declarative description of every device the build
produces:

```js
export default [
	{
		name: "my-device-midi",
		type: "midi",                    // midi | audio | instrument
		chains: ["midiin", "midiout"],   // canned chain vocabulary
		parameters: [                    // Push-visible, automatable
			{ id: "density", object: "live.dial", range: [0, 1] },
			{ id: "running", object: "live.toggle" },
		],
		unmatchedTo: "js",
	},
];
```

The chain vocabulary lives in `packages/build/src/chains.mjs`; each chain is a
small function that adds boxes and cords. Shipped today:

| Chain | What it wires |
|---|---|
| `midiin` | `midiin` -> `midiparse` -> the app, as `notein <pitch> <velocity>` (`onNote`). Also cuts the template's direct MIDI thru cord so a device that transforms notes does not also leak the untransformed ones. |
| `midiout` | The app emits `midinote <pitch> <vel> <durMs> <chan> <delayMs>` (`sendNote`) and `flush` (`flushNotes`); `pipe` + `makenote` + `midiformat` place it precisely and handle note-offs. |
| `passthrough` | `plugin~` -> `plugout~`. A straight wire: it does **nothing** to the audio. A scaffold proving the container builds, not a feature. |
| `gain` | `plugin~` -> `*~` -> `plugout~`, with a Live parameter on the multiplier. The smallest audio effect that does something. |
| `lowpass` | `plugin~` -> `onepole~` -> `plugout~`, with a Cutoff parameter mapped logarithmically to 40 Hz - 18 kHz. Audible: sweep it and the top end goes. |

Note what the audio chains do **not** do: the parameter is wired straight into the
signal object, in the patcher. It does not travel through `[jweb]` and back, so
the audio path never depends on the browser being alive or keeping up. The app
receives its own copy purely to *display*. Audio is Max's job; the UI is a view
of it - and that is the general rule, not a detail of these two chains.

Add your own next to them, either in the library or in your repo's
`patcher/chains.mjs`. Keep them small and named after what they do. If a chain
owns a selector, put its name in `CHAIN_IN`/`CHAIN_OUT` so devices spread it in
rather than retyping it.

## The build pipeline

`pnpm build` is `tsc -b && node scripts/build-ui.mjs && m4l-jweb build`. Bundling
the UI is the app's business and stays in the repo's own scripts; everything
Max-shaped is the CLI:

| Step | Command | What happens |
|---|---|---|
| 1 | `tsc -b` | Typecheck every device's app. |
| 2 | `scripts/build-ui.mjs` | One self-contained bundle **per device** -> `dist/ui/<device>/index.html`. |
| 3 | `m4l-jweb wrapper` | Compile `core.ts` + `liveapi.ts` (+ your `wrapper/device.ts`) as one TS program, concatenate to a single ES5 script, prove it with acorn. |
| 4 | `m4l-jweb patchers` | Manifest -> one patcher JSON per device. |
| 5 | `m4l-jweb package` | Write each `.amxd`, embedding **that device's** UI as a base64 payload in the wrapper, then the release zip and installers. |

Steps 3-5 are `m4l-jweb build`, and each is independently runnable. The wrapper
(step 3) is compiled once and shared by every device - it is the payload appended
to it that differs.

## CI invariants

The build is the test suite. These hold, and are what let an agent work here
unattended:

1. `pnpm build` produces every `.amxd` with no Max installed.
2. The wrapper parses at `ecmaVersion: 5` or the build fails - twice: once on the
   concatenated output, and again inside the container writer on the exact bytes
   that ship.
3. The built container round-trips: a test parses the `.amxd` and asserts the
   patcher JSON, the directory entries, the payload sizes and offsets, and that
   the embedded UI decodes back to the bytes that went in.
4. **Every selector is routed, per device.** Each device's `protocol.ts` is linted
   against *its own* Max side - the packaged wrapper and chains, this repo's
   `patcher/chains.mjs` and `wrapper/device.ts`, its manifest parameter ids, and
   the **generated patcher**. That last source matters: a chain that builds its
   route dynamically has no literal `route set_cutoff` in its source, so a lint
   reading only the source would call a perfectly-routed selector unrouted. The
   artifact is the truth.
5. The library's chain contract (`DEVICE_IN`/`CHAIN_IN`/`CHAIN_OUT`) matches what
   the wrapper and chains actually send and route. Renaming a chain's selector
   without updating the constant would send every device that spread it into the
   void, silently.
6. Every Surface declaration validates: no bank of more than eight (Push shows
   eight and drops the rest without a word), no default outside its range, no
   parameter in two banks, no short name Push would truncate.
7. **The dev harness never reaches a shipped bundle**, and **no device ships a
   sibling's UI** - the test greps each built `<device>.html` for the others'
   markers. Both would build, install and load without complaint.
8. No `[node.script]` in the default template.

Note what unites 4-7: each is an invariant whose violation produces **no error at
runtime**. An unrouted selector is a message falling on the floor; a ninth
parameter simply never appears; a shipped harness just sits there; a device
wearing its sibling's UI looks like a mystery, not a build bug. Those are exactly
the bugs worth spending a test on.

## Next: the Surface, a component model for the Max side

The Push section above ends with three manual chores: add `live.*` objects, wire
them into your protocol, group them into banks. That is the one place this
project still says "go do it by hand" - and it means the same control lives in
four places (the Max object, the patcher wiring, the protocol, the app state),
free to drift apart.

**The Surface** fixes that the way generated patchers fixed patch cords: declare
the parameters **once, as code**.

```ts
// src/app/surface.ts
export default defineSurface({
	params: {
		density: dial({ range: [0, 1], default: 0.5, short: "Dens" }),
		running: toggle({ default: false, short: "Run" }),
	},
	banks: [{ name: "Perform", params: ["density", "running"] }],
});
```

From that one declaration the build derives the `live.*` objects, their wiring in
both directions, the Push bank layout, the protocol selectors, and a typed React
hook:

```tsx
const [density, setDensity] = useParam(surface, "density");
```

`useParam` is a two-way binding to a **real Live parameter**. Turn the Push
encoder and React state moves; drag the React slider and the Live parameter moves
- so it is automatable and MIDI-mappable for free.

A device then has two surfaces, both from one source: the **parameter surface**
(the only thing Push can see) and the **web UI** (the deep editor on the laptop).
And because the build now knows what the Max side *is*, `pnpm dev` can render a
**mocked Live** beside your app - transport, the parameter panel, a Push preview
showing exactly what the hardware will show, and a log of every message crossing
the bridge. Both halves of the device, in a browser, with hot reload.

This is a component model in the React sense - declarative, composable, code, not
pixels - that compiles to Max objects instead of DOM.

**Not implemented yet.** The full design, including the feedback-loop trap that
makes the naive wiring oscillate, is specified in
**[SURFACE.md](SURFACE.md)**.

## Roadmap

The library carve-out described above is **done**: bridge, wrapper and build are
separate packages in a pnpm workspace, and the device repo at the root consumes
them like any other dependency.

**The sequenced plan lives in [TODO.md](TODO.md)** - what to build, in what
order, and which unknowns are gated behind a spike first.

**Stage 0 is done** (this section, the two above it, and the chain contract): the
message tap and the mocked-Live harness, the MIDI contract promoted into
`@m4l-jweb/bridge`, and `defineSurface()`'s declaration and types.

**Stage 1 is built but not run, and it is the next thing to do.** Three questions
about Max's actual behaviour gate everything after it - `[buffer~]` driven from
`[js]`, whether a `set`-written parameter still reaches the automation lane, and
which HTTP object downloads to disk inside Live. The apparatus ships as the
`spike` device; the procedure and the results table are in
**[SPIKES.md](SPIKES.md)**. Nothing downstream should be built until those rows
are filled in.

In outline, what remains:

- **The Surface codegen.** The declaration ships; compiling it into `live.*`
  objects and wiring does not. The biggest single win left; see
  [SURFACE.md](SURFACE.md).
- **A fetch-to-disk primitive that eliminates `[node.script]`** - lets any device
  pull a real file from the internet through Max-native objects alone.
- **`buffer~`/`poly~` sample playback** - instrument devices, and the route to the
  first M4L-JWEB device that makes sound from samples.
- **Push banks.** Needs patcher-JSON archaeology. Parameters reach Push without
  them; banks make the pages read like a performance surface.
- **Port a real device onto the template** as the proof. The pattern came out of
  a working Strudel device; folding that back onto the packages is what will find
  the leaks.
- **Verify below Live 12.** `[jweb]` dates to Max 8, so Live 10/11 *should* work.
  Nobody has checked.

Done: the packages on npm, `m4l-jweb init` (with a drift test), one bundle per
device, the mocked-Live harness, the library-owned selector contracts, an audio
effect that is audible (`lowpass`), and a parameter the app can write. See the
DONE section at the bottom of [TODO.md](TODO.md).


---

## License

MIT.
