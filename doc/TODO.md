# M4L-JWEB: the plan

The sequenced backlog for the library itself - things any device built on
M4L-JWEB could use, not one device's business logic. This file is the *order*;
[SURFACE.md](SURFACE.md) is the *design* of the biggest item in it.

**What comes next is at the top. What is already done is at the bottom.**

## Two rules the whole plan follows

**1. `[js]` is a control plane, not a data plane.** Max messages are a
text-parsed protocol. Anything bulk - file bytes, audio samples - travels via
*disk*, and `[js]` only ever says "load this path". Every design below that
tried to push bulk data through the message bridge got worse the closer we
looked at it, and two of them turned out to be impossible.

**2. Gate every unknown behind a cheap spike that can fail early.** The items
that depend on Max behaviour nobody here has verified are isolated into spikes
that cost hours, so a wrong guess never sinks a week of building on top of it.

---

# NEXT: build Stage 2

**Every spike passed.** Stage 1 is done, in Live, on hardware - nothing below is
gated on an unknown any more, and the only outstanding item is a formality (1.1a).

| Spike | Question | Status |
|---|---|---|
| ~~1.1~~ | Does `set` on a `live.*` suppress its outlet? | **YES, measured in Live** |
| ~~1.1b~~ | ...and does the `set` write still reach the parameter? | **YES, on a Push** |
| ~~1.2~~ | Can `[js]` drive a `[buffer~]` to read a file off disk? | **YES - 124439 frames off disk** |
| ~~1.3~~ | `[maxurl]` or `[jit.uldl]` - which downloads to disk inside Live? | **YES - `[maxurl]`, 1.2 MB streamed, no truncation** |
| 1.1a | Does a `set`-written parameter still reach Live's automation lane? | not run - but 1.1b makes it near-certain |

**Stage 3.1 is unblocked, and `[node.script]` can go.** `[maxurl]` streamed
1,210,892 bytes of `.wav` over HTTPS straight to a file: `status 200`, size
matching `Content-Length`, no truncation, and no Jitter runtime dragged in. The
shape, read from the outlets rather than assumed: **outlet 1 is progress**
(`<tag> <total> <sofar> 0 0`, continuously - a progress bar for free), **outlet 0
is completion** (`dictionary <name>`), and the response dict carries `status`,
`header`, `content_type`, `size_download`, `total_time` and `filename_out`. The
request is a dict too, so `[js]` builds it - `Dict` is confirmed in `max.d.ts`.
Full detail in [SPIKES.md](SPIKES.md).

**Stage 2 is no longer gated.** `set` suppresses the outlet (the echo counter
stays frozen) *and* still writes the parameter itself (a Push knob's readout
follows a `set_param`). So the suppression is scoped to the outlet and the cords
it drives - exactly the no-feedback behaviour the Surface was designed around,
with the fan-out caveat below. 1.1a asks the same question of the automation lane;
worth confirming, no longer a plausible blocker.

**Stage 3.2's premise holds: disk IS the audio transport.** An empty `buffer~`
went to 124439 frames with a non-zero midsample after `[js]` sent it `replace
jongly.aif`. Audio never has to cross the Max message bridge as data - the file
lands on disk, `buffer~` reads it, MSP plays it, and `[js]` only ever sends
control messages. The `Buffer` binding in `max.d.ts` is confirmed too (`send`,
`framecount`, `channelcount`, `peek`); only `poke` is still taken on faith.

**And the two meet.** The `.wav` `[maxurl]` downloaded was then loaded into the
`buffer~` from `[js]`: 302712 frames, **2 channels**, non-zero samples, from an
empty buffer. Network -> disk -> decode -> audio, in one device, in Live, with no
`[node.script]` anywhere in it. Stage 3 is not a hypothesis any more; it is
wiring. (The channel count came from the *file*, not the declaration - so the
`samples` chain must not assume mono, and readers should ask `channelcount()`.)

One trap that cost a run, now recorded in `max.d.ts`: **`replace` on a file
`buffer~` cannot decode is a silent no-op.** No error, and the buffer keeps
whatever it held. A frame count on its own never means "the read worked" - it
means something only next to what the count was *before*.

## What 1.1 taught us

Building `hello-audio` answered the main question by accident, before the spike
was even run, and the answer is sharper than the spike was designed to find:

> **`set` suppresses the object's outlet for EVERY consumer, not just for the
> app.** It stops the app feeding itself back - and it also cuts every cord that
> object drives *inside the patcher*.

