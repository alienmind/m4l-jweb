# Porting to VST3: an assessment

*Can this architecture leave Max for Live and become a plugin that runs in every
DAW? Yes - and the parts that survive are not the ones you would guess. This
document is the honest accounting: what ports unchanged, what has to be rewritten
in a compiled language, what is lost outright, and what it would cost.*

**Read [ARCHITECTURE.md](ARCHITECTURE.md) first.** This assumes the five patterns
it describes and does not re-explain them.

---

## The verdict, up front

**Portable, and worth doing - as a second backend, not a migration.** The idea at
the centre of M4L-JWEB is host-agnostic:

> Declare the device once, in TypeScript. Generate the host side from the
> declaration. Run the UI as a web app, in a browser, against a mocked host.

Nothing in that sentence mentions Max. `surface.ts`, `protocol.ts`, `App.tsx`,
the bridge, the dev harness and most of the test suite describe *a plugin*, not a
`.amxd`. A VST3 backend reuses them.

What does **not** port is the layer underneath, and it is the layer that carries
this project's single most valuable property:

> **`pnpm build` produces installable devices on a machine that has never had Max
> on it.**

Max's runtime is *already installed on the user's machine*. That is the only
reason a headless build works: we ship a text patcher and a JS wrapper into a
container, and Ableton supplies the engine that runs them. A VST3 has no engine
waiting for it. **The plugin *is* the engine**, so it has to be compiled - which
means a C++ (or Rust) toolchain, a cross-platform build matrix, code signing, and
notarization on macOS. You trade "no compiler in the loop" for a real one.

That is not a reason to say no. It is the thing to be clear-eyed about, because
every other trade in this document goes the other way.

---

## Layer by layer

| Layer | In M4L-JWEB | In a VST3 | Verdict |
|---|---|---|---|
| **The app** (`App.tsx`) | React in `[jweb]` (Chromium) | React in a WebView (WebView2 / WKWebView) | **Ports, often unchanged** |
| **The bridge** (`@m4l-jweb/bridge`) | `window.max.bindInlet` / `outlet` | The host framework's JS bridge | **Ports** behind a transport seam |
| **The protocol** (`protocol.ts`) | Selectors + the routing lint | Same selectors, same lint, different Max-side reader | **Ports** |
| **The surface** (`surface.ts`) | Compiles to `live.*` objects | Compiles to VST3 parameters | **Ports, and improves** |
| **The dev harness** | Mocked Live in a browser | Mocked *host* in a browser | **Ports; barely changes** |
| **The worker** | Web Worker for heavy compute | Same | **Ports** |
| **The wrapper** (`[js]` + LiveAPI) | Clips, scenes, tracks, transport | **There is no LiveAPI** | **Does not port** |
| **The chains** (`midiout`, `lowpass`) | Max objects and patch cords | Your own DSP and scheduler, in C++ | **Rewritten, not ported** |
| **The container writer** (`amxd.mjs`) | 150 lines of `Buffer` | A `.vst3` bundle around a **compiled binary** | **Concept ports, the trick does not** |
| **The ES5 gate** | acorn at `ecmaVersion: 5` | - | **Gone. Good riddance.** |
| **The payload hack** | UI base64'd into the wrapper, extracted on load | A WebView reads `Resources/ui.html` directly | **Gone. Also good riddance.** |

Two of the ugliest things in this repo - the ES5 straitjacket and the
self-extracting payload - exist purely because of Max, and both evaporate.

---

## What ports, and why it is more than it looks

### The app, sometimes literally unchanged

This is the claim worth checking hardest, so here it is concretely. `hello-midi`
computes its notes on a transport tick and sends them ahead with a delay:

```tsx
const device = useDevice((playing, beats) => {
  // which pulses fall inside this slice of musical time?
  sendNote({ pitch: 60, velocity: 100, durationMs: 120, delayMs: 80 });
});
```

The M4L side of that is: the wrapper polls Live at 20 Hz, emits `tick <playing>
<beats>`, and `[pipe]` + `[makenote]` place the note on Max's scheduler at
`delayMs` in the future.

