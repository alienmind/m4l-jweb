# Patchboard: the VST3 target

*Can this architecture leave Max for Live and run in every DAW? Yes. Doing it makes
`m4l-jweb` one target among several, so the project takes the name **Patchboard**.
This document is the assessment and the plan.*

**Read [ARCHITECTURE.md](ARCHITECTURE.md) first.** This assumes the five patterns it
describes and does not re-explain them.

---

## Patchboard, in short

**One declaration in TypeScript, patched through to whichever host you target.**
`surface.ts`, `protocol.ts` and `App.tsx` describe the device; the target - Max for
Live today, VST3 next - is generated from them.

A **patchboard** is the panel in a studio where every input and output terminates in
a jack. Nothing is hard-wired to anything else: the preamp connects to the board,
the compressor connects to the board, and the signal chain becomes a short cable
between two holes. On a modular synth the same panel *is* the instrument - the patch
is the program, and it is written in cords.

We declare what needs to be patched. The cords are generated: the patcher, the
parameter objects, their wiring in both directions, the routing table. Devices plug
into one side of the board and hosts into the other.

| | |
|---|---|
| **The project** | `patchboard` |
| **The packages** | `@patchboard/bridge`, `@patchboard/surface`, `@patchboard/build`, `@patchboard/target-m4l`, `@patchboard/target-vst3` |
| **The CLI** | `patchboard build --target vst3` |
| **`m4l-jweb`** | survives as the name of a **target** - the one that talks to Live |
| **The old packages** | one final `@m4l-jweb/*` release, deprecated, re-exporting the new scope |

The rename is **Stage 7**, last: it is mechanical, touches every file, and doing it
early would bury every real change in a thousand-line diff. The `@patchboard` npm
scope and GitHub org want claiming before it lands (the unscoped npm name is a
dormant 2012 package; it blocks nothing, since `bin` names are independent of package
names).

---

## The verdict, up front

**Portable, and worth doing - as a second target, not a migration.** `surface.ts`,
`protocol.ts`, `App.tsx`, the bridge, the dev harness and most of the test suite
describe *a plugin*, not a `.amxd`. A VST3 target reuses them.

What does **not** port is the layer underneath, and it carries this project's
single most valuable property:

> **`pnpm build` produces installable devices on a machine that has never had Max
> on it.**

Max's runtime is *already installed on the user's machine*. That is the only reason
a headless build works: we ship a text patcher and a JS wrapper into a container,
and Ableton supplies the engine that runs them. A VST3 has no engine waiting for
it. **The plugin *is* the engine**, so it has to be compiled - a C++ toolchain, a
cross-platform matrix, code signing, and notarization on macOS. You trade "no
compiler in the loop" for a real one.

That is not a reason to say no. It is the thing to be clear-eyed about, because
every other trade in this document goes the other way.

---

## Layer by layer

| Layer | In M4L | In a VST3 | Verdict |
|---|---|---|---|
| **The app** (`App.tsx`) | React in `[jweb]` (Chromium) | React in a WebView (WebView2 / WKWebView) | **Ports, often unchanged** |
| **The bridge** | `window.max.bindInlet` / `outlet` | The host framework's JS bridge | **Ports** behind a transport seam |
| **The protocol** (`protocol.ts`) | Selectors + the routing lint | Same selectors, same lint, a different reader | **Ports** |
| **The surface** (`surface.ts`) | Compiles to `live.*` objects | Compiles to VST3 parameters | **Ports, and improves** |
| **The dev harness** | Mocked Live in a browser | Mocked *host* in a browser | **Ports; barely changes** |
| **The worker** | Web Worker for heavy compute | Same | **Ports** |
| **The wrapper** (`[js]` + LiveAPI) | Clips, scenes, tracks, transport | **There is no LiveAPI** | **Does not port** |
| **The chains** (`midiout`, `lowpass`) | Max objects and patch cords | Your own DSP and scheduler, in C++ | **Rewritten, not ported** |
| **The container writer** (`amxd.mjs`) | 150 lines of `Buffer` | A `.vst3` bundle around a **compiled binary** | **Concept ports, the trick does not** |
| **The ES5 gate** | acorn at `ecmaVersion: 5` | - | **Gone. Good riddance.** |
| **The payload hack** | UI base64'd into the wrapper, extracted on load | The WebView is handed the UI from memory | **Gone. Also good riddance.** |

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
out to be exactly the design a plugin needs, for exactly the same reason. So
`sendNote({ delayMs })` is not a Max detail to be unwound. It is the port's
foundation, already built.