`hello-audio` shipped with its filter fed from the `live.dial`'s outlet, and the
app writing that dial with `set`. The slider appeared dead: the dial moved and the
filter never heard. The fix is to **fan the value out** - to the object (so
automation, MIDI mapping and Push stay right) and, in parallel, straight to
whatever the parameter controls. `writableParams()` in `chains.mjs` does this
today, for one parameter, by hand.

**This changes Stage 2.** The Surface was designed around the `set` trick, so its
generated wiring must fan out the same way or every generated parameter inherits
this bug.

The spike then confirmed the other side of it in Live, which is what makes the
trick safe to build on: `set_param` leaves the echo counter frozen (the outlet
really is suppressed) while a **Push** knob's readout still follows the value
(the parameter really is written). The silence stops at the outlet. A
`parameter_enable`d dial also reaches Push with no extra wiring at all, in both
directions - so "generated parameters get Push and MIDI mapping for free" is
confirmed on hardware, not assumed.

---

# Stage 2 - the Surface

The one place the stack still says "maintain it by hand in four places": the Max
object, the patcher wiring, the app's protocol, and the app's state. Change a
range and three of the four silently disagree.

The project deleted the visual editor by making patchers generated. This does the
same for parameters. Design: **[SURFACE.md](SURFACE.md)**.

The declaration already ships (`defineSurface()`, its types and its validation).
What is missing is the codegen.

## 2.1 Codegen

Replace `addParameters()` in `chains.mjs` with the Surface compiler: the `live.*`
objects, both wiring directions, and `default` -> `parameter_initial` +
`parameter_initial_enable`.

**Generalise `writableParams()`, do not re-derive it.** It is the hand-rolled
sliver of exactly this, and it already carries the fan-out the `set` behaviour
forces (see above). Land the codegen with a test asserting the app-bound path
stays silent *and* that the parameter's consumers still receive the write.

## 2.2 Protocol, generated

One `IN` selector per param, one `OUT` (`set_<id>`), appended to the protocol the
lint already checks - so a param declared but never wired fails CI, exactly like
a hand-written selector.

## 2.3 React hooks

`useParam(surface, "density")` / `useSurface(surface)`, with echo suppression at
the destination as well as the source: a value arriving from automation *while*
the user drags a slider must not fight them.

## 2.4 The dev harness, part 2

With a declaration to render from, the harness gains the parameter panel and the
**Push preview** - the banks, eight cells at a time, with short names and
formatted values. What is normally a hardware-in-the-loop discovery becomes a
browser tab.

## 2.5 Port the hello-world devices, and delete what they replace

`hello-midi`'s dials and `hello-audio`'s cutoff become a few lines of
`surface.ts`; `writableParams()` and `addParameters()` in `chains.mjs` go away;
the manifest's `parameters` field goes away. The examples get *shorter*. If they
do not, the API is wrong. This is the acceptance test for the whole stage.

> **Push banks are deliberately deferred to 3.3.** They need patcher-JSON
> archaeology, and nothing is blocked on them: until banks exist, Live falls back
> to declaration order and Push still shows every parameter. Shipping the
> parameters is what makes Push work at all.

---

# Stage 3 - sound, and the last unknowns

## 3.1 Fetch-to-disk: eliminate `[node.script]`

**Spike 1.3 passed: `[maxurl]` is the answer.** It streamed 1.2 MB to a file in
Live with no truncation. Build against the shape recorded in
[SPIKES.md](SPIKES.md) - a `dictionary` request built in `[js]`, progress on
outlet 1, the completion dict on outlet 0 - and note the progress stream means
`fetchToFile` can report bytes as they land, not just when it finishes.

`[jweb]` is a sandboxed Chromium view: it can `fetch()`, but cannot write
arbitrary files to disk. The only current escape hatch is `[node.script]`, whose
failure modes in Live run from silently ignoring `script start` to crashing the
host. It is the least reliable infrastructure this project has.

`[js]` already does file I/O - it writes the self-extracting UI payload via
`File.writebytes` on load. It always runs, even in a frozen device. Extend that
from "one payload written once at load" to "any file, fetched from a URL, written
to disk on request at runtime", with Max-native objects only.

**Mechanism: a generated `download` chain.** Two dead ends, recorded so nobody
re-proposes them:

- *Chunking bytes back through the bridge.* Serialises many MB through a text
  protocol for no benefit. The download belongs on the Max side, streamed straight
  to disk, with the browser sending one request and getting one completion reply.
- *`[js]` conjuring the downloader with `this.patcher.newobject(...)`.* Runtime
  object creation in a frozen device inside Live is precisely the class of thing
  that fails silently, and it cuts against generated, code-reviewed patch cords.

**Protocol** (in the library, not a device's own `protocol.ts` - any device could
want this):

