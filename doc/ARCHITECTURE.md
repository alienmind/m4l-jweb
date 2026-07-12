# M4L-JWEB: architecture

*How the whole thing actually works: the two escape hatches Max leaves open, the
message protocol between the layers, the generated patchers, the headless
`.amxd` writer, Push support, and where the project is going next.*

*New here? Start with the [README](../README.md) - it covers requirements,
install and the quick start. This document is the part after "yes, but how".*

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
events out) and you barely depend on timers at all. See `src/app/worker.ts`.

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

Keep every selector in `src/app/protocol.ts` so both sides agree and CI can lint
them.

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

## What about Push?

A question every device author hits: "will my UI show on Push?" The honest
answer: **no custom UI reaches Push - not yours, not anyone's.** Push's display
renders the device's **parameters**, organized in banks of eight, for native
devices and M4L devices alike.

So Push support is not about the UI technology at all; jweb changes nothing
here. It is about exposing your musically meaningful controls as real Live
parameters:

- Add `live.dial` / `live.toggle` / `live.menu` objects with `parameter_enable`
  on; give them short names and sensible ranges.
- Wire them into the same message protocol your UI uses (a parameter change is
  just another inlet message to your app; a UI change can set the parameter so
  the two stay in sync).
- Group them into banks with the device's parameter info so Push pages read like
  a performance surface: pattern slot, density, octave, run/stop.

The resulting split is actually good design: the jweb UI is your deep editor on
the laptop screen; the parameter bank is the performance surface on Push,
automatable and MIDI-mappable for free. The manifest's `parameters` section
generates the objects and their patcher wiring.

## The packages

The infrastructure is carved into three packages, so a device repo is only the
parts that are actually about *your* device.

| Package | What it is |
|---|---|
| **`@m4l-jweb/bridge`** | Browser, zero deps. Typed `bindInlet`/`outlet`, the `uiReady()` handshake, base64 helpers, and the `maxSimulate` dev shim that lets the same code run in a plain browser. |
| **`@m4l-jweb/wrapper`** | The `[js]` glue in TypeScript: payload extraction, lifecycle, LiveAPI helpers (transport poll, tempo/property observers, clip I/O). Shipped as **sources, not a library** - `[js]` has no module system, so the build compiles them as one program and concatenates the output. |
| **`@m4l-jweb/build`** | The Node CLI (`m4l-jweb`): the binary `.amxd` writer, the `box()`/`line()` patcher DSL and chain vocabulary, payload embedding, build stamps, the ES5 gate, installer templates. |

## Repo layout

```
m4l-jweb/
  src/
    app/                  # the ONLY folder a device author edits
      App.tsx             # the jweb UI (React)
      protocol.ts         # selector names + payload types
      worker.ts           # optional compute worker (inlined automatically)
  patcher/devices.mjs     # the declarative manifest (see below)
  wrapper/device.ts       # OPTIONAL: extra [js] handlers, concatenated last

  packages/
    bridge/src/index.ts   # @m4l-jweb/bridge
    wrapper/src/
      core.ts             # lifecycle, the anything() guard, payload extraction
      liveapi.ts          # transport, observers, clip I/O
      max.d.ts            # ambient types for post/outlet/LiveAPI/Task/File
    build/
      bin/m4l-jweb.mjs    # the CLI
      src/amxd.mjs        # the headless .amxd container writer
      src/chains.mjs      # box()/line() DSL + chain vocabulary
      src/index.mjs       # wrapper -> patchers -> package
      templates/          # base.json + installers
      tests/amxd.test.mjs # container round-trip + ES5 gate

  tests/protocol.test.mjs # every selector is routed on the Max side
  examples/transposer     # hello world: one-knob MIDI transposer, ~50 lines
  CLAUDE.md               # agent guardrails
```

A device repo owns exactly two files' worth of decisions: `src/app/` and
`patcher/devices.mjs`. Two escape hatches exist for when that is not enough:
`patcher/base.json` overrides the patcher template, and `wrapper/device.ts` adds
your own `[js]` message handlers.

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
| `midiin` | `midiin` -> `midiparse` -> the app, as `notein <pitch> <velocity>`. Also cuts the template's direct MIDI thru cord so a device that transforms notes does not also leak the untransformed ones. |
| `midiout` | The app emits `midinote <pitch> <vel> <durMs> <chan> <delayMs>`; `pipe` + `makenote` + `midiformat` place it precisely and handle note-offs. |
| `passthrough` | `plugin~` -> `plugout~`, an audio effect that passes its input through untouched. |

Add your own next to them. Keep them small and named after what they do.

## The build pipeline

`pnpm build` is `tsc -b && vite build && m4l-jweb build`. Bundling the UI is the
app's business and stays in the repo's own scripts; everything Max-shaped is the
CLI:

| Step | Command | What happens |
|---|---|---|
| 1 | `tsc -b` | Typecheck the app. |
| 2 | `vite build` | Bundle the UI into ONE self-contained `index.html`. |
| 3 | `m4l-jweb wrapper` | Compile `core.ts` + `liveapi.ts` (+ your `wrapper/device.ts`) as one TS program, concatenate to a single ES5 script, prove it with acorn. |
| 4 | `m4l-jweb patchers` | Manifest -> one patcher JSON per device. |
| 5 | `m4l-jweb package` | Write each `.amxd`, embedding the UI as a base64 payload in the wrapper, then the release zip and installers. |

Each is independently runnable. `m4l-jweb build` is 3 + 4 + 5.

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
4. Every selector in `protocol.ts` appears in a route or handler on the
   patcher/wrapper side.
5. No `[node.script]` in the default template.

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
them like any other dependency. What is left:

- **`@m4l-jweb/surface`** - the component model and the mocked-Live dev harness
  described above. The biggest single win left in the project; see
  [SURFACE.md](SURFACE.md).
- **Publish the packages to npm.** They are workspace-local today, so
  `create-m4l-jweb` (scaffold a device repo without cloning this one) is the
  natural next step.
- **Grow the chain vocabulary.** `poly~` voice bank (instrument devices) and
  `plugin~ -> DSP -> plugout~` (audio effects that actually do something) are the
  obvious gaps.
- **Port a real device onto the template** as the proof. The pattern came out of
  a working Strudel device; folding that back onto the extracted packages is what
  will find the leaks.
- **Verify below Live 12.** `[jweb]` dates to Max 8, so Live 10/11 *should* work.
  Nobody has checked.


---

## License

MIT.
