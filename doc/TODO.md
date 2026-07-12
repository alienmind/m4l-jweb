# M4L-JWEB: the plan

The sequenced backlog for the library itself - things any device built on
M4L-JWEB could use, not one device's business logic. It merges two design
threads: the `[js]`-layer utilities proposed here, and **the Surface**, the
component model for the Max side specified in full in
**[SURFACE.md](SURFACE.md)**. This file is the *order*; SURFACE.md is the
*design*.

## Two rules the whole plan follows

**1. `[js]` is a control plane, not a data plane.** Max messages are a
text-parsed protocol. Anything bulk - file bytes, audio samples - travels via
*disk*, and `[js]` only ever says "load this path". Every design below that
tried to push bulk data through the message bridge got worse the closer we
looked at it, and two of them turned out to be impossible.

**2. Do the work with no unknowns first, and gate every unknown behind a cheap
spike that can fail early.** Three items in this plan depend on Max behaviour
nobody here has verified (`set`-without-output, `[maxurl]` in Live, the
patcher's bank JSON). Each is isolated into a spike that costs hours, so a wrong
guess never sinks a week of building on top of it.

The stages below are ordered by *risk resolved per unit of work*, not by value.
The highest-value item in the document (the Surface) is deliberately not first,
because two much cheaper things make it easier to build and easier to debug.

---

# The direction: every `[js]` feature is a contract

`defineSurface()` is not really a parameters feature. It is one instance of a
general pattern, and the pattern is the actual idea:

> **You declare *what* the Max side has. The build derives *everything else*.**

A declaration compiles to five artifacts, and the same five every time:

| | derived from one declaration |
|---|---|
| 1 | the **Max objects** (`live.dial`, `buffer~`, `LiveAPI`, ...) |
| 2 | their **patcher wiring**, in both directions |
| 3 | the **protocol selectors** - so the existing lint covers them for free |
| 4 | a **typed React hook** for the app |
| 5 | a **mock** for the dev harness, so the feature is developable with no Live |

Every feature in this plan that touches the `[js]` layer fits that shape:

- **`defineSurface({ params, banks })`** -> `live.*` objects, `set_param` wiring,
  `useParam()`, the Push preview. Specified in [SURFACE.md](SURFACE.md).
- **`defineSamples({ slots })`** -> `buffer~` objects, `buffer_load` /
  `buffer_ready` selectors, `useSample()`, and a dev mock that is just a file
  picker. (Stage 3.2.)
- **`defineWatch({ ... })`** -> LiveAPI observers. **The strongest case in the
  list** - see below.
- **`defineDevice({ name, type, chains })`** -> the manifest itself. Note that
  `patcher/devices.mjs` is *already* a declaration; it is just untyped, in a
  different file, in a different language, with no derived hook and no mock. It
  should converge on this pattern rather than sit beside it.

Not everything fits, and it is worth saying which: **fetch-to-disk is a service,
not a declaration.** There is nothing to declare - you call
`fetchToFile(url, path)` and await it. Its dev mock belongs to the harness, not
to a contract. Resist the urge to invent `defineFetch()` for symmetry.

## Why `defineWatch()` is the best one

`CLAUDE.md` hard rule 4 is this project's nastiest footgun:

> LiveAPI objects created during `loadbang` are **DEAD**. They construct without
> error and observe nothing, forever. Create every observer from
> `live.thisdevice`'s `bang()`. Recreate them unconditionally - a guard like
> `if (obs) return` makes the bug permanent.

That is a lifecycle invariant currently enforced by *a comment and a code
review*. A declaration eliminates it **by construction**: you say what you want
to observe, and the codegen emits the observers into `bang()`, unconditionally,
because that is the only place it ever emits them. The trap stops being
something a device author can fall into.

```ts
export default defineWatch({
  tempo:     watch("live_set", "tempo"),
  playing:   watch("live_set", "is_playing"),
  selected:  watch("live_set view", "selected_track"),
});
```

-> observers created at the one safe moment, `tempo <bpm>` / `playing <0|1>`
selectors on the bridge, `useLive("tempo")` in React, and a mock that is a
number input in the dev harness. The whole of `liveapi.ts` becomes generated.

This is the same move the project already made twice: patchers were pixels until
they became generated, and parameters are hand-maintained-in-four-places until
the Surface generates them. The `[js]` layer is the third and last hand-written
surface. **The end state is that you do not write `[js]` at all.**

## The honest warning: do not build this first

The temptation is to build the meta-framework - a generic "contract compiler" -
and then express Surface, Samples and Watch in terms of it. **Don't.** There is
exactly one instance of this pattern today (the Surface) and it is not built yet.
An abstraction extracted from one example is a guess.

Build the Surface concretely (Stage 2). Build `defineSamples` concretely
(Stage 3.2). *Then* look at the two of them side by side and extract what is
genuinely shared - most likely the codegen plumbing (declaration -> boxes ->
wiring -> selectors) and the harness's mock registry, not the user-facing API,
which should stay bespoke per feature because `params` and `slots` and `watch`
have nothing meaningful in common. `defineWatch()` is the third instance and the
test of whether the extraction was right.

That extraction is **Stage 4**, and it is deliberately the last thing in this
document.

---

# Stage 0 - free wins, no Max unknowns

Nothing here needs Live, a spike, or a decision. All of it is pure TypeScript
against contracts that already exist. This stage exists to make the later
stages *observable*.

## 0.1 The message log and mock transport (the dev harness, part 1)

SURFACE.md schedules the whole dev harness at step 4, after the codegen. Two
pieces of it do not depend on the Surface at all and should be hoisted to the
very front:

- **A message log** - every selector crossing the bridge, both directions, in
  the browser. The single best debugging tool this stack can have, and it costs
  almost nothing because the bridge is already the only channel.
- **A mock transport** - play/stop and a BPM field driving a real clock that
  emits `tick <playing> <beats>` and `tempo <bpm>` at the 50 ms cadence the
  wrapper polls at.

Do these first and every later item in this document is debugged in a browser
tab instead of by squinting at the Max console. `pnpm dev`'s `maxSimulate` is a
shim; this is the start of an actual environment.

**Cost:** small. **Risk:** none. **Unblocks:** the debuggability of everything
below.

## 0.2 Promote the MIDI contract into the library

Not a new capability - an existing one that is only half-exposed. The wiring is
real and it works: `packages/build/src/chains.mjs` has a `midiout` chain
(`midinote <pitch> <vel> <durMs> <chan> <delayMs>` and `flush` -> `pipe` ->
`makenote` -> `midiformat` -> `midiout`, so the app computes *when* and Max
places the note precisely) and a `midiin` chain (`notein <pitch> <velocity>`).

But the *contract* for addressing those chains lives only in
`examples/transposer/protocol.ts`. Every device that wants MIDI re-declares
`midinote` and `notein` by hand, and `@m4l-jweb/bridge` offers no typed helper.
The chain is library code; the way to talk to it is copy-paste.

- Export the chain-owned selectors from `@m4l-jweb/bridge` (a `CHAIN_IN` /
  `CHAIN_OUT` a device spreads into its own `protocol.ts`), so the selector a
  device sends and the selector the generated `route` matches come from one
  definition.
- Add typed helpers: `sendNote({ pitch, velocity, durationMs, channel,
  delayMs })`, `flushNotes()`, `onNote(cb)`. Named arguments beat a
  five-positional-int `outlet()` call that is easy to get subtly wrong.
- Keep `tests/protocol.test.mjs` honest: a library-exported selector still has
  to land in a route or handler.

**Cost:** small. **Risk:** none. **Unblocks:** establishes the
library-owns-the-selectors pattern that the Surface's generated selectors (2.2)
will follow, and the `instrument` chain (3.2) consumes this contract directly.

## 0.3 `defineSurface()` and its types

The first step of SURFACE.md, and it is pure data and typing - no Max, no
React, no codegen. Ship the type-level guarantees first, because they are most
of the value and cost nothing at runtime:

- `banks` may only name params that exist (`keyof typeof params`).
- A bank holds at most 8 params (Push has eight encoders; a ninth is a silent
  truncation today).
- `default` must lie within `range`.
- `format` receives the param's own value type.

**Cost:** small. **Risk:** none. **Unblocks:** all of Stage 2.

---

# Stage 1 - the spikes

Three unknowns gate the rest of the plan. Each is a few hours and each can be
run *independently*, without building anything on top of it. Run all three
before committing to Stage 2 or 3.

## 1.1 `set` without output on `live.*` objects

**The question:** does `set <value>` on `live.dial` / `live.toggle` /
`live.menu` update the parameter *without* producing outlet output, in the M4L
build of Max - and does the value still reach Live's automation lane?

**Why it gates things:** the Surface's whole no-feedback design rests on it.
App -> parameter is new wiring, and sending a value to a `live.dial`'s inlet
normally makes it output, which sends it back to the app, which may set it
again - a loop that can oscillate rather than settle with floats. `set` is the
documented escape. If it does not behave as documented, the fallback is a
`[gate]` around the app-bound path that the wrapper closes for one scheduler
tick - uglier, but workable, and much better to know now than after the codegen
is written.

## 1.2 `buffer~` driven from `[js]`

**The question:** can `[js]` tell a `[buffer~]` to `read`/`replace` a real file
on disk, and can MSP then play it - with the file being one the wrapper already
extracted next to the `.amxd`?

**Why it is the cheapest experiment in this document:** it needs no network, no
download chain, and no new protocol. A payload already lands on disk on every
load. This spike alone de-risks the entire instrument story (3.2) and proves the
"disk is the audio transport" rule end to end. **Run this one first.**

## 1.3 `[maxurl]` vs `[jit.uldl]`, inside Live

**The question:** which object actually delivers reliable asynchronous
HTTP-download-to-file when driven from a generated patcher inside Live?
`[maxurl]` is the modern HTTP object and does not drag in the Jitter runtime;
`[jit.uldl]` is the long-standing alternative built for exactly this, with a
completion callback.

**Why it gates things:** 3.1 is a rewrite of a device's download path. Picking
the wrong object means discovering it in Live, late.

---

# Stage 2 - the Surface (the biggest win in the project)

This is the one place the stack still falls back to "go draw it in Max". Push
sees **only** real Live parameters - not your React UI, not anyone's - and
today those parameters are maintained by hand in four places: the Max object,
the patcher wiring, the app's protocol, and the app's state. Change a range and
three of the four silently disagree.

The project deleted the visual editor by making patchers generated. This does
the same for parameters. Full design, including the API and the feedback trap:
**[SURFACE.md](SURFACE.md)**.

It is Stage 2 rather than Stage 0 only because 0.1 makes it debuggable, 0.3 is
its foundation, and 1.1 tells us whether its core wiring trick works.

## 2.1 Codegen

Replace `addParameters()` in `chains.mjs` with the Surface compiler: the
`live.*` objects, both wiring directions, and the feedback defence from 1.1
(`set`, or the `[gate]` fallback). Land it with a test asserting the app-bound
path stays silent.

## 2.2 Protocol, generated

One `IN` selector per param, one `OUT` (`set_param`), appended to the protocol
the existing lint already checks - so a param that is declared but never wired
fails CI, exactly like a hand-written selector. Follows the pattern set in 0.2.

## 2.3 React hooks

`useParam(surface, "density")` / `useSurface(surface)`, with echo suppression at
the destination as well as the source (a value arriving from automation *while*
the user drags a slider must not fight them).

## 2.4 The dev harness, part 2

With a declaration to render from, the harness gains the parameter panel and the
**Push preview**: the banks, eight cells at a time, with short names and
formatted values. You are looking at what a Push user will look at. Normally
that is a hardware-in-the-loop discovery; here it is a browser tab.

## 2.5 Port the transposer

Its `live.dial` becomes three lines of `surface.ts` and the example gets
*shorter*. If it does not, the API is wrong. This is the acceptance test for the
whole stage.

> **Deliberately deferred: Push banks.** The bank layout needs patcher-JSON
> archaeology (discover it by configuring banks once in the Max editor, saving,
> and diffing - the way the container format was found; write the round-trip
> test first, do not guess). But nothing is blocked on it: until banks exist,
> Live falls back to declaration order and Push still shows every parameter.
> **Shipping the parameters is what makes Push work at all**; banks are a
> refinement. See Stage 3.3.

---

# Stage 3 - sound, and the last unknowns

Everything here is gated on a Stage 1 spike. This is also where the two
impossible ideas got replaced with workable ones.

## 3.1 Fetch-to-disk: eliminate `[node.script]`

**Origin:** m4l-strudel's Samples device needs to download real sample packs to
`~/Music/StrudelSamples`. `[jweb]` is a sandboxed Chromium view - it can
`fetch()`, but cannot write arbitrary files to disk. The only current escape
hatch is `[node.script]`, a real Node process with `fs` access - but Node for
Max is unstable inside Live (`CLAUDE.md`: silently ignores `script start`, at
worst crashes the host). It is the least reliable infrastructure this project
has, and every device that must write a real file pays for it.

`[js]` already does file I/O - it writes the self-extracting UI payload via
`File.writebytes` on load (`packages/wrapper/src/core.ts`). It always runs, even
in a frozen device. Extend that from "one payload written once at load" to "any
file, fetched from a URL, written to disk on request at runtime" - Max-native
objects only, no Node.

**Mechanism: a generated `download` chain.** Two dead ends, recorded so nobody
re-proposes them:

- *Chunking bytes back through the bridge.* An early draft had the browser
  `fetch()` and hand bytes to `[js]` in base64 chunks for `File.writebytes` to
  reassemble. Wrong shape: it serializes many MB through a text protocol for no
  benefit. The download belongs on the Max side, streamed straight to disk, with
  the browser sending one request and getting one completion reply.
- *`[js]` conjuring the downloader with `this.patcher.newobject(...)`.* Cuts
  against the repo's thesis that patch cords are **generated and code-reviewed**,
  and runtime object creation in a frozen device inside Live is precisely the
  class of thing that fails silently.

So: a `download` chain in `chains.mjs` that generates the box and wires its
completion outlet back into `[js]`/`route` as a real patch cord. Builds with no
Max installed, shows up in a diff, covered by the protocol lint.

**Protocol** (in `@m4l-jweb/wrapper` + `@m4l-jweb/bridge`, not a device's own
`protocol.ts` - any device could want this):

- UI -> device: `fetch_to_file <requestId> <url> <destPath>` - one message.
- device -> UI: `fetch_done <requestId> <bytes>` on success.
- device -> UI: `fetch_error <requestId> <message>` on failure.
- The bridge wraps the request id and round trip in
  `fetchToFile(url, destPath): Promise<{ bytes: number }>`, so React just awaits.

**Gated on:** spike 1.3.

## 3.2 Instrument devices: `buffer~` playback

**The tempting idea, and why it cannot be built.** It looks like `[js]` could
grow an "audio out" utility - the app generates sound, hands it to `[js]`, `[js]`
streams it to Ableton - which would make writing an instrument trivial. Two
independent hard walls:

- **`[js]` is not on the audio thread.** It is an ES5 interpreter on the
  scheduler/main thread. Nothing hands it a sample block, and it cannot feed
  `plugout~` sample by sample. Anything it "streamed" would glitch.
- **`[jweb]`'s WebAudio goes to the system output device, not into Live's
  chain.** Chromium's audio graph and MSP's DSP graph do not touch. Audio
  generated in the React app is *already outside* Ableton and cannot be pulled
  back in.

**What works instead: disk is the audio transport.** The app requests a
fetch-to-disk (3.1). The file lands next to the `.amxd`. `[js]` sends a
`[buffer~]` a `read`/`replace` with that path - native, fast, zero bytes crossing
the bridge. MSP plays it in the DSP graph, where audio belongs. `[js]` sends only
*control*: load this file, play this slice at this pitch, at this time.

Two new chains:

- **`samples`** - a named `[buffer~]` per slot, plus `buffer_load <slot> <path>`
  replying `buffer_ready <slot> <frames> <ms>` so the UI can show what is loaded.
- **`instrument`** - `[poly~]` voices around `groove~`/`play~` -> `plugout~`,
  driven by the same note contract 0.2 exports. Polyphony and voice stealing are
  Max's problem, not the app's.

For audio the app genuinely computes itself (a waveform rendered in the Web
Worker), the escape hatch is identical: write a WAV to disk, then `buffer~ read`
it. Never round-trip PCM through Max messages. For synthesis from scratch the
same rule holds - the sound is made by MSP objects driven by parameters; the app
moves parameters, never samples.

**Unlocks** the first M4L-JWEB device that makes sound, and m4l-strudel's
Instrument device playing real samples instead of a placeholder oscillator.

**Gated on:** spike 1.2 (and 3.1 for the download half - but the `samples` chain
can be built and tested against an extracted payload before the download exists).

## 3.3 Push banks

Last, because it needs the patcher-JSON archaeology described above and nothing
else is blocked on it. Parameters already reach Push without banks; this makes
the pages read like a performance surface rather than a declaration-order dump.

## 3.4 Also outstanding

- **`plugin~ -> DSP -> plugout~`** - an audio effect that actually does
  something. The `passthrough` chain is a placeholder.
- **Verify below Live 12.** `[jweb]` dates to Max 8, so Live 10/11 *should*
  work. Nobody has checked.
- **Port a real device onto the template** as the proof. The pattern came out of
  a working Strudel device; folding that back onto the extracted packages is what
  will find the leaks.

---

# Stage 4 - extract the contract pattern

**Only once Stage 2 and 3.2 have both shipped**, and there are two real,
working, concrete instances to generalize from. See *"The direction: every `[js]`
feature is a contract"* above for why this is last rather than first.

## 4.1 Extract the shared codegen

Declaration -> boxes -> wiring -> protocol selectors is the same pipeline for
`defineSurface` and `defineSamples`. Lift it. Leave the user-facing APIs bespoke:
`params`, `slots` and `watch` have nothing meaningful in common, and a unified
"contract" API that pretends they do would be worse than three honest ones.

Same for the harness: a **mock registry** every contract plugs into, so a new
contract gets a dev-harness panel for free.

## 4.2 `defineWatch()` - generate the LiveAPI layer

The third instance, and the test of whether 4.1's extraction was right. Replaces
hand-written `liveapi.ts` observers with a declaration, and eliminates
`CLAUDE.md`'s hard rule 4 **by construction** - the codegen only ever emits
observers into `bang()`, so the dead-observer trap becomes unreachable rather
than merely documented.

## 4.3 `defineDevice()` - fold in the manifest

`patcher/devices.mjs` is already a declaration; it is just untyped, in another
language, with no derived hook and no mock. Converge it. This is the breaking
change that also deletes the manifest's `parameters` field (subsumed by the
Surface) - do both in one release.

**The end state:** you do not write `[js]` at all.

---

# Open questions (no owner, no stage)

- **Live's per-device parameter budget.** A Surface with 60 declared params may
  hit a wall. Unchecked.
- **Modulation vs. value.** Live parameters have both. The Surface models only
  value. Whether that is a real limitation depends on devices nobody has written.
- **Should the manifest keep `parameters`?** No - the Surface subsumes it. But
  that is a breaking change to `devices.mjs`, so land the Surface first and
  delete the old field in the same release.