The VST3 side of it is: the processor reads `ProcessContext` every audio block
(tempo, `projectTimeMusic` in quarter notes, the playing flag), emits `tick
<playing> <beats>` to the WebView at the same 20 Hz cadence, and places incoming
notes into an event queue keyed by sample offset.

**The app cannot tell the difference.** The lookahead-plus-delay design was forced
on us by Max - the UI thread cannot be trusted with musical timing - and it turns
out to be exactly the design a plugin needs, for exactly the same reason. So the
`sendNote({ delayMs })` contract is not a Max detail that has to be unwound. It is
the port's foundation, already built.

What has to be written on the other side is a `[pipe]` and a `[makenote]`: a
sorted queue of pending events, and note-off bookkeeping so a held note is
released. Call it 150 lines of C++. `flushNotes()` remains the thing that stops
every note when the device stops, and it remains not optional.

### The surface, which gets *better*

`defineSurface()` was designed against Live's parameter model, and Live's
parameter model is a superset of nothing in particular - but VST3's is a genuinely
close cousin:

| `surface.ts` | Max | VST3 |
|---|---|---|
| `dial({ range, unit })` | `live.dial` + `parameter_mmin`/`mmax` + `parameter_unitstyle` | `RangeParameter`, `toPlain`/`toNormalized`, `getParamStringByValue` |
| `dial({ step: 1 })` | `parameter_type: 1` | `stepCount = max - min` |
| `dial({ exponent })` | `parameter_exponent` | your own taper in `toPlain` |
| `toggle()` | `live.toggle` | `stepCount = 1` |
| `menu({ options })` | `parameter_enum` | `StringListParameter` |
| `default` | `parameter_initial` **+** `parameter_initial_enable` | `defaultNormalizedValue` (one field, and it works) |
| `short` | `parameter_shortname` | `shortTitle` |

Every trap this repo has already paid for is either absent in VST3 or has a
one-field answer. The compiler in `packages/build/src/surface.mjs` is ~300 lines
of patcher JSON; the VST3 equivalent emits a C++ header from the same
`loadSurface()` output. That is the cheapest and highest-value part of the whole
port.

**But VST3 has its own version of the `set` trap, and it is just as sharp.** In
Max, a bare value into a `live.dial` echoes back at the app, so we send `set` -
which then silences the object for everyone, so we fan out. In VST3, a parameter
written *from the editor* must be wrapped in a gesture:
`beginEdit` / `performEdit` / `endEdit`. Skip the gestures and the parameter still
moves, the DSP still hears it, the UI still looks right - **and the host records
no automation**. Same failure signature: correct-looking device, silently missing
half its contract, no error anywhere. It belongs in the generated write path, so
that (like `fanParamInto()`) it is the only thing on offer.

**And one trap that is worse than anything in Max: parameter IDs are permanent.**
A VST3 parameter is addressed by a `uint32` ID, and a saved project stores
automation against it. Derive IDs from declaration order and inserting a
parameter in the middle of `surface.ts` silently re-points every automation lane
in every project a user has already saved. **Hash the ID from the parameter's
key** (the string, not the index), pin the hashes in a test, and treat a changed
hash as a breaking change. This is the VST3 equivalent of "Live embeds a copy of
the device in the set", except the damage lands in *someone else's* project file.

### The dev harness, which barely notices

`@m4l-jweb/surface/dev` mocks a transport, renders the parameters, and logs every
message crossing the bridge. Read its source and notice how little of it is about
Live: the transport emits `tick` and `tempo`, and those are host concepts, not
Ableton concepts. Rename the panel and it is a mocked *plugin host*. The Push
preview is the one genuinely Live-specific piece, and it is not built yet anyway.

The 169 px height constraint disappears - a plugin editor is whatever size you
declare, and can be resizable. That is a constraint being lifted, so nothing
breaks; the harness just stops enforcing a rule that no longer exists.

### The protocol lint, with one new reader

