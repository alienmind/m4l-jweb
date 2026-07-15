# M4L-JWEB: what is left to do

The backlog for the library itself - things any device built on M4L-JWEB could use,
not one device's business logic.

- The **design** of what already exists is [ARCHITECTURE.md](ARCHITECTURE.md), which
  also records **what we measured in Live**. Read that section before building new features.
- The **designs still being argued about** - how Strudel's own audio could reach a track -
  are in [ENHANCEMENTS.md](ENHANCEMENTS.md). The dynamic-rack question (item 2B) is now
  specified HERE, as Spike R1 below: an earlier rewrite of ENHANCEMENTS.md around the
  audio question dropped the `load_item` spike text, and item 2B pointed at nothing.
- The **cross-repo plan** this file is now sequenced against is
  [m4l-strudel's PLAN.md](../../m4l-strudel/doc/PLAN.md): native declarative layout
  first, then Spike R1, then the `remote` chain, then the rack reconciler (if the
  spike passes), with the m4l-strudel Rack preset as the delivery shape for the
  consumer.
- The two rules everything follows: **`[js]` is a control plane, not a data plane**
  (bulk data travels via disk, never through Max messages), and **gate every unknown
  behind a cheap spike that can fail in an afternoon rather than a week.**
- **What has already shipped is at the [END of this file](#shipped)**, with what each one
  cost to get right. This half is what is still open.

**SHIPPED 0.7.0: native declarative layout (item 7).** `layout.native` in `surface.ts`,
the `computeNativeSlots()` grid, the `[jweb]` shift, `isNative()`, and the tests are in
and green (186 tests). `m4l-strudel`'s fx device adopted it in the same train (seven
dials, three columns, sliders deleted). **Owed: the 30-minute Live width check** - that
Live recomputes device width from the wider presentation content. `hello-audio` carries
the demonstrator (`layout.native` on its three params) for exactly that check.

**The state-default seeding fix (row 14) did NOT ride this release.** Seeding a Max
`[dict]` from the patcher JSON is an undocumented format, and the load-bearing subtlety
- that a restored `[pattr]` value must WIN over the build-time seed - is exactly the
part that cannot be settled without Max/Live. It is now its own spike (open the dict in
Max, embed a value, save, diff - the same archaeology as item 4), not a one-liner. The
app-side workaround in `m4l-strudel` stands until then.

**NEXT UP: Spike R1** (item 2B) - an afternoon that decides whether the dynamic rack
exists at all - and the **`remote` chain** (item 3), documented, valuable whatever R1
says, and unblocks `m4l-strudel`'s Phase 7.2. Push banks (item 4) stays open and stays
the precondition for item 6.

---

## What `m4l-strudel` is waiting on

The sibling repo parks a feature rather than working around the library, so its backlog is
a live specification of this one's. Priority is keyed on the **State** column: a **defect
in something already shipped**, or a one-line unblock, is **P1**. A **genuinely new
capability** is **P2**. Refer to a row by its **#**.

| # | Prio | `m4l-strudel` wants | Needs from here | State |
|---|---|---|---|---|
| 1 | — | Drum map + FX line surviving the set | state persistence | **shipped, taken** |
| 2 | — | Downloading samples | fetch-to-disk | **shipped, taken** |
| 3 | — | Previewing samples through the track | the `samples` chain | **shipped, taken** |
| 4 | — | A mono sample in both ears, not one | `samples` to fold a mono buffer to both channels | **shipped, verified in Live** |
| 5 | — | A device-specific chain that drives DSP from a parameter | `fanParamInto()` exported from `@m4l-jweb/build/chains` | **shipped, taken** |
| 6 | — | An editor in a floating window (drum map, browser) | a route from the window's `[jweb]` back to `[js]`, and access to its state | **shipped, verified in Live, adopted** (the drum-rack window) |
| 7 | — | `.room()` and `.delay()` making sound | the static FX chains + the neutrality contract (item **2A**) | **shipped, adopted 2026-07-15** (manifest on `delay`/`reverb`, local chains deleted). Owed: a Live listening A/B |
| 8 | P2 | `.lpf(sine.range(200, 2000))`, and modulating REAL Live devices | the `remote` chain (item 3) | **specified below, open** |
| 9 | P2 | A Strudel **instrument** (WebAudio into MSP) | the native audio bridge, or Route B offline render | hard; Route B is the concrete first step (see ENHANCEMENTS.md) |
| 10 | — | Native dials in the device view, declared in `surface.ts` (fx device sheds its HTML sliders) | `layout.native` codegen (item **7**) | **shipped 0.7.0, adopted**. Owed: the 30-min Live width check |
| 11 | P2 | Translate mode: `.lpf(800)` populating an Auto Filter in the user's rack | **Spike R1** (item 2B), then the reconciler pattern | **spike-gated, spec below** |
| 12 | P2 | The polyphonic Strudel drum rack (its P3) | instance-scoped buffer names in the `instrument` chain (item 1) | open - P3 is parked on exactly this |
| 13 | P1 | Shipping the m4l-strudel Rack preset (a hand-saved .adg of the typed devices) | the installers to copy a device repo's `presets/` into the User Library (item **8**) | open, small |
| 14 | P1 | `state()` defaults that mean what they say | seed the built `[dict]` with the declared default (open bug, see [Shipped](#shipped)) | open defect - did NOT ride item 7 (needs a Max dict-embed spike; app-side workaround stands) |

---

## Priority 1: Core Library Enhancements

### 1. The `instrument` chain: polyphony  ← **BUILT, AWAITING LIVE VERIFICATION**

> **Status (built; polyphony CONFIRMED in Live, multi-sample awaiting a check).** The
> `instrument` chain, a `playVoice()` bridge API, and `hello-instrument` are implemented
> and pass the build and the codegen/protocol tests. The `[poly~]` voice patch is
> generated per device and FROZEN into the `.amxd` as a named dependency, the way
> `Analogue Drums.amxd` ships `analog.Kick~.maxpat` (checked on disk) - which de-risked
> the one real unknown (Max cannot embed a poly~ voice inline). **A user confirmed it
> plays and stacks voices in Live**, so `[poly~]` DOES resolve our wrapper-built frozen
> voice. It is now MULTI-SAMPLE: N named buffers (`slots: ["c","e","g"]`), the voice
> picking one by index (`sel`) and playing it at an EXPLICIT rate - so a note plays a
> dedicated sample at rate 1 or a repitched one at rate 2, the app's choice. Samples
> ship in the repo (`samples/piano/`), served from `main`. Still owed a listening pass
> on the multi-sample keymap + mono fold.

`samples` shipped and made the first sound (see [Shipped](#shipped)) - but deliberately
as ONE voice, because a sample browser needs a preview, not a sampler.

**`instrument`** is the other half: `[poly~]` voices around `groove~`/`play~`, a **stage**
in the signal path like any other chain, driven by the note contract the bridge already
exports. Polyphony and voice stealing are Max's problem, not the app's - which is the
whole reason to spend a `[poly~]` on it rather than N groove~ objects and a scheduler in
the app.

> **BLOCKING for `m4l-strudel`'s drum rack (row 12) - raised 2026-07-15.**
> Buffer names are global to Max and generated per DEVICE at BUILD time
> (`buf-<device>-<slot>` in `instrumentChain()`), so two copies of one device on two
> tracks name their buffers alike and corrupt each other's samples, silently. A drum
> rack is exactly the multi-instance case, and the m4l-strudel Rack (PLAN.md Part 3)
> makes multi-instance the NORMAL case, so this now also gates the Rack's
> instrument slot. **The ask is an instance-scoped buffer name.** Candidate routes,
> to be settled by a spike (checked on disk, per hard rule):
> - **Max's `#0` instance argument** inside the `[poly~]` voice abstraction - `#0` expands
>   to a per-instance number, which is the standard Max idiom for exactly this. But the
>   `[buffer~]` that holds the sample lives in the DEVICE patcher, not the voice, and the
>   voice only references it by name - so `#0` has to reach both, and whether it scopes the
>   same across a `[poly~]` boundary is the unknown to spike.
> - **A wrapper-minted instance id** appended to the name at load time (`buffer_load`
>   already round-trips through `[js]`), with the voice patch told the same suffix. Keeps
>   the name a runtime value, at the cost of threading an id the app never sees today.
> Whichever wins, the contract is: **N instances of one instrument device, each with its
> own buffers, no shared global name.**

**Be precise about what makes a sound**, because three claims live near each other and
they are not in the same state:

| | Status |
|---|---|
| **Processing** audio - Live's signal through our DSP (`hello-audio`: `onepole~`, `overdrive~`, `*~`) | **works** |
| **Originating** audio - the device makes the sound itself (`buffer~`, `groove~`) | **works** (`samples`, verified in Live); polyphony is this item |
| **JS-generated** audio - a WebAudio synth in `[jweb]` reaching the track | Priority 2; Route B (offline render) is the concrete first step |

### 2. The FX vocabulary

#### 2A. The static FX chains  ← **SHIPPED AND ADOPTED**

The `delay` and `reverb` chains and the neutrality contract (`CHAIN_NEUTRAL`,
`WET_DRY_CHAINS`) are implemented in `packages/build/src/chains.mjs` and pinned by
`tests/neutrality.test.mjs` and `tests/chains.test.mjs`. `m4l-strudel` adopted them on
2026-07-15: its manifest runs `["lowpass","drive","delay","reverb","gain"]` and its
local `patcher/chains.mjs` is deleted. **Still owed: a Live listening A/B** - the
null-test is structural (the dry wire survives at unity, the wet path is gain-0 at
neutral), not audible.

**The frozen-order law stands**: `chains: [...]` is a series written at BUILD time,
`filter -> drive -> delay -> reverb -> gain`, every stage always present and neutral at
rest. `.lpf(800).room(0.5)` and `.room(0.5).lpf(800)` produce the same signal path and
the device says so.

**Easy follow-ons when `m4l-strudel` asks**: `hpf` (the cheap sibling of `lowpass`) and
`crush` (`degrade~`/`downsamp~`, neutral at full bit depth). Its fx surface does not
declare them yet, so they are not an unblock.

#### 2B. The dynamic rack: hand the graph to Live  ← **GATED ON SPIKE R1, specified here**

> [!WARNING]
> **DO NOT START 2B UNTIL SPIKE R1 BELOW HAS RUN.** The spike spec used to live in
> ENHANCEMENTS.md and was lost when that file was rewritten around the audio question;
> this section is now its home.

If a Max device can create **real Ableton devices** next to itself, then
`.lpf(800).gain(1.2)` should populate an **Auto Filter** and a **Utility** in the user's
own rack - Ableton's DSP, their automation lanes, their presets, their undo, *and their
third-party plugins* - rather than run through filters we ported. That is
`m4l-strudel`'s Translate mode (row 11), and the fx line of its Rack.

**What is documented and safe to build on** (checked against the LOM reference):
`this_device canonical_parent` is a `Chain` inside a rack (the path contains
`chains N` - context detection is real); `Chain.delete_device(index)` and
`Track.delete_device(index)` (removal is real); `Song.move_device(device, target,
position)` since Live 11 (reordering is real); `live.remote~` (item 3).

**What is NOT documented, and is the whole gate**: instantiation. The Browser
(`load_item`, `audio_effects`, hotswap) is documented for CONTROL SURFACE Python
scripts; whether any of it is reachable through `new LiveAPI("live_app browser")` from
`[js]` is unknown.

**Spike R1** - an afternoon, falsifiable, in a throwaway `wrapper/device.ts` handler on
any existing device. Answer in order, stop at the first NO:

1. Does `new LiveAPI("live_app browser")` return a live object (id != 0)?
2. Can a `BrowserItem` for a factory device (Auto Filter) be reached, and does
   `call("load_item", ...)` exist on the browser object?
3. WHERE does the device land - selected track / after selected device? Can the landing
   site be steered by setting `song.view.selected_track` and `song.view.select_device`
   first, then corrected with `Song.move_device`?
4. Does insertion during playback click or drop out? (Play a pad, load an item.)
5. Does an inserted device survive undo grouping sanely (one user undo step or twelve)?

**If the spike passes**, the reconciler is CONSUMER-SIDE code (`m4l-strudel`'s
`wrapper/device.ts` - NOT a second `[js]`, which would fight `claimAppMessages()`), and
the library's contribution is this spec plus item 3. The diff rules that every
implementation must share: only delete or move a device that re-identifies as owned
(name AND recorded position - LOM ids are NOT stable across set reloads, so never
persist raw ids); idempotent (same input twice is a no-op); parameter values set through
`DeviceParameter.value` interpolated from the parameter's own `min`/`max`, never
hardcoded.

**If the spike fails**, the fallback keeps most of the value and is fully documented:
the device does not CREATE devices, it ADOPTS them - the user drops an Auto Filter into
the rack once, the reconciler binds `.lpf()` to it (parameter mapping + `remote`
modulation), and the UI says "add an Auto Filter to this rack to enable .lpf()".

**Where 2B lands, 2A is not wasted**: it remains the home for effects Live has no device
for, and for anything that must change faster than a parameter can be set. Per-hap
TOPOLOGY change stays impossible either way - topology is per-commit, values are per-hap
via item 3.

### 3. Modulation: the `remote` chain  ← **SPECIFIED, open**

`.lpf(sine.range(200, 2000))` describes **continuous** modulation. Sending it as
parameter writes from the app means 20 Hz of stepped values fighting the automation
lane - audibly stepped, and wrong in every readout.

The design, refined against the cross-repo plan: a **`remote` chain** in
`packages/build/src/chains.mjs`, one `live.remote~` per declared slot
(`remotes: <n>` in the manifest):

```
[jweb] -> route remote_bind remote_val        (claimed in series, claimAppMessages)
  remote_bind <slot> <lomId>  -> [prepend id] -> [live.remote~]   (bind by LOM id)
  remote_val  <slot> <v>      -> [line~ 20]   -> live.remote~ left inlet
```

- The app streams values on the transport tick; a ~20 ms `[line~]` ramp between them
  makes the control-rate bridge SIGNAL-rate at the Max end, which removes the audible
  stepping. `live.remote~` suppresses automation writing by design, per its reference
  (it ships inside Live, `resources/externals/m4l/` - checked on disk).
- The wrapper resolves the target parameter's LOM id (it can walk any device the
  reconciler owns, or any device the user points at) and sends the bind.
- **This chain is useful with or without 2B**: it can modulate ANY Live parameter,
  including ones on devices the user placed by hand - which is a bigger feature than an
  LFO on our own filter.

Bridge API to ship with it: `bindRemote(slot, lomId)` / `writeRemote(slot, value)` in
`@m4l-jweb/bridge`, selectors in `CHAIN_OUT`.

**Unblocks** `m4l-strudel`'s pattern-driven modulation (its Phase 7.2, row 8) and is a
prerequisite for the Translate mode's per-hap values (row 11).

### 4. Reverse-engineered Push banks (hardware controller mapping)
Currently, `m4l-jweb` allows you to declare parameter banks (groupings of 8 parameters for hardware like Ableton Push) in `surface.ts`,
and the web mock harness displays them perfectly. However, the build script does not yet inject this banking data into the generated `.amxd` file.
As a result, Live falls back to displaying all parameters in a single, unbanked list.

To fix this, we need to reverse-engineer Max's undocumented JSON format for storing bank data:
1. **Patcher-JSON archaeology:** Open a device in the Max editor, manually configure parameter banks, save it, and diff the resulting JSON to find exactly where and how Max stores this data.
2. **Write the round-trip test first:** Max is extremely picky and will corrupt patches if the JSON is malformed. Do not guess the shape. Write a strict unit test against the known-good JSON before implementing the generator logic.

Still the precondition for item 6, but no longer the head of the queue - item 7 is.

### 5. Retake README screenshots
Whenever the example devices change shape again. Item 7 will change the fx-shaped
examples' shape, so batch this behind it.

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

### 7. Native declarative layout: `layout.native` in `surface.ts`  ← **SHIPPED 0.7.0**

> **Status (shipped 0.7.0, adopted).** `layout.native` is declared and validated in
> `defineSurface()`, `isNative()` is exported, `computeNativeSlots()` and the `[jweb]`
> shift are in `applySurface()`, and the codegen tests pin the rects, the non-overlap,
> the untouched unlisted params, the jweb shift and the no-layout regression guard (186
> tests green). `hello-audio` carries the demonstrator. `m4l-strudel`'s fx device adopted
> it in the same train - seven dials in three columns, HTML sliders deleted, generated
> patcher verified (dials at the expected rects, `[jweb]` shifted to x=164). **Still owed:
> the 30-minute Live width check** - that Live recomputes device width from the wider
> presentation content. That is the one thing a headless build cannot prove.

**The full spec, with code, is in
[m4l-strudel's PLAN.md, Part 1](../../m4l-strudel/doc/PLAN.md).** The short form:

A device declares which parameters render as NATIVE `live.*` objects in the device
view, and the compiler lays them out. The dials it generates are invisible today only
because they carry no `presentation` attribute - Live shows the presentation view - so
the whole feature is a presentation OVERLAY on codegen that already exists. **No wiring
changes**: the fan-out contract, the `set_<id>` route and `useParam()` are untouched; a
native dial is the same parameter with the same graph, now visible.

- `packages/surface/src/index.ts`: `layout?: { native?: { params: readonly ids[];
  rows?: 1|2|3 } }`, validated in `defineSurface()` (ids must exist; rows capped at 3
  because the device view is a fixed ~169 px and a `live.dial` needs a 56 px pitch).
  Export `isNative(surface, id)` for app code.
- `packages/build/src/surface.mjs`: a pure `computeNativeSlots(surface)` - column-major
  grid fill, per-kind sizes (dial 44x48, toggle 44x15, menu 100x15), 8 px margins -
  returning `id -> presentation_rect` plus the zone width. `applySurface()` adds
  `presentation: 1`, `presentation_rect`, `varname: "param-<id>"` (the prefix avoids
  colliding with `obj-state-<id>` varnames) to the listed params' boxes, and shifts
  `obj-jweb`'s `presentation_rect.x` by the zone width, width preserved (the device gets
  wider; the web view does not get narrower).
- Tests: listed params carry presentation rects inside the zone, none overlap, unlisted
  params carry none, `obj-jweb` shifted by exactly the zone width - and **a surface with
  no `layout` produces byte-identical output to today** (the feature must be invisible
  until asked for).
- **One 30-minute Live check before building the grid**: that Live recomputes device
  width from presentation content on a 2-param hello device with a wider rect.
- **Ship the state-default seeding fix (row 14) in the same release** - it is a
  one-liner in `applyPersistence()` (seed the `[dict]` with
  `JSON.stringify(spec.default)`; the pattr restore must win over the seed, and a test
  must pin that).

First consumer: `m4l-strudel`'s fx device sheds its HTML sliders and keeps only the
Strudel line.

### 8. Installers: copy a device repo's `presets/` into the User Library

Small, and it is what lets a consumer ship a RACK as its front door.
`m4l-strudel`'s reframed Idea 3 delivers an Ableton **rack preset** (a hand-saved
`.adg` containing its typed devices pre-composed) as the single thing a user drags.
The `.adg` format is undocumented (gzipped XML), so it is hand-saved in Live and
committed to the device repo - the library's only job is distribution:

- `packageDevices()`: if `<root>/presets/` exists, copy `*.adg` into `dist/<name>/`
  and the release zip.
- `install-windows.ps1` / `install-mac.sh`: copy those `.adg` files into the User
  Library next to the devices, preserving a `Presets/.../` subpath if the repo uses
  one. The preset references its `.amxd` devices by User Library path, which is
  exactly where the installers already put them - keep both copies in one install
  step so they cannot skew.

Generation of `.adg` at build time is explicitly NOT this item; if it is ever wanted,
it is its own spike (gzip + XML archaeology, same method as item 4).

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

**Read [ENHANCEMENTS.md](ENHANCEMENTS.md) before starting anything here**: it argues the
native external is the LEAST promising of four routes, and that **Route B (offline
render + `saveToFile()` + `[buffer~]`) is the spike to run first** - it is also the
concrete first step toward the Rack's instrument slot (`m4l-strudel` row 9).

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

### ~~The static FX chains + neutrality contract~~ (2A) - SHIPPED, adopted 2026-07-15
`delay` and `reverb` in `packages/build/src/chains.mjs`, `CHAIN_NEUTRAL` /
`WET_DRY_CHAINS`, pinned by `tests/neutrality.test.mjs`. `m4l-strudel`'s manifest runs
them and its local chains are deleted. Owed: a Live listening A/B (the null-test is
structural, not audible).

### ~~Mono sample folds to both ears~~ (#4) - SHIPPED, verified in Live
`groove~ <buf> 2` hard-wires its two outlets to L/R, so a MONO buffer (most of
tidal-drum-machines is mono) drove outlet 0 only and played in one ear. The channel
count is not a build-time fact - `[info~]` MEASURES it when the buffer loads - so the
fix is a runtime gate INSIDE the chain: each slot's count is retained in an `[f]`,
re-asserted on play through a `[t b b b]`, and mapped by `[expr ($i1==1)+1]` to a
`[selector~ 2]` that picks the real stereo R (`groove~` outlet 1) or folds the mono
signal (outlet 0) into R. The L path is untouched. `hello-sampler` carries a stereo
row and a mono row to A/B it; the mono one now plays centred.

### ~~Floating window that talks back~~ (#6) - SHIPPED, verified in Live
The window's `[jweb]` outlet used to go nowhere - a page could display but never
send. Its output is now tagged `window <id> ...` inside the subpatcher and routed to
`[js]`; the wrapper's `window()` dispatches the inner selector through the same
handlers, with `reply()` sending answers back to the asking window BY NAME
(`messnamed`) - a window has no cord from `[js]`. So a window reads and writes the
device's persisted state (the shared `[dict]`), and `sync_state` broadcasts each edit
to every OTHER view, so the device UI and any window stay in sync live.

**One trap, silent, in Live only:** `reply()` first used `outlet.apply`/`messnamed.apply`.
Those are Max HOST functions and `.apply` on them is not reliable - it failed silently
and took the whole `ui_ready` handshake with it (the header read `wrapper -` and no
state arrived). Every reply is one selector and one value, so `reply()` takes a fixed
`(selector, value)`. The Node mock supports `.apply`, so the suite could not catch it;
`tests/wrapper-max.test.mjs` now pins the routing instead. `hello-window` demonstrates
it: a persisted note the window edits and the device view reads back.

**One design consequence, for anyone building on windows:** the wrapper's `tick` and
`tempo` go to outlet 0 - the DEVICE view - and reach a window only as replies to its own
messages. **A window is an editor, not an engine**: anything that schedules against the
transport belongs in the device view, and a window reaches it through shared state.
(This is what settles `m4l-strudel`'s Full Studio design.)

### ~~`fanParamInto()` exported~~ (#5) - SHIPPED
`@m4l-jweb/build/chains` now exports it, so a device's own chain wires a parameter into
DSP with the `set`-silences-the-outlet fix already in it, instead of carrying a copy.
Pinned by a contract test in `tests/chains.test.mjs`.

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

> **OPEN BUG (row 14) - the `default` never reaches Max, raised 2026-07-15 from
> `m4l-strudel`.** `applyPersistence()` (`packages/build/src/surface.mjs`) emits the
> `[dict]` and the `[pattr]`, but **seeds the dict with nothing** - so a FRESH
> instance's dict is empty. `stateStore` seeds the app with the declared `default`,
> then immediately asks Max for the persisted value (`get_state`); Max hands back the
> empty dict, `stateStore` parses `{}` fine (by design - an empty dict is a valid
> value) and **overwrites the default**. Net effect: `default` is a lie for any slot
> the user has not written yet. It bit `m4l-strudel`'s drum device hard - a fresh
> device showed an EMPTY drum map and its `s("bd sd")` emitted no notes, because `bd`
> resolved to nothing. They worked around it app-side (treat an empty map as "use the
> default"), but the library should seed the dict with `JSON.stringify(spec.default)`
> at build time so `default` means what it says. Care: seeding must not clobber a value
> Live restores on set-load - the pattr restore has to win over the build-time seed,
> which is the one thing to get right (and test). **Scheduled to ride item 7's
> release.** It also gates the rack reconciler's owned-devices slot (2B), where "empty
> means own nothing" happens to be the correct semantic - do not rely on that accident
> elsewhere.

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