What has to be written on the other side is a `[pipe]` and a `[makenote]`: a sorted
queue of pending events, and note-off bookkeeping so a held note is released. Call
it 150 lines of C++. `flushNotes()` remains the thing that stops every note when the
device stops, and it remains not optional.

### The surface, which gets *better*

`defineSurface()` was designed against Live's parameter model, and VST3's is a
genuinely close cousin:

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
one-field answer. The compiler in `packages/build/src/surface.mjs` is ~300 lines of
patcher JSON; the VST3 equivalent emits a C++ header from the same `loadSurface()`
output. That is the cheapest and highest-value part of the whole port.

**But VST3 has its own version of the `set` trap, and it is just as sharp.** In
Max, a bare value into a `live.dial` echoes back at the app, so we send `set` -
which then silences the object for everyone, so we fan out. In VST3, a parameter
written *from the editor* must be wrapped in a gesture: `beginEdit` /
`performEdit` / `endEdit`. Skip the gestures and the parameter still moves, the DSP
still hears it, the UI still looks right - **and the host records no automation**.
Same failure signature: a correct-looking device, silently missing half its
contract, no error anywhere.

**And one trap worse than anything in Max: parameter IDs are permanent.** A VST3
parameter is addressed by a `uint32` ID, and a saved project stores automation
against it. Derive IDs from declaration order, and inserting a parameter in the
middle of `surface.ts` silently re-points every automation lane in every project a
user has already saved. **Hash the ID from the parameter's key** - the string, not
the index - pin the hashes in a test, and treat a changed hash as a breaking
change. This is the equivalent of "Live embeds a copy of the device in the set",
except the damage lands in *someone else's* project file.

### The dev harness, which barely notices

The harness mocks a transport, renders the parameters, and logs every message
crossing the bridge. Notice how little of it is about Live: the transport emits
`tick` and `tempo`, and those are host concepts, not Ableton concepts. Rename the
panel and it is a mocked *plugin host*. The Push preview is the one genuinely
Live-specific piece.

The 169 px height constraint disappears - a plugin editor is whatever size you
declare, and can be resizable. A constraint is being lifted, so nothing breaks; the
harness just stops enforcing a rule that no longer exists.

### The protocol lint, with one new reader

`tests/protocol.test.mjs` asserts that every selector is handled somewhere on the
host side, because an unrouted selector produces no runtime error. That invariant
is not about Max. It is about message passing, and a VST3 with a WebView is message
passing. What changes is only what the lint *reads*: a generated C++ dispatch table
instead of a generated patcher. Generate the dispatch table from `protocol.ts` and
the lint becomes structurally unnecessary, which is better still.

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
events. It has no view of the session containing it. So:

- **Devices that read tempo/transport and make MIDI or audio: port cleanly.** Both
  `hello-midi` and `hello-audio` are in this class.
- **Devices that manipulate the Live set: cannot exist as a VST3.** A device that
  writes a generated pattern into a clip slot, or follows the selected scene, or
  reads the track's name, is a Max for Live device *by definition*. There is no
  port; there is a different product.

**That is the line to draw before writing any code**, because it decides whether
this is worth doing at all. If the devices you actually want live on the wrong side
of it, the VST3 target is a research project with no payoff.

The consolation is real: `ProcessContext` gives you tempo, time signature, bar
position and musical time **per audio block**, sample-accurate, on the audio thread.
The 20 Hz `Task` poll this repo had to reverse-engineer (because `plugsync~` reads
zero in a MIDI effect) is replaced by a field in a struct the host is *required* to
fill in.

### Max's object library, and its scheduler

`[onepole~]`, `[makenote]`, `[pipe]`, `[poly~]`, `[buffer~]` - forty years of DSP
and scheduling, free, and gone. In a VST3 you write the filter. The `lowpass` chain
becomes a one-pole filter in the processor (ten lines, honestly); the `midiout`
chain becomes the event queue above (a hundred and fifty).

The *chain vocabulary* survives as an idea - a named capability a device opts into -
but a chain stops emitting patcher boxes and starts selecting compiled DSP
components. For the two chains this repo ships, that is a fair trade. For a device
that wanted `poly~` and `buffer~`, it is a substantial DSP project that Max was
handing over for free.