`tests/protocol.test.mjs` asserts that every selector is *handled somewhere on the
Max side*, because an unrouted selector produces no runtime error. That invariant
is not about Max. It is about message passing, and a VST3 with a WebView is
message passing. The lint keeps its shape; what changes is what it reads - a
generated C++ dispatch table instead of a generated patcher. Generate the
dispatch table from `protocol.ts` and the lint becomes structurally unnecessary,
which is even better.

---

## What does not port

### LiveAPI. All of it.

This is the hard boundary, and no amount of engineering moves it.

| The wrapper does | VST3 offers |
|---|---|
| Read and write **clips** (`create_clip`, `add_new_notes`, `get_notes_extended`) | nothing |
| Enumerate **tracks, scenes, devices** | nothing |
| Observe **any** Live property (scale, track name, selected scene) | nothing |
| Launch clips, arm tracks, drive the session | nothing |
| Read transport position and tempo | **`ProcessContext`** - and it is *better* |
| Know the device's own position in the chain | nothing |

A plugin is a black box that receives audio and events and returns audio and
events. It has no view of the session that contains it. So:

- **Devices that read tempo/transport and make MIDI or audio: port cleanly.** Both
  `hello-midi` and `hello-audio` are in this class.
- **Devices that manipulate the Live set: cannot exist as a VST3.** A device that
  writes a generated pattern into a clip slot, or follows the selected scene, or
  reads the track's name, is a Max for Live device *by definition*. There is no
  port; there is only a different product.

That is the line to draw before writing any code, because it decides whether this
is worth doing at all. If the devices you actually want to build live on the
right side of it, the port is a research project with no payoff.

The consolation is real, though: `ProcessContext` gives you tempo, time signature,
bar position and musical time **per audio block**, sample-accurate, on the audio
thread. The 20 Hz `Task` poll that this repo had to reverse-engineer (because
`plugsync~` reads zero in a MIDI effect) is replaced by a field in a struct that
the host is *required* to fill in.

### Max's object library, and its scheduler

`[onepole~]`, `[makenote]`, `[pipe]`, `[poly~]`, `[buffer~]` - forty years of DSP
and scheduling, free, and gone. In a VST3 you write the filter. The `lowpass`
chain becomes a one-pole filter in the processor (ten lines, honestly) and the
`midiout` chain becomes the event queue described above (a hundred and fifty).

The *chain vocabulary* survives as an idea - a named, reusable capability a device
opts into in `patcher/devices.mjs` - but a chain stops emitting patcher boxes and
starts selecting compiled DSP components. For the two chains this repo ships, that
is a fair trade. For a device that wanted `poly~` and `buffer~`, it is a
substantial DSP project that Max was handing over for free.

### The headless container writer

`amxd.mjs` writes a `.amxd` byte-for-byte because a `.amxd` is a header, some
JSON, and a directory. A `.vst3` is *also* a straightforward container - it is a
bundle directory (`Contents/x86_64-win/Foo.vst3`, plus `moduleinfo.json`, plus
`Resources/`), and Node can assemble every part of it happily.

Every part except the one that matters: the binary. That needs a compiler, per
platform, and on macOS a Developer ID signature and a notarization round-trip
before Gatekeeper will let a user load it. CI can do all of this - it is
completely standard - but "clone the repo, `pnpm install`, `pnpm build`, get an
artifact" becomes "clone the repo, install a toolchain, wait".

---

## Licensing: read this before you write code

**The VST3 SDK is dual-licensed: GPLv3, or Steinberg's proprietary agreement.**
This repo is MIT. Those do not compose silently - a VST3 you ship, built against
the SDK, inherits one of those two obligations. Neither is a blocker; both are a
*decision*, and it belongs at the start rather than after the plugin works.

The escape route worth knowing about is **CLAP**, which is MIT, has no such
condition, and is a cleaner API in most respects. But CLAP support is not
universal - notably, Ableton Live does not host CLAP - so a CLAP-only plugin
reaches fewer users than the `.amxd` we already ship. The usual answer is to
build against CLAP and export a VST3 with a wrapper, which gets you both formats
but does *not* dissolve the SDK question for the VST3 artifact.

**Do not take my summary as the last word.** Read the licence, and decide
deliberately.