- UI -> device: `fetch_to_file <requestId> <url> <destPath>`
- device -> UI: `fetch_done <requestId> <bytes>` / `fetch_error <requestId> <msg>`
- The bridge wraps the round trip in
  `fetchToFile(url, destPath): Promise<{ bytes: number }>`.

## 3.2 Instrument devices: `buffer~` playback

**Spike 1.2 passed** - `[js]` loaded a real file into a `buffer~` in Live, so the
seam this stage rests on is real. Still gated on 3.1 for the *download* half, but
the `samples` chain can be built and tested against an already-extracted payload
first, and now it is worth doing.

**The tempting idea, and why it cannot be built.** It looks like `[js]` could
grow an "audio out" utility: the app generates sound, hands it to `[js]`, `[js]`
streams it to Ableton. Two independent hard walls:

- **`[js]` is not on the audio thread.** It is an ES5 interpreter on the
  scheduler/main thread. Nothing hands it a sample block, and it cannot feed
  `plugout~` sample by sample.
- **`[jweb]`'s WebAudio goes to the system output device, not into Live's chain.**
  Chromium's audio graph and MSP's DSP graph do not touch. Audio generated in the
  React app is *already outside* Ableton and cannot be pulled back in.

**What works instead: disk is the audio transport.** The app requests a
fetch-to-disk (3.1). The file lands next to the `.amxd`. `[js]` sends a
`[buffer~]` a `read`/`replace` with that path - native, fast, zero bytes crossing
the bridge. MSP plays it in the DSP graph. `[js]` sends only control: load this
file, play this slice at this pitch, at this time.

Two new chains:

- **`samples`** - a named `[buffer~]` per slot, plus `buffer_load <slot> <path>`
  replying `buffer_ready <slot> <frames> <ms>`.
- **`instrument`** - `[poly~]` voices around `groove~`/`play~` -> `plugout~`,
  driven by the same note contract the bridge already exports. Polyphony and voice
  stealing are Max's problem, not the app's.

For audio the app genuinely computes itself (a waveform rendered in a Web Worker),
the escape hatch is identical: write a WAV to disk, then `buffer~ read` it. Never
round-trip PCM through Max messages.

**Unlocks** the first M4L-JWEB device that makes sound from samples.

## 3.3 Push banks

Needs patcher-JSON archaeology: configure banks once in the Max editor, save, and
diff the JSON - the way the container format was found. Write the round-trip test
first; do not guess the shape.

## 3.4 Also outstanding

- **Verify below Live 12.** `[jweb]` dates to Max 8, so Live 10/11 *should* work.
  Nobody has checked.
- **Port a real device onto the template** as the proof. The pattern came out of a
  working Strudel device; folding that back onto the packages is what will find
  the leaks.
- **Delete the spike device** once SPIKES.md's results table is filled in -
  `src/app/spike/`, `patcher/chains.mjs`, `wrapper/device.ts`, and the manifest
  entry.

---

# Stage 4 - extract the contract pattern

**Only once Stage 2 and 3.2 have both shipped**, and there are two real, working
instances to generalise from.

## The idea

`defineSurface()` is not really a parameters feature. It is one instance of a
general pattern:

> **You declare *what* the Max side has. The build derives *everything else*.**

A declaration compiles to five artifacts, the same five every time:

| | derived from one declaration |
|---|---|
| 1 | the **Max objects** (`live.dial`, `buffer~`, `LiveAPI`, ...) |
| 2 | their **patcher wiring**, in both directions |
| 3 | the **protocol selectors** - so the existing lint covers them for free |
| 4 | a **typed React hook** for the app |
| 5 | a **mock** for the dev harness, so the feature is developable with no Live |

Not everything fits, and it is worth saying which: **fetch-to-disk is a service,
not a declaration.** You call `fetchToFile(url, path)` and await it. Resist
inventing `defineFetch()` for symmetry.

## The warning: do not build this first

The temptation is to build a generic "contract compiler" and then express
Surface, Samples and Watch in terms of it. **Don't.** An abstraction extracted
from one example is a guess.

## 4.1 Extract the shared codegen

Declaration -> boxes -> wiring -> protocol selectors is the same pipeline for
`defineSurface` and `defineSamples`. Lift it. Leave the user-facing APIs bespoke:
`params`, `slots` and `watch` have nothing meaningful in common, and a unified
API pretending they do would be worse than three honest ones.

Same for the harness: a **mock registry** every contract plugs into, so a new
contract gets a dev-harness panel for free.

## 4.2 `defineWatch()` - generate the LiveAPI layer

The third instance, and the test of whether 4.1's extraction was right.