### The headless container writer

`amxd.mjs` writes a `.amxd` byte-for-byte because a `.amxd` is a header, some JSON,
and a directory. A `.vst3` is *also* a straightforward container - a bundle
directory (`Contents/x86_64-win/Foo.vst3`, `moduleinfo.json`, `Resources/`) - and
Node can assemble every part of it happily.

Every part except the one that matters: the binary. That needs a compiler, per
platform, and on macOS a Developer ID signature and a notarization round-trip before
Gatekeeper will load it. CI can do all of this - it is completely standard - but
"clone, `pnpm install`, `pnpm build`, get an artifact" becomes "clone, install a
toolchain, wait".

---

## Licensing: read this before you write code

**The VST3 SDK is dual-licensed: GPLv3, or Steinberg's proprietary agreement.**
This repo is MIT. Those do not compose silently - a VST3 you ship, built against the
SDK, inherits one of those two obligations. Neither is a blocker; both are a
*decision*, and it belongs at the start rather than after the plugin works.

The escape route worth knowing about is **CLAP**, which is MIT and has no such
condition. But CLAP support is not universal - notably, Ableton Live does not host
CLAP - so a CLAP-only plugin reaches fewer users than the `.amxd` we already ship.
The usual answer is to build against CLAP and export a VST3 with a wrapper, which
gets you both formats but does *not* dissolve the SDK question for the VST3
artifact.

**Do not take my summary as the last word.** Read the licence and decide
deliberately.

---

## The runtime: what to build on

| Option | Language | WebView UI | Formats | Notes |
|---|---|---|---|---|
| **JUCE 8** | C++ | **First-class** | VST3, AU, AAX, standalone; CLAP via `clap-juce-extensions` | The closest existing thing to what Patchboard already is |
| **nih-plug** | Rust | third-party (`nih_plug_webview`) | CLAP, VST3 | Excellent framework; the webview story is less settled |
| **iPlug2** | C++ | yes, long-standing | VST3, AU, AAX, WAM | Smaller community; the web UI path is genuinely mature |
| **Raw VST3 SDK** | C++ | you write it | VST3 | Only if you want to own every line |

**Recommendation: JUCE 8**, and not on vibes - it shipped exactly the primitives
this architecture is built on. Checked against JUCE's own docs:

- **`WebBrowserComponent::Options::withNativeIntegrationEnabled()`** injects a JS
  shim with bidirectional event passing. That *is* `bindInlet`/`outlet`, supported
  by the framework instead of invented by us.
- **`withResourceProvider()`** serves the UI from memory. **The base64
  self-extracting payload disappears entirely** - no `File.writebytes`, no 4 KB
  slicing, no cache-busted `file://` URL.
- **The relays map 1:1 onto `surface.ts`'s three kinds.** `WebSliderRelay`,
  `WebToggleButtonRelay`, `WebComboBoxRelay` is `dial`, `toggle`, `menu`, exactly.
  And `WebSliderParameterAttachment` binds a relay to a `RangedAudioParameter`
  **and performs the begin/end gestures for you** - so the automation trap above is
  handled by the framework, *provided we go through the relays instead of around
  them*.

Two known JUCE issues to walk into with open eyes, both already spikes below: the
WebView has an **open bug report about crashing after repeated reloads** (that is
V0.1, and it is not hypothetical), and **`WebSliderParameterAttachment` has
reported `numSteps` as `INT_MAX`** - precisely the path a `dial({ step: 1 })` takes.

JUCE's own licence terms are a separate question, and belong next to the SDK one.