---

## The runtime: what to build on

Four candidates. This is a judgement call, and I will make one rather than survey.

| Option | Language | WebView UI | Formats | Notes |
|---|---|---|---|---|
| **JUCE 8** | C++ | **First-class.** `WebBrowserComponent` with native integration, parameter relays, and a resource provider that serves the UI from memory | VST3, AU, AAX, standalone; CLAP via `clap-juce-extensions` | The closest existing thing to what this repo already is |
| **nih-plug** | Rust | third-party (`nih_plug_webview`) | CLAP, VST3 | Excellent framework; the webview story is less settled |
| **iPlug2** | C++ | yes, long-standing | VST3, AU, AAX, WAM | Smaller community; the web UI path is genuinely mature |
| **Raw VST3 SDK** | C++ | you write it | VST3 | Only if you want to own every line |

**Recommendation: JUCE 8.** Not because C++ is pleasant, but because JUCE 8 shipped
exactly the primitive this architecture is built on - a WebView editor with a
message bridge to the processor and typed parameter relays - and it is documented,
maintained and used in shipping products. Everything this repo invented for
`[jweb]` (the bridge, the handshake, the payload extraction) has a supported
equivalent there, and one of them (the payload) becomes unnecessary. JUCE's own
licence terms are their own question, and belong next to the SDK one above.

---

## Where does it live: one repo, or two?

**One repo. Grow this one, rename it, and make `m4l-jweb` a *target* rather than
the product.** A fork is the wrong shape, and the reason is specific rather than
ideological.

### Why a fork loses

The shared core is not a library that two products happen to import. It is a set
of **traps that were expensive to find**, and both backends step on the same ones:

- `default` is not cosmetic - a parameter with no initial value loads at the
  bottom of its range and the device is broken on the first drag.
- A parameter written from the UI must not echo back at the UI (`set` in Max,
  gestures in VST3) - and the naive fix silently breaks something *else* in both.
- A `short` name longer than eight characters truncates rather than errors.
- An unrouted selector produces no error at runtime; it falls on the floor.
- The UI thread cannot be trusted with musical timing, so you compute *when* and
  the host places the note.

Every one of those lives in `surface.ts`, `protocol.ts`, the bridge or the app,
and every one of them applies to a VST3 unchanged. Fork, and you are maintaining
the same list of hard-won rules in two places, where they will drift - and drift
in exactly the way this project's whole test suite exists to prevent, because
these are the bugs with no runtime error. The `defineSurface()` validator that
rejects a nine-parameter bank should not exist twice.

A fork also throws away the one thing that would *prove* the abstraction: **a
device that builds both artifacts from one `src/app/<device>/`.** In one repo,
that is a test. Across two repos, it is a hope.

### Why "just add a target" is not the whole answer either

The honest counter-argument is real. Today the promise is: *clone, `pnpm install`,
`pnpm build`, get an artifact, on any machine with Node*. Drop a C++ runtime, a
CMake build and a notarization step into the repo and that promise dies for
everyone - including the contributors who only ever touch the Max target.

So the split is not "one repo or two", it is **where the seam goes inside one
repo**. The rule that resolves it:

> **The native runtime is a package, it is not a dependency of the Node build, and
> `pnpm build` never touches it.** Building a VST3 is opt-in
> (`--target vst3`), fails with a clear "you need a toolchain" message if one is
> absent, and lives on its own CI matrix. Everything above it is pure TypeScript
> and stays that way.

That is the same discipline the repo already applies to Max: the `.amxd` target
does not require Max, because the Max-shaped parts are text. Here, the *VST3-shaped
parts are text too* - the generated parameter header, the dispatch table, the
bundle assembly - and only the runtime is not. Keep the runtime behind a wall and
the Node-only path survives intact.

### The shape