`CLAUDE.md` hard rule 4 is this project's nastiest footgun: LiveAPI objects
created during `loadbang` are **dead** - they construct without error and observe
nothing, forever. That is a lifecycle invariant enforced today by *a comment and
a code review*.

A declaration eliminates it **by construction**: you say what to observe, and the
codegen emits the observers into `bang()`, unconditionally, because that is the
only place it ever emits them.

```ts
export default defineWatch({
  tempo: watch("live_set", "tempo"),
  playing: watch("live_set", "is_playing"),
  selected: watch("live_set view", "selected_track"),
});
```

-> observers created at the one safe moment, selectors on the bridge,
`useLive("tempo")` in React, and a mock in the harness. The whole of `liveapi.ts`
becomes generated.

## 4.3 `defineDevice()` - fold in the manifest

`patcher/devices.mjs` is already a declaration - untyped, in another language,
with no derived hook and no mock. Converge it. It now also maps a device to its UI
folder, which the build and the dev scripts both read, so a typed version has more
to say than it did.

**The end state:** you do not write `[js]` at all.

---

# Open questions (no owner, no stage)

- **Live's per-device parameter budget.** A Surface with 60 declared params may
  hit a wall. Unchecked.
- **Modulation vs. value.** Live parameters have both. The Surface models only
  value. Whether that is a real limitation depends on devices nobody has written.

---
---

# DONE

## Stage 0.1 - the mocked-Live dev harness (part 1)

`@m4l-jweb/surface/dev`: a **message log** (every selector crossing the bridge,
both directions, off `tapMessages()`) and a **mock transport** (play/stop and BPM
driving `tick`/`tempo` at the wrapper's 20 Hz cadence). A sequencer is
developable, and debuggable, without a DAW.

Imported behind `import.meta.env.DEV`; `tests/bundle.test.mjs` asserts it never
reaches a shipped bundle.

## Stage 0.2 - the MIDI contract promoted into the library

`DEVICE_IN` / `CHAIN_IN` / `CHAIN_OUT` in `@m4l-jweb/bridge` - the wrapper's and
the chains' selectors, owned by the library and spread into each device's
`protocol.ts` instead of retyped. Plus typed helpers: `sendNote()`, `onNote()`,
`flushNotes()`.

`tests/protocol.test.mjs` lints each device against **its own** Max side, and
reads the **generated patchers** rather than the chain source - a chain that
builds its route dynamically has no literal to grep.

## Stage 0.3 - `defineSurface()` and its types

The declaration, its types, and its validation ship in `@m4l-jweb/surface`. Bank
size (<= 8), default-in-range, duplicate bank membership and Push-truncated short
names all fail at declaration time, which means they fail the build.

**The codegen does not exist** - that is Stage 2. Live still reads parameters from
`patcher/devices.mjs`, and `surface.ts` must be kept in step by hand.

## Stage 1 - the spike apparatus (built, NOT run)

The `spike` device wires all three questions as the real thing: `set` vs raw into
a `live.dial` with an echo detector, a named `buffer~` for `[js]` to drive, and
`maxurl` on the wrapper's spare outlet taking raw words (deliberately not a guess
at a message vocabulary nobody has confirmed).

**Running them is the next thing to do.** See the top of this document.

## Stage 3.4 - `plugin~ -> DSP -> plugout~`

An audio effect that actually does something, which `passthrough` never was:

- **`lowpass`** - `plugin~ -> onepole~ -> plugout~`, with the cutoff mapped
  40 Hz - 18 kHz logarithmically via `[expr]`. `hello-audio` uses it.
- **`gain`** - the minimal version of the same shape.
- `passthrough` remains, documented as the no-op scaffold it is.

## Not in the original plan, but done

- **One folder per device, one bundle per device.** `src/app/<device>/`, and each
  `.amxd` embeds its own UI - `hello-midi` carries no filter code, `hello-audio`
  no sequencer. A test asserts it.
- **The app can write a Live parameter.** `writableParams()` generates
  `set_<id>` -> `[prepend set]` -> `[live.*]`, fanned out to the parameter's
  consumers. A prototype of Stage 2.1, to be subsumed by it.
- **`default` on a parameter** (`parameter_initial` + `parameter_initial_enable`).
  Without it a `live.*` loads at the bottom of its range - for a filter cutoff,
  a device that eats the signal on load.
- **The `init` template is current, and tested for drift.**
  `tests/starter.test.mjs` compares the template's shared infrastructure against
  this repo's byte-for-byte, so it cannot quietly fall behind again.
- **`hello-midi`** is a pulse generator (Rate: off, 1/4, 1/8, 1/16, 1/32) with a
  free-running fallback when the transport is stopped.
- **Deleted `examples/transposer`** - nothing built, typechecked or tested it.