Sources: [JUCE 8 WebView UIs](https://juce.com/blog/juce-8-feature-overview-webview-uis/),
[WebSliderRelay](https://docs.juce.com/master/classjuce_1_1WebSliderRelay.html),
[WebSliderParameterAttachment](https://docs.juce.com/master/classWebSliderParameterAttachment.html),
[WebView reload crash](https://github.com/juce-framework/JUCE/issues/1415),
[numSteps INT_MAX](https://github.com/juce-framework/JUCE/issues/1390).

### The timing hazard, stated correctly

The obvious worry is **clock drift between the browser thread and the audio
thread**. That worry is aimed at the wrong thing, and getting it right changes the
design.

**While the transport runs, the app has no clock of its own to drift with.** It is
message-driven: the processor derives musical time from `ProcessContext` and pushes
it in as `tick`; the app answers with notes. Nothing in the browser is counting
time, so nothing accumulates error. That is not luck - it is the same property that
makes the Max version work, and it is why the wrapper's "no `setTimeout`" rule has a
browser-side twin.

What *is* dangerous is narrower, and worth writing down before anyone codes it:

1. **The message hop has latency, and it must fit inside the lookahead.** A note
   whose `delayMs` is smaller than the round trip arrives after the block it
   belonged in. The lookahead window is not a comfort margin; it is a deadline.
2. **`delayMs` must resolve against the tick's host position, not the processor's
   "now".** If the queue timestamps a note when it *receives* it, every scheduling
   wobble in the browser becomes audible jitter. Timestamp it against the sample
   position of the tick the app was answering, and carry that reference explicitly.
3. **The free-running fallback clock is the one thing that genuinely drifts.** With
   the transport stopped, `hello-midi` pulses off its own clock. There, a JS timer
   against an audio clock *will* separate - and it does not matter, because nothing
   is synchronised to anything when the transport is stopped. Just do not let that
   path quietly become the running one.
4. **The queue must be lock-free.** A message from the UI must never allocate or
   block on the audio thread. Max's `[js]` did this for us; nothing does now.

---

## Where does it live: one repo, or two?

**One repo. Grow this one, rename it to Patchboard, and make `m4l-jweb` a target.**
A fork is the wrong shape, and the reason is specific rather than ideological.

### Why a fork loses

The shared core is not a library that two products happen to import. It is a set of
**traps that were expensive to find**, and both targets step on the same ones:

- `default` is not cosmetic - a parameter with no initial value loads at the bottom
  of its range, and the device is broken on the first drag.
- A parameter written from the UI must not echo back at the UI (`set` in Max,
  gestures in VST3) - and the naive fix silently breaks something *else* in both.
- A `short` name longer than eight characters truncates rather than errors.
- An unrouted selector produces no error at runtime; it falls on the floor.
- The UI thread cannot be trusted with musical timing, so you compute *when* and the
  host places the note.

Every one of those lives in `surface.ts`, `protocol.ts`, the bridge or the app, and
every one applies to a VST3 unchanged. Fork, and you maintain the same list of
hard-won rules in two places, where they will drift - in exactly the way this
project's test suite exists to prevent, because **these are the bugs with no runtime
error.** The `defineSurface()` validator that rejects a nine-parameter bank should
not exist twice.

A fork also throws away the one thing that would *prove* the abstraction: **a device
that builds both artifacts from one `src/app/<device>/`.** In one repo that is a
test. Across two repos it is a hope.

### Why "just add a target" is not the whole answer either

Today the promise is: *clone, `pnpm install`, `pnpm build`, get an artifact, on any
machine with Node.* Drop a C++ runtime, a CMake build and a notarization step into
the repo and that promise dies for everyone - including contributors who only ever
touch the Max target.

So the question is not one repo or two, it is **where the seam goes inside one
repo**:

> **The native runtime is a package, it is not a dependency of the Node build, and
> `pnpm build` never touches it.** Building a VST3 is opt-in (`--target vst3`),
> fails with a clear "you need a toolchain" message if one is absent, and lives on
> its own CI matrix. Everything above it is pure TypeScript and stays that way.

That is the same discipline the repo already applies to Max: the `.amxd` target does
not require Max, because the Max-shaped parts are text. Here, the *VST3-shaped parts
are text too* - the generated parameter header, the dispatch table, the bundle
assembly - and only the runtime is not. Keep the runtime behind a wall and the
Node-only path survives intact.

### The shape

```
patchboard/
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
second target. Everything Max-specific in `packages/build` - the `.amxd` writer, the
patcher DSL, the chain vocabulary, the `[js]` wrapper, the ES5 gate - moves behind a
`Target` interface:

```ts
interface Target {
  name: string;                        // "m4l" | "vst3"
  compileSurface(surface): Artifact;   // live.* objects | a C++ header
  compileProtocol(protocol): Artifact; // a [route]      | a dispatch table
  package(ui, artifacts): Promise<void>;
}
```

**Do this even if the VST3 target is never built.** It is the refactor that
*discovers* how much of `packages/build` is actually about Max and how much was only
ever sitting there - and it is far cheaper to learn that from a refactor than from a
second target written against an interface that was guessed.

### The decision, stated plainly

| | |
|---|---|
| **Repo** | one, kept and grown, renamed to Patchboard |
| **Fork** | no - it would duplicate the traps, and the traps are the product |
| **Seam** | a `Target` interface, extracted while there is still only one target |
| **Native code** | a package behind a wall. `pnpm build` never needs a compiler |
| **Rename** | last, on its own, after everything else |
| **Proof** | `hello-audio` builds a `.amxd` **and** a `.vst3` from one folder |

---

## Implementation plan

Structured the way this repo already works: **spikes before stages**, because the
questions below are answered by running a plugin in a host, not by reading a header.
The Stage 1 spikes ([TODO.md](TODO.md)) are the precedent, and a good one - every one of them
was run in Live, and two of them changed the design.

### Stage 0 - the spikes (nothing downstream is worth building first)

| # | Question | How to answer it | Why it gates everything |
|---|---|---|---|
| V0.1 | Does a WebView editor open, close and reopen cleanly, ten times, in Live / Reaper / Bitwig, on Windows and macOS? | One plugin, one HTML page, a button. Open and close repeatedly. | JUCE has an open crash report here. Editor lifecycle is the classic plugin crash; if it is fragile, the whole approach is. |
| V0.2 | Do the parameter gestures record automation - and do JUCE's relays perform them? | Write a parameter from the WebView through a relay, and again by hand without gestures. Arm automation. Compare. | This is the VST3 `set` trap. Get it wrong once and it is invisible. |
| V0.3 | Does `WebSliderParameterAttachment` report `numSteps` correctly for a stepped dial? | A `dial({ step: 1 })`, end to end. | There is an open report of `INT_MAX`, and `hello-midi`'s Rate is exactly this shape. |
| V0.4 | Which hosts accept **note output** from a plugin, and in which plugin category? | Emit notes from an effect and from an instrument. Live, Reaper, Bitwig, Cubase. | "MIDI effect" is a first-class M4L concept and a *contested* VST3 one. `hello-midi`'s whole shape depends on the answer. |
| V0.5 | What does N instances cost? | Twenty instances on twenty tracks. Watch memory. | Each editor is a browser. A DAW project has more instances than a Live set. |
| V0.6 | Does the `vite-plugin-singlefile` bundle load from `withResourceProvider()` without CORS complaints? | Point it at `dist/ui/<device>/index.html`. | Decides whether the existing UI build is reused verbatim. |
| V0.7 | Can CI build, sign and notarize on both platforms? | One trivial plugin, all the way to a Gatekeeper-clean download. | This is the property being traded away. Prove the replacement works *before* betting on it. |

Fill in a results table, exactly as the Stage 1 spikes did. If V0.2 or V0.4 come back
wrong, the design changes; there is no point generating code against a guess.

### Stage 1 - the `Target` seam, extracted with one target

**The stage that decides whether the rest is possible, and it contains no VST3 code
at all.** Carve everything Max-specific out of `packages/build` and put it behind the
`Target` interface. What is left in `build` is the CLI, the UI bundling, the target
registry, and `loadSurface()`.

`pnpm build` produces byte-identical `.amxd` files before and after. That is the
whole acceptance criterion, and the existing container round-trip test already
checks it.

If the seam turns out ugly with one target, that is a finding about the VST3 port -
delivered early, for the price of a refactor.

### Stage 2 - the transport seam in the bridge

The bridge hardcodes `window.max`. Give it a pluggable transport:

```ts
interface Transport {
  bind(name: string, fn: InletHandler): void;
  send(...args: unknown[]): void;
}
```

Three implementations: `jweb` (today's `window.max`), `webview` (JUCE's shim),
`mock` (the dev harness, already effectively this). Everything public - `bindInlet`,
`outlet`, `sendNote`, `onNote`, `tapMessages`, `uiReady` - keeps its signature.
**A refactor with no behaviour change, and worth doing regardless**: it is what turns
"the browser half of a Max device" into "the browser half of a plugin".

### Stage 3 - the surface, second backend

`loadSurface()` already evaluates `surface.ts` and hands back plain data, and after
Stage 1 there is somewhere to put a second consumer of it:

```
packages/target-vst3/src/params.mjs   surface -> generated C++ header
```

It emits the parameter registrations, the `toPlain`/`toNormalized` tapers from
`range` and `exponent`, the `getParamStringByValue` formatting from `unit`, the
defaults, and the **stable hashed IDs**. Pin the hashes in a test - a changed ID is
a breaking change to every project that saved automation.

Self-contained, testable without a host, and the single biggest slice of the value.

### Stage 4 - the runtime

A C++ project inside `packages/target-vst3/`, behind the wall - `pnpm build` never
compiles it - holding the parts every device shares, so a device author never opens
it:

- **The processor.** Parameter store; `ProcessContext` -> the same `tick <playing>
  <beats>` the wrapper emits today; a scheduled event queue (`[pipe]`) with note-off
  bookkeeping (`[makenote]`) fed by `midinote`; `flush`.
- **The editor.** The WebView, the relays, the generated dispatch table, the
  `ui_ready` handshake.
- **The thread seam.** Lock-free queues both ways, and the three timing rules above.
  **This is the one genuinely new hazard in the whole port**, and it shows up as an
  intermittent click in someone else's mix rather than as an error.
- **State.** `getState`/`setState`, versioned. Live stored our state for us; a plugin
  serializes its own.

The generated header from Stage 3 is the only per-device input. A chain selects
compiled components instead of patcher boxes: `midiout` pulls in the event queue,
`lowpass` pulls in a one-pole filter.

### Stage 5 - the build target

```bash
pnpm build --target vst3      # opt-in; needs a toolchain, and says so if absent
pnpm build                    # unchanged: Node only, .amxd out
```

Same UI bundle step, then: generate the header, invoke CMake, assemble the bundle
(`moduleinfo.json`, `Resources/`, the binary), sign, notarize. The `.amxd` target
keeps working unchanged from the same `src/app/<device>/`. **A device that builds
both is the proof the abstraction is real** - and `hello-audio` should be that
device, because a filter is the smallest thing that exercises parameters, DSP and
the editor at once.

Run `pluginval` at its strictest level in CI. It is this world's equivalent of the
container round-trip and the ES5 gate: an invariant checker for the failures that
produce no error.

### Stage 6 - the harness, generalised

Rename Live to "host" in the dev harness and put the Push preview behind a flag, and
the mocked-Live harness is a mocked-host harness. Near-zero work; listed only
because it is what keeps the promise that a device develops in a browser.

### Stage 7 - the rename to Patchboard

Last, on its own, touching everything and changing nothing. `@m4l-jweb/*` becomes
`@patchboard/*`; `m4l-jweb` survives as the name of a target; the old packages ship
one final deprecated release re-exporting the new ones. Claim the npm scope and the
GitHub org first. Doing this earlier would bury a real change inside a thousand-line
diff.

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
| Ongoing | **two targets, forever.** Every chain, every parameter kind, every trap, twice - which is precisely why they must share one declaration |

The asymmetry is the point. **Stages 1 to 3 are worth doing on their own merits,
improve the codebase even if the VST3 target never ships, and can be finished before
anyone commits to Stage 4** - the only stage that is expensive, and the only one that
is hard to walk back.

---

## What you gain, what you lose

**Gain:** every DAW, not just Live Suite. No Max licence for the user.
Sample-accurate transport instead of a 20 Hz poll. Real DSP instead of the objects
Max happened to give you. A resizable editor instead of a 169 px box that clips
silently. No ES5. No self-extracting payload. A saner parameter model. And a project
whose name describes what it does.

**Lose:** the headless build - the property this project is currently named for. The
Live object model, and every device that depends on it. Max's object library and its
scheduler. The ability for a contributor to clone, install and build with nothing but
Node.

**The one that should decide it:** are the devices you want to build ones that *talk
to Live*, or ones that *make sound and MIDI*? The first kind cannot be a VST3. The
second kind is a VST3 waiting to happen, and most of it is already written here.

---

## Non-goals

- **Porting the wrapper.** There is no LiveAPI to port it to.
- **Running Max patchers in a VST3.** That is Max's own `vst~` territory, and it is
  not this architecture.
- **A single artifact that is both.** Two targets, one source tree. A `.amxd` and a
  `.vst3` are different products that happen to share an app, a surface and a
  protocol - which is exactly as much sharing as is worth having.