```
<newname>/
  packages/
    bridge/            # transport-agnostic. jweb | webview | mock
    surface/           # defineSurface + the harness. HOST-AGNOSTIC ALREADY
    protocol/          # the selector contract + the lint (extracted from tests/)
    build/             # the CLI, the target registry
    target-m4l/        # <- today's amxd.mjs, chains.mjs, surface.mjs, wrapper/
    target-vst3/       # <- the C++ runtime, the param codegen, the bundle writer
  src/app/<device>/    # App.tsx, protocol.ts, surface.ts - unchanged, target-blind
  targets.mjs          # which targets this device repo builds
```

The load-bearing move is carving **`target-m4l`** out first, *before* there is a
second target. Everything Max-specific in `packages/build` - the `.amxd` writer,
the patcher DSL, the chain vocabulary, the `[js]` wrapper, the ES5 gate - moves
behind a `Target` interface:

```ts
interface Target {
  name: string;                       // "m4l" | "vst3"
  compileSurface(surface): Artifact;  // live.* objects | a C++ header
  compileProtocol(protocol): Artifact;// a [route] | a dispatch table
  package(ui, artifacts): Promise<void>;
}
```

**Do this even if the VST3 target is never built.** It is the refactor that
*discovers* how much of `packages/build` is actually about Max and how much was
only ever sitting there - and it is far cheaper to find that out with one target
than to find it out by writing a second one against an interface that does not
exist yet.

### The name

`m4l-jweb` names two things that stop being true: Max for Live, and `[jweb]`. It
should be renamed - but **renaming is not urgent and should not be bundled with
anything else**, because it is mechanical, touches every file, and would bury a
real change in the diff.

What the thing actually is: *plugin UIs and parameters, declared in TypeScript,
compiled to whatever host you are targeting*. So the name wants to say **web UI +
plugin**, and to say nothing about Max or Ableton.

| Candidate | Reads as | Against |
|---|---|---|
| **`plugweb`** | plugin + web. Says exactly what it is. | dull, and possibly taken |
| **`webplug`** | same, worse | reads like a WordPress plugin |
| **`cabinet`** | the box a device lives in; a name, not a description | says nothing on its own |
| **`patchbay`** | the thing that routes between hosts and devices | already means something in audio |
| **`hostage`** | the device is *hosted*; memorable | too cute for a README |

I would take **`plugweb`**, and I hold that loosely - it is descriptive, it
survives a third target, and the scope reads well (`@plugweb/bridge`,
`@plugweb/surface`, `@plugweb/target-m4l`). Check the npm scope and the GitHub org
are free before committing; I have not.

**Keep `m4l-jweb` alive as the target name.** `--target m4l-jweb` is a good
name for what it now is: one backend, the original one, the one that talks to
Live. And publish the old `@m4l-jweb/*` packages one last time as deprecated
aliases that re-export the new scope, so nobody's `init` breaks.

### The decision, stated plainly

| | |
|---|---|
| **Repo** | one, kept and grown |
| **Rename** | yes, but as its own change, and not first |
| **Fork** | no - it would duplicate the traps, and the traps are the product |
| **Seam** | a `Target` interface, extracted while there is still only one target |
| **Native code** | a package behind a wall. `pnpm build` never needs a compiler |
| **Proof** | `hello-audio` builds a `.amxd` **and** a `.vst3` from one folder |

---

## Implementation plan

Structured the way this repo already works: **spikes before stages**, because the
questions below are answered by running a plugin in a host, not by reading a
header. [SPIKES.md](SPIKES.md) is the precedent, and it is a good one - every
Stage 1 spike there was run in Live, and two of them changed the design.

### Stage 0 - the spikes (nothing downstream is worth building first)

