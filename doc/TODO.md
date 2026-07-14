# M4L-JWEB: what is left to do

The backlog for the library itself - things any device built on M4L-JWEB could use,
not one device's business logic.

- The **design** of what already exists is [ARCHITECTURE.md](ARCHITECTURE.md), which
  also records **what we measured in Live**. Read that section before building new features.
- The **designs still being argued about** - dynamic chains, and how Strudel's own audio
  could reach a track - are in [ENHANCEMENTS.md](ENHANCEMENTS.md). Read it before
  building items 3 and 4 below: it argues that the most valuable version of both is not
  the obvious one.
- The two rules everything follows: **`[js]` is a control plane, not a data plane**
  (bulk data travels via disk, never through Max messages), and **gate every unknown
  behind a cheap spike** that can fail in an afternoon rather than a week.

**NEXT UP: item 2, the `samples` chain.** It is the last thing blocking `m4l-strudel`'s
sample browser (a preview the user's track can actually hear), and it is the first device
in this repo that would ORIGINATE a sound rather than process one.

---

## What `m4l-strudel` is waiting on

The sibling repo parks a feature rather than working around the library, which is the
right call - but it means its backlog is a live specification of this one's. As of
0.6.0:

| `m4l-strudel` wants | Needs from here | State |
|---|---|---|
| Drum-map popup UI, sample browser window | Floating windows (`FEAT-STRUDEL-001`) | **shipped** - unpark it |
| Drum map + FX expression surviving the set | State persistence (`FEAT-STRUDEL-003`, "definePersistence") | **shipped** as `state()` + `useStateSync()` - unpark it |
| Sample browser: downloading samples | Fetch-to-disk | **shipped** - unpark it |
| Sample browser: previewing them **through the track** | the `samples` chain (2) | open |
| `.room() .delay() .crush() .hpf()` | the rack + the neutrality contract (3) | open |
| `.lpf(sine.range(200, 2000))` | modulation (4) | open |
| A Strudel **instrument** (WebAudio into MSP) | the native audio bridge | Priority 2 - hard, and possibly never |

Three of those unblocked on this release. **The other four are the items below**, and
they are ordered here in the order that repo needs them.

---

## Priority 1: Core Library Enhancements

### ~~1. Fetch-to-disk~~ - SHIPPED
`fetchToFile(url, path)` + the `download` chain + `[maxurl]`. **Verified in Live.**

A download goes to `<dest>.part`, is validated (status **and** the `error` key **and**
the bytes on disk - each catches a failure the others call success), and only then is
copied over the destination, **so a 404 can no longer destroy a good cached file**.
`[js]` has no rename and no delete, so **`[maxurl]` performs the move**: libcurl speaks
`file://`, and a GET of the .part file with `filename_out` set to the destination is a
native streaming copy - 1 MB in 6 ms, measured, with no bytes through `[js]`. The
leftover .part is truncated to zero, which is the closest thing to `delete` that [js]
has. Pinned by `tests/wrapper-max.test.mjs`; the Max side is pinned by the conformance
check in `wrapper/device.ts`.

### ~~1b. State persistence~~ - SHIPPED
`state: { x: state({ default }) }` + `useStateSync()`. **Verified in Live**: a value
survived a save, a close and a reopen of the set. The switch is `parameter_enable` on
the `[pattr]` (see ARCHITECTURE.md); `@save`/`@autorestore`, which it shipped with
first, saved nothing at all.

### 2. Sound from samples: the `samples` and `instrument` chains  ← **START HERE**
**The highest-value item in this file**, because it is the only thing standing between
`m4l-strudel`'s sample browser and a working device, and because everything downstream
(the Strudel instrument, offline-rendered audio, previews) plays through a `[buffer~]`
in the end.

The download half is now shipped, so this is unblocked - but the `samples` chain can
still be built and tested against an already-extracted payload first, so start there.

- **`samples`** - a named `[buffer~]` per slot; `buffer_load <slot> <path>` replying
  `buffer_ready <slot> <frames> <ms>`. **Must not assume mono** (`replace` adopts the
  file's channel count) and must not treat a frame count as proof of a read.
- **`instrument`** - `[poly~]` voices around `groove~`/`play~`, a **stage** in the
  signal path like any other chain, driven by the note contract the bridge already
  exports. Polyphony and voice stealing are Max's problem, not the app's.
- This is the device that should finally exercise **`type: "instrument"`**, which
  nothing in this repo builds today.

**Unlocks the first M4L-JWEB device that ORIGINATES sound.** Be precise about that,
because three different claims live near each other and only one of them is still open:

| | Status |
|---|---|
| **Processing** audio - Live's signal through our DSP (`hello-audio`: `onepole~`, `overdrive~`, `*~`) | **works today** |
| **Originating** audio - the device makes the sound itself (`buffer~`, `play~`, `poly~`) | **this item** |
| **JS-generated** audio - a WebAudio synth in `[jweb]` reaching the track | Priority 2, and it needs a C++ external |

Nothing in the 0.6.0 release makes a sound. Fetch-to-disk is a *precondition* for
sampled audio - you cannot load a sample you have not got - not audio itself.

It is also the last thing `m4l-strudel`'s **sample browser** needs, and that design
currently rests on something untrue: *"any audio generated by the floating `[jweb]`
browser outputs through that track"*. **It does not.** `[jweb]` has no `~` outlets; its
Chromium process sends audio straight to the OS output device, bypassing the track, the
fader and the monitor cue - which is the entire reason Priority 2 exists. A
**transport-synced preview therefore has to be `buffer~` + `play~` in the patcher** -
this chain - and not WebAudio in the browser view. Downloading the file first is not a
detour; it is the only path to audio that Live can hear.

### 3. The rack: a chain vocabulary, and the NEUTRALITY CONTRACT it needs first
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

### 4. Modulation: a parameter that moves faster than the bridge
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

### 2. Reversed-engineered Push Banks (Hardware Controller Mapping)
Currently, `m4l-jweb` allows you to declare parameter banks (groupings of 8 parameters for hardware like Ableton Push) in `surface.ts`,
and the web mock harness displays them perfectly. However, the build script does not yet inject this banking data into the generated `.amxd` file.
As a result, Live falls back to displaying all parameters in a single, unbanked list.

To fix this, we need to reverse-engineer Max's undocumented JSON format for storing bank data:
1. **Patcher-JSON archaeology:** Open a device in the Max editor, manually configure parameter banks, save it, and diff the resulting JSON to find exactly where and how Max stores this data.
2. **Write the round-trip test first:** Max is extremely picky and will corrupt patches if the JSON is malformed. Do not guess the shape. Write a strict unit test against the known-good JSON before implementing the generator logic.

### 3. Retake README Screenshots
Whenever the example devices change shape again.

### 4. Extract the contract pattern - `defineWatch()`, `defineSamples()`
**Only after Priority 3.2 has shipped**, when there are two real instances to generalise from.
`defineSurface()` is not a parameters feature; it is one instance of a rule: *you
declare what the Max side has, the build derives everything else* - objects, wiring,
protocol selectors, a typed React hook, and a harness mock, the same five artifacts
every time.

- **4.1 Lift the shared codegen.** Declaration -> boxes -> wiring -> selectors is one
  pipeline. Leave the user-facing APIs bespoke: `params`, `slots` and `watch` have
  nothing meaningful in common. Same for the harness: a mock registry every contract
  plugs into.
- **4.2 `defineWatch()`** - the real prize. It kills hard rule 4 **by construction**: a
  LiveAPI object created during `loadbang` is dead, forever, with no error, and today
  that is enforced by a comment and a code review. Declare what to observe and the
  codegen emits the observers into `bang()`, unconditionally, because that is the only
  place it ever emits them. `liveapi.ts` becomes generated.
- **4.3 `defineDevice()`** - fold in the manifest, which is already a declaration:
  untyped, in another language, with no derived hook and no mock. **The end state: you
  do not write `[js]` at all.**

**Do not build the generic contract compiler first** and then express the Surface in
terms of it. An abstraction extracted from one example is a guess. Two instances, then
lift. And **fetch-to-disk is not one of these**: it is a service, not a declaration -
you call `fetchToFile(url, path)` and await it. Resist inventing `defineFetch()` for
symmetry.

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

## Priority 3: **A VST3 backend**, so a device runs outside Live. Assessed in
  [PATCHBOARD-VST3.md](PATCHBOARD-VST3.md): the app, the bridge, the surface and the
  harness port; the LiveAPI wrapper does not, and the headless build is what you trade
  away. **One repo, not a fork** - the shared traps *are* the product, and duplicating
  them is how they drift. Its first step is a `Target` seam extracted from
  `packages/build` **while there is still only one target**, which is worth doing on its
  own merits.

### ~~4. Declarative Floating Windows~~ - SHIPPED
`windows: { x: window({ ... }) }` in `surface.ts` + `useWindow()`. **Verified in Live**
with `hello-window`. Why it was broken for so long, and the rule it produced, are in
ARCHITECTURE.md ("Never invent a name Max is going to look up").