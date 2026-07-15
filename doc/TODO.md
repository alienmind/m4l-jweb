# M4L-JWEB: what is left to do

The backlog for the library itself - things any device built on M4L-JWEB could use,
not one device's business logic.

- The **design** of what already exists is [ARCHITECTURE.md](ARCHITECTURE.md), which
  also records **what we measured in Live**. Read that section before building new features.
- The **designs still being argued about** - dynamic chains, and how Strudel's own audio
  could reach a track - are in [ENHANCEMENTS.md](ENHANCEMENTS.md). Read it before
  building items 2 and 3 below: it argues that the most valuable version of both is not
  the obvious one.
- The two rules everything follows: **`[js]` is a control plane, not a data plane**
  (bulk data travels via disk, never through Max messages), and **gate every unknown
  behind a cheap spike** that can fail in an afternoon rather than a week.
- **What has already shipped is at the [END of this file](#shipped)**, with what each one
  cost to get right. This half is what is still open.

**NEXT UP: the three P1 unblocks in the table below (#4-6)** - a mono-fold bug, a
one-line `export`, and a dead outlet in the window API. They are small, and each one is
blocking a `m4l-strudel` device *right now*. The marquee feature (the `instrument`
chain's polyphony) is real work but blocks nobody waiting, so it comes after them.

---

## What `m4l-strudel` is waiting on

The sibling repo parks a feature rather than working around the library, so its backlog is
a live specification of this one's. `m4l-strudel` has now taken 0.6.0 and deleted its
`[node.script]` - the last one in either repo - and the three bugs/gaps below came back
from using the new APIs in anger. All are this library's, so they belong here.

Priority is keyed on the **State** column: a **defect in something already shipped**, or a
one-line unblock, is **P1** - it is small, it is concrete, and someone is stuck on it right
now. A **genuinely new capability** is **P2**, however much it is wanted. Refer to a row by
its **#**.

| # | Prio | `m4l-strudel` wants | Needs from here | State |
|---|---|---|---|---|
| 1 | — | Drum map + FX line surviving the set | state persistence | **shipped, taken** |
| 2 | — | Downloading samples | fetch-to-disk | **shipped, taken** |
| 3 | — | Previewing samples through the track | the `samples` chain | **shipped, taken** |
| 4 | **P1** | A mono sample in both ears, not one | `samples` to fold a mono buffer to both channels | **BUG.** `groove~ <buf> 2` hard-wires its two outlets to L/R, so a mono file plays in one ear (and most of tidal-drum-machines is mono). Fix in the chain, not the app: fold outlet 0 to both sides when mono - `loadSample()` already resolves the channel count. |
| 5 | **P1** | A device-specific chain that drives DSP from a parameter | `fanParamInto()` exported from `@m4l-jweb/build/chains` | **declared, not exported.** `m4l-strudel` carries a copy (the one with the `set`-silences-the-outlet fix). One line to export. |
| 6 | **P1** | An editor in a floating window (drum map, browser) | a route from the window's `[jweb]` back to `[js]`, and access to its state | **UNUSABLE.** The window's `[jweb]` outlet is wired to nothing, so its page can display but never send a message. `hello-window` (static text) is the only page that works as built. |
| 7 | P2 | `.room() .delay() .crush() .hpf()` | the rack + the neutrality contract (item 2) | open |
| 8 | P2 | `.lpf(sine.range(200, 2000))` | modulation (item 3) | open |
| 9 | P2 | A Strudel **instrument** (WebAudio into MSP) | the native audio bridge | hard, and possibly never |

**P1 - the three that block `m4l-strudel` today** (#4-6): two are defects in features that
already shipped, one is a missing `export` keyword. All are small, and until they are done
the sample browser and the drum-map editor cannot be finished. **Do these before the
`instrument` chain below**, despite it being the marquee feature - a one-line export
unblocks a whole device, and polyphony unblocks nothing that is waiting.

**P2 - the genuine new capabilities** (#7-9) are the numbered items in the sections below.

---

## Priority 1: Core Library Enhancements

### 1. The `instrument` chain: polyphony  ← **START HERE**

`samples` shipped and made the first sound (see [Shipped](#shipped)) - but deliberately
as ONE voice, because a sample browser needs a preview, not a sampler.

**`instrument`** is the other half: `[poly~]` voices around `groove~`/`play~`, a **stage**
in the signal path like any other chain, driven by the note contract the bridge already
exports. Polyphony and voice stealing are Max's problem, not the app's - which is the
whole reason to spend a `[poly~]` on it rather than N groove~ objects and a scheduler in
the app.

**One thing `samples` left unsettled, and it lands squarely on this item:** buffer names
are global to Max and generated per DEVICE (`buf-<device>-<slot>`), not per instance, so
two copies of the device on two tracks name their buffers alike and Max hands the name to
whichever loaded last. Harmless for one preview device. Not harmless for a drum rack,
which is what this item builds.

**Be precise about what makes a sound**, because three claims live near each other and
they are not in the same state:

| | Status |
|---|---|
| **Processing** audio - Live's signal through our DSP (`hello-audio`: `onepole~`, `overdrive~`, `*~`) | **works** |
| **Originating** audio - the device makes the sound itself (`buffer~`, `groove~`) | **works** (`samples`, verified in Live); polyphony is this item |
| **JS-generated** audio - a WebAudio synth in `[jweb]` reaching the track | Priority 2, and it needs a C++ external |

### 2. The rack: a chain vocabulary, and the NEUTRALITY CONTRACT it needs first

> [!WARNING]
> **DO NOT START THIS UNTIL SPIKE 1 IN [ENHANCEMENTS.md](ENHANCEMENTS.md) HAS RUN.**
>
> If a Max device can create **real Ableton devices** next to itself (`load_item` -
> undocumented on disk, one afternoon to settle), then an `.lpf(800).gain(1.2)` should
> populate an **Auto Filter** and a **Utility** in the user's own rack - Ableton's DSP,
> their automation lanes, their presets, their undo, *and their third-party plugins* -
> rather than run through a filter we ported.
>
> Everything below then becomes **unnecessary**: the frozen order, the wet-only reverb
> with no neutral setting, the always-running stages, the CPU muting, this whole
> contract. They are all artifacts of *us* owning the graph. Hand the graph to Live and
> they do not get solved - they cease to exist.
>
> Keep this item as the FALLBACK, and for the two things a device chain genuinely cannot
> do: an effect Live has no device for, and anything that must change per-hap faster than
> a parameter can be set.

`m4l-strudel` refuses `.room()`, `.delay()`, `.crush()` and `.hpf()` honestly ("no Max
chain yet") because this vocabulary does not exist. It is four chains and one rule, and
**the rule is the load-bearing half.**

**The neutrality contract.** The DSP graph is written at BUILD time and the app only
chooses values, so **every stage is always in the signal path** - including the ones
today's line never mentions. That is fine for `gain` (1.0) and `lowpass` (18 kHz),
which are naturally transparent, and it is a trap for a reverb: `cverb~` is **wet-only**,
so a rack with one in it is a rack you cannot switch off. Six such effects is six
colourations a user cannot remove and cannot find.

So a chain must **declare** the setting at which it is bit-identical to a wire, and the
build must be able to check it:

- a `neutral` field on the chain (the parameter values that make it a straight wire), and
- a test that asserts it - null-test the stage: identical input and output samples, not
  "sounds about right".
- a wet-only stage therefore **must** carry its own dry/wet, because it has no neutral
  setting without one. That is a property of the chain, not something a device remembers
  to add.

**The chains** (Live's own install already has the objects - checked, not remembered):
- **`reverb`** - `cverb~`, which ships inside Live (`resources/externals/m4l/`). Mono, so
  one per channel; wet-only, so it needs the dry/wet above.
- **`delay`** - `tapin~`/`tapout~` with feedback through `*~`. `.delay()`,
  `.delaytime()` and `.delayfeedback()` map straight onto it.
- **`hpf`** - the sibling of `lowpass`, and the cheapest one here.
- **`crush`** - a bitcrusher (`degrade~`/`downsamp~`). Neutral at full bit depth.

**The order is frozen and must be chosen once** - `filter -> drive -> delay -> reverb ->
gain` - because `chains: [...]` is a series written at build time. `.lpf(800).room(0.5)`
and `.room(0.5).lpf(800)` will produce the *same* signal path, and the honest thing is
for the library to say so rather than let a device imply otherwise.

**Which effects earn a permanent place is the real question**, since each one costs DSP
whether or not the app's line mentions it.

### 3. Modulation: a parameter that moves faster than the bridge
`.lpf(sine.range(200, 2000))` describes **continuous** modulation. Sending it as
parameter writes from the app means 20 Hz of stepped values fighting the automation
lane - audibly stepped, and wrong in every readout.

A parameter is a control-rate value; modulation is a signal. So an `lfo` stage belongs in
the SIGNAL domain (`cycle~`/`phasor~` into the target's inlet), with the app choosing its
rate, depth and shape - three ordinary parameters - and Max doing the moving. The open
question is the seam: how a chain declares "this inlet is modulatable" so an LFO can be
patched onto it without every chain hand-rolling a summing junction.

**And there is a second half we had missed.** `live.remote~` ships inside Live
(`resources/externals/m4l/`) and, per its own reference, *"allows you to remotely control
parameters in Ableton Live and Max for Live in realtime"* - **at signal rate, without
writing automation**. So a pattern could modulate **a real Ableton device's** parameters,
not just our own DSP, which is a far more interesting feature than an LFO on our filter.
Spike it. See [ENHANCEMENTS.md](ENHANCEMENTS.md).

**Unblocks** `m4l-strudel`'s pattern-driven modulation (its Phase 7.2), which is parked
on exactly this.

### 4. Reverse-engineered Push banks (hardware controller mapping)
Currently, `m4l-jweb` allows you to declare parameter banks (groupings of 8 parameters for hardware like Ableton Push) in `surface.ts`,
and the web mock harness displays them perfectly. However, the build script does not yet inject this banking data into the generated `.amxd` file.
As a result, Live falls back to displaying all parameters in a single, unbanked list.

To fix this, we need to reverse-engineer Max's undocumented JSON format for storing bank data:
1. **Patcher-JSON archaeology:** Open a device in the Max editor, manually configure parameter banks, save it, and diff the resulting JSON to find exactly where and how Max stores this data.
2. **Write the round-trip test first:** Max is extremely picky and will corrupt patches if the JSON is malformed. Do not guess the shape. Write a strict unit test against the known-good JSON before implementing the generator logic.

### 5. Retake README screenshots
Whenever the example devices change shape again.

### 6. Extract the contract pattern - `defineWatch()`, `defineSamples()`
**Only after item 4 (Push banks) has shipped**, when there are two real instances to
generalise from.
`defineSurface()` is not a parameters feature; it is one instance of a rule: *you
declare what the Max side has, the build derives everything else* - objects, wiring,
protocol selectors, a typed React hook, and a harness mock, the same five artifacts
every time.

- **6.1 Lift the shared codegen.** Declaration -> boxes -> wiring -> selectors is one
  pipeline. Leave the user-facing APIs bespoke: `params`, `slots` and `watch` have
  nothing meaningful in common. Same for the harness: a mock registry every contract
  plugs into.
- **6.2 `defineWatch()`** - the real prize. It kills hard rule 4 **by construction**: a
  LiveAPI object created during `loadbang` is dead, forever, with no error, and today
  that is enforced by a comment and a code review. Declare what to observe and the
  codegen emits the observers into `bang()`, unconditionally, because that is the only
  place it ever emits them. `liveapi.ts` becomes generated.
- **6.3 `defineDevice()`** - fold in the manifest, which is already a declaration:
  untyped, in another language, with no derived hook and no mock. **The end state: you
  do not write `[js]` at all.**

**Do not build the generic contract compiler first** and then express the Surface in
terms of it. An abstraction extracted from one example is a guess. Two instances, then
lift. And **fetch-to-disk is not one of these**: it is a service, not a declaration -
you call `fetchToFile(url, path)` and await it. Resist inventing `defineFetch()` for
symmetry. Note `samples` DOES take a declaration already (`slots: [...]` in the
manifest), so it is one of the two instances this item is waiting for.

---

## Priority 2: Native Audio Bridge (JS to Max MSP) (FEAT-STRUDEL-002)

#### What
A high-performance bridge mechanism to stream raw PCM audio bytes generated within the JS runtime (e.g., from WebAudio in the Chromium Embedded Framework, or a Node.js process) directly into Max's MSP signal graph (`~` cords). 

#### Why
Currently, if a JavaScript engine (like Strudel's own WebAudio-based synthesizer) generates sound inside a `[jweb]` or `[node.script]` object, that audio is sent directly to the operating system's default audio output device. It completely bypasses Ableton Live's track routing, volume faders, panning, and effect chains. 
To build a true **Strudel INSTRUMENT** device—one that acts like a standard Ableton synth plugin rather than a MIDI sequencer or an effect—the generated audio must enter the Max signal graph.

#### Why this requires an architecture change
Max for Live does **not** provide any built-in audio outlets for its JavaScript hosting objects:
- `[jweb]` has no `~` outlets. Its Chromium process handles audio internally.
- `[node.script]` has no `~` outlets.

Bridging realtime, sample-accurate audio (e.g., Float32 arrays at 44100Hz) over the existing `jweb` message-passing bridge (which serializes data to JSON strings) is impossible due to severe latency, jitter, and CPU overhead.

#### Suggested Design
To achieve this, `m4l-jweb` would need a native C++ Max external or a local socket-based audio bridge.
1. **Shared Memory / Ringbuffer**: A custom Max external (`jweb.audio~`) that reads from a shared memory block. On the JS side, an `AudioWorklet` writes the generated WebAudio PCM data into this shared memory.
2. **Localhost Streaming**: Alternatively, using a local UDP/TCP stream from a Node backend to a native Max receiving object, though this introduces latency.

Until Max provides a native `[jweb~]` object that exposes CEF's audio output as a Max signal, true JS-generated audio instruments require significant native OS-level or C++ extensions beyond standard Max patching.

**Note this is NOT what the `samples` chain did.** That one originates sound from a
`[buffer~]` in the PATCHER, which is why it works today with no external. Audio generated
inside the browser view still has no route to the track, and that is the whole of this
item.

## Priority 3: **A VST3 backend**, so a device runs outside Live. Assessed in
  [PATCHBOARD-VST3.md](PATCHBOARD-VST3.md): the app, the bridge, the surface and the
  harness port; the LiveAPI wrapper does not, and the headless build is what you trade
  away. **One repo, not a fork** - the shared traps *are* the product, and duplicating
  them is how they drift. Its first step is a `Target` seam extracted from
  `packages/build` **while there is still only one target**, which is worth doing on its
  own merits.

---

<a id="shipped"></a>

# Shipped

Kept, rather than deleted, for one reason: **each of these was broken in a way that
produced no error**, and the note says what the fix actually was. The full account of
what Max does is ARCHITECTURE.md; this is the index into it.

### ~~Fetch-to-disk~~ - SHIPPED, verified in Live
`fetchToFile(url, path)` + the `download` chain + `[maxurl]`.

A download goes to `<dest>.part`, is validated (status **and** the `error` key **and**
the bytes on disk - each catches a failure the others call success), and only then is
copied over the destination, **so a 404 can no longer destroy a good cached file**.
`[js]` has no rename and no delete, so **`[maxurl]` performs the move**: libcurl speaks
`file://`, and a GET of the .part file with `filename_out` set to the destination is a
native streaming copy - 1 MB in 6 ms, measured, with no bytes through `[js]`. The
leftover .part is truncated to zero, which is the closest thing to `delete` that [js]
has. Pinned by `tests/wrapper-max.test.mjs`; the Max side is pinned by the conformance
check in `wrapper/device.ts`.

### ~~State persistence~~ - SHIPPED, verified in Live
`state: { x: state({ default }) }` + `useStateSync()`. A value survived a save, a close
and a reopen of the set. The switch is `parameter_enable` on the `[pattr]` (see
ARCHITECTURE.md); `@save`/`@autorestore`, which it shipped with first, saved nothing at
all.

### ~~Declarative floating windows~~ - SHIPPED, verified in Live
`windows: { x: window({ ... }) }` in `surface.ts` + `useWindow()`, with `hello-window`.
Why it was broken for so long, and the rule it produced, are in ARCHITECTURE.md ("Never
invent a name Max is going to look up").

### ~~The `samples` chain~~ - SHIPPED, verified in Live
**The first M4L-JWEB device that ORIGINATES a sound.** `hello-sampler` (an `instrument`,
which nothing here had built before) fetches a WAV to disk, loads it, and plays it
through the track.

A named `[buffer~]` per slot (`slots: [...]` in the manifest); `buffer_load <slot>
<path>` replying `buffer_ready <slot> <sr> <ms> <chans>`, and `buffer_play` /
`buffer_stop` through one `[groove~]`, which SUMS into the signal path rather than
claiming the stage. `loadSample()` / `playSample()` / `stopSample()` in
`@m4l-jweb/bridge`.

It reports what `[info~]` **measured**, never what the app hoped for: `replace` adopts
the FILE's channel count, and a failed `replace` leaves the previous contents in the
buffer - so a frame count is not proof of a read, and the reply is driven by
`[buffer~]`'s read-completed bang and nothing else.

**Two traps, both silent, both now in ARCHITECTURE.md:**
- **`[buffer~]` does not resolve a relative path the way the device does.** A bare name
  is looked up in MAX'S SEARCH PATH, which does not contain the device's folder - so it
  could not open the file `fetchToFile()` had just written there ("can't open"), and the
  app's promise timed out. A path is resolved ONCE now, in the wrapper, for both.
- **`[buffer~]` reads WAV/AIFF/Next-Sun, NOT MP3.** That list (MP3, OGG, FLAC, M4A)
  belongs to `[sfplay~]`, which streams from disk. A format it will not decode is a line
  in the Max console and *no bang at all* - there is nothing to await, which is why
  `loadSample()` carries a timeout.

**It also corrected the sample-browser design**, which rested on something untrue: *"any
audio generated by the floating `[jweb]` browser outputs through that track"*. **It does
not.** `[jweb]` has no `~` outlets; its Chromium process sends audio straight to the OS
output device, bypassing the track, the fader and the monitor cue. A preview Live can
hear has to be `buffer~` in the patcher. Downloading the file first is not a detour; it
is the only path to audio Live can hear.