| # | Question | How to answer it | Why it gates everything |
|---|---|---|---|
| V0.1 | Does a WebView editor open, close and reopen cleanly, ten times, in Live / Reaper / Bitwig, on Windows and macOS? | One plugin, one HTML page, a button. Open and close the editor repeatedly. | Editor lifecycle is the classic plugin crash. If this is fragile, the whole approach is. |
| V0.2 | Do the parameter gestures record automation? | Write a parameter from the WebView **with** `beginEdit`/`endEdit` and **without**. Arm automation. Compare. | This is the VST3 `set` trap. Get it wrong once and it is invisible. |
| V0.3 | Which hosts accept **note output** from a plugin, and in which plugin category? | Emit notes from an effect and from an instrument. Try Live, Reaper, Bitwig, Cubase. | "MIDI effect" is a first-class M4L concept and a *contested* VST3 one. `hello-midi`'s entire shape depends on the answer. |
| V0.4 | What does N instances cost? | Twenty instances on twenty tracks. Watch memory. | Each editor is a browser. Max has the same problem; a DAW project has more instances. |
| V0.5 | Does a UI built with `vite-plugin-singlefile` load from the framework's in-memory resource provider without CORS complaints? | Point it at `dist/ui/<device>/index.html`. | Decides whether the existing UI build is reused verbatim. |
| V0.6 | Can CI build, sign and notarize on both platforms? | One trivial plugin, all the way to a Gatekeeper-clean download. | This is the property being traded away. Prove the replacement works *before* betting on it. |

Fill in a results table, exactly as `SPIKES.md` does. If V0.2 or V0.3 come back
wrong, the design changes; there is no point generating code against a guess.

### Stage 1 - the `Target` seam, extracted with one target

**This is the stage that decides whether the rest is possible, and it contains no
VST3 code at all.** Carve everything Max-specific out of `packages/build` and put
it behind the `Target` interface: the `.amxd` writer, the patcher DSL, the chain
vocabulary, the `[js]` wrapper, the ES5 gate. What is left in `build` is the CLI,
the UI bundling, the target registry, and `loadSurface()`.

`pnpm build` produces byte-identical `.amxd` files before and after. That is the
whole acceptance criterion, and the existing container round-trip test already
checks it.

Do it **now, with one target**, for the reason in the section above: it is how you
find out what in `packages/build` is genuinely about Max, and it is much cheaper to
learn that from a refactor than from a second backend written against an interface
that was guessed. If the seam turns out to be ugly with one target, that is a
finding about the VST3 port, delivered early and for the price of a refactor.

### Stage 2 - the transport seam in the bridge

`@m4l-jweb/bridge` hardcodes `window.max`. Give it a pluggable transport:

```ts
interface Transport {
  bind(name: string, fn: InletHandler): void;
  send(...args: unknown[]): void;
}
```

Three implementations: `jweb` (today's `window.max`), `webview` (the plugin
framework's bridge), `mock` (the dev shim, already effectively this). Everything
public - `bindInlet`, `outlet`, `sendNote`, `onNote`, `tapMessages`, `uiReady` -
keeps its signature. **This is a refactor with no behaviour change and it is worth
doing regardless of whether the VST3 backend ever ships**, because it is what
turns "the browser half of a Max device" into "the browser half of a plugin".

Rename nothing yet. `@m4l-jweb/*` becomes a bad name if this lands, but a rename
is a separate, mechanical, low-value change and it should not be tangled up with
this one.

### Stage 3 - the surface, second backend

`loadSurface()` already evaluates `surface.ts` and hands back plain data, and after
Stage 1 there is a place to put a second consumer of it beside `applySurface()`:

```
packages/target-vst3/src/params.mjs   surface -> generated C++ header
```

It emits the parameter registrations, the `toPlain`/`toNormalized` tapers from
`range` and `exponent`, the `getParamStringByValue` formatting from `unit`, the
default values, and the **stable hashed IDs**. Pin the hashes in a test - a
changed ID is a breaking change to every project that saved automation.

This stage is self-contained, testable without a host, and delivers the single
biggest slice of the value.

### Stage 4 - the runtime

A C++ project inside `packages/target-vst3/`, behind the wall - `pnpm build` never
compiles it - containing the parts every device shares, so a device author never
opens it:

- **The processor.** Parameter store; `ProcessContext` → the same `tick <playing>
  <beats>` at 20 Hz that the wrapper emits today; a scheduled event queue
  (`[pipe]`) with note-off bookkeeping (`[makenote]`) fed by `midinote`; `flush`.
- **The editor.** The WebView, the generated dispatch table, the gesture-wrapped
  parameter writes, the `ui_ready` handshake.
- **The thread seam.** Lock-free queues both ways. Max's `[js]` handled this for
  us and a plugin does not: a message from the UI must never allocate or block on
  the audio thread. **This is the one genuinely new hazard in the whole port**, and
  it is the kind that shows up as an intermittent click in someone else's mix
  rather than as an error.
- **State.** `getState`/`setState`, versioned. Live stored our state for us; a
  plugin serializes its own.

The generated header from Stage 3 is the only per-device input. `chains` in the
manifest selects compiled components instead of patcher boxes - `midiout` pulls in
the event queue, `lowpass` pulls in a one-pole filter.

### Stage 5 - the build target

```bash
pnpm build --target vst3      # opt-in; needs a toolchain, and says so if absent
pnpm build                    # unchanged: Node only, .amxd out
```

Same UI bundle step, then: generate the header, invoke CMake, assemble the bundle
(`moduleinfo.json`, `Resources/`, the binary), sign, notarize. The `.amxd` target
keeps working unchanged, from the same `src/app/<device>/`. **A device that builds
both is the proof the abstraction is real** - and `hello-audio` should be that
device, because a filter is the smallest thing that exercises parameters, DSP and
the editor at once.

Run `pluginval` at its strictest level in CI. It is the VST3 world's equivalent of
this repo's container round-trip and ES5 gate: an invariant checker for the
failures that produce no error.

### Stage 6 - the harness, generalised

Rename Live to "host" in the dev harness, drop the Push preview behind a flag, and
the mocked-Live harness is a mocked-host harness. Near-zero work; it is listed only
because it is what keeps the promise that a device develops in a browser.

### Stage 7 - the rename

Last, on its own, touching everything and changing nothing. `@m4l-jweb/*` becomes
the new scope; `m4l-jweb` survives as the name of a *target*; the old packages ship
one final deprecated release that re-exports the new ones. Doing this earlier would
bury a real change inside a thousand-line diff.

---

## Effort, honestly

| | |
|---|---|
| Stage 0 (spikes) | days, and they may change the plan |
| Stage 1 (the `Target` seam) | a refactor, no new behaviour, **pays for itself with one target** |
| Stages 2-3 (bridge transport, surface codegen) | **the cheap, high-value half.** Pure TypeScript, testable without a host |
| Stage 4 (the runtime) | the real work. A correct, realtime-safe, cross-platform plugin runtime is not a weekend, and the thread seam is where the bodies are buried |
| Stage 5 (build, sign, notarize, pluginval) | tedious, well-trodden, unavoidable |
| Stages 6-7 (harness, rename) | hours, and mechanical |
| Ongoing | **two backends, forever.** Every chain, every parameter kind, every trap, twice - which is precisely why they must share one declaration |

The asymmetry is the point. **Stages 1 to 3 are worth doing on their own merits,
improve the codebase even if the VST3 target never ships, and can be finished
before anyone commits to Stage 4** - which is the only stage that is expensive, and
the only one that is hard to walk back.

---

## What you gain, what you lose

**Gain:** every DAW, not just Live Suite. No Max licence for the user. Sample-
accurate transport instead of a 20 Hz poll. Real DSP instead of the objects Max
happened to give you. A resizable editor instead of a 169 px box that clips
silently. No ES5. No self-extracting payload. And a saner parameter model.

**Lose:** the headless build - the property this project is *named for*. The Live
object model, and every device that depends on it. Max's object library and its
scheduler. The ability for a contributor to clone, install and build with nothing
but Node.

**The one that should decide it:** are the devices you want to build ones that
*talk to Live*, or ones that *make sound and MIDI*? The first kind cannot be a
VST3. The second kind is a VST3 waiting to happen, and most of it is already
written in this repo.

---

## Non-goals

- **Porting the wrapper.** There is no LiveAPI to port it to.
- **Running Max patchers in a VST3.** That is Max's `Max Runtime` / `vst~`
  territory, and it is not this architecture.
- **A single artifact that is both.** Two backends, one source tree. A `.amxd` and
  a `.vst3` are different products that happen to share an app, a surface and a
  protocol - which is exactly as much sharing as is worth having.
