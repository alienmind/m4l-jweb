# M4L-JWEB: what is left to do

The backlog for the library itself - things any device built on M4L-JWEB could use,
not one device's business logic. **Open work is at the top, in priority order; what
has shipped and been tested is at the [END](#shipped).**

- The **design** of what exists, and **what we measured in Live**, is
  [ARCHITECTURE.md](ARCHITECTURE.md). Read it before building new features.
- The **designs still being argued** - how Strudel's own audio could reach a track -
  are in [ENHANCEMENTS.md](ENHANCEMENTS.md).
- The **cross-repo plan** this file is sequenced against is
  [m4l-strudel's PLAN.md](../../m4l-strudel/doc/PLAN.md).
- The two rules everything follows: **`[js]` is a control plane, not a data plane**
  (bulk data travels via disk, never through Max messages), and **gate every unknown
  behind a cheap spike that can fail in an afternoon rather than a week.**

> **STATE (2026-07-17).** Released as **0.9.0**, alongside `m4l-strudel` 0.9.0 - the two
> versions move together from here. Everything shipped this round is confirmed working in
> Live except the two SPIKES (items 0 and 1), which are what is left. 210 tests pass -
> which pins what the generated patcher SAYS, and cannot hear a filter.
>
> **-> Both spikes are written up in
> [m4l-strudel/doc/TESTING.md](../../m4l-strudel/doc/TESTING.md)**, since running them
> means running the devices.
>
> **THE BUG WORTH REMEMBERING FROM THIS ROUND: a Max `[dict]` is a key/value MAP, and
> `sync_state` stores a slot with `Dict.parse(json)`.** So a slot holding an OBJECT
> round-tripped and NOTHING ELSE DID - `state<string>` and `state<FxParam[]>` had nowhere
> to land, the dict stayed empty, `stringify()` returned `{}`, and the app read its own
> default back forever.
>
> It wore two disguises, and cost real debugging as both: `m4l-strudel`'s drum map (an
> object) persisted while its pattern text (a string) silently did not - which looks
> exactly like Live losing your work - and its fx `named` slot (an array) came back `{}`
> every load, which was written off as **item 3's** state-default seeding gap. That gap is
> real. It was never this. `named` had never persisted at all.
>
> Every value now travels as `{"__value": ...}`, with its spaces escaped so Max cannot
> split the payload into atoms (the wrapper's `join(" ")` was papering over that, and
> would have quietly reformatted any pattern with a run of spaces in it).
> `tests/surface-store.test.mjs` pins all of it. **Item 3 is unaffected and still open.**

**NEXT UP: the two spikes.** Item 0 gates `m4l-strudel`'s drum rack and costs two device
instances and a listen; item 1 is an afternoon that decides whether the dynamic rack
exists at all.

---

# What comes next (priority order)

## 0. Spike: does `#0` expand inside an `.amxd` device patcher?  ← **gates m4l-strudel's drum rack**

**The question, and nothing here can answer it.** Buffer names are global to Max, and
both `samplesChain()` and `instrumentChain()` now scope them per instance
(`deviceBufName` / `voiceBufName`, `#0-buf-<device>-<slot>`). `#0` is documented for
ABSTRACTIONS; whether a Max for Live device counts as one is the unknown.

**The bug it fixes was silent**, which is why it was worth the risk: two copies of one
device on two tracks named their buffers identically and Max handed both to whichever
loaded last. One rack's samples became the other's, with no error. A drum rack on two
tracks is the NORMAL case.

**The route was settled by evidence, not deferred to the spike:** a `[buffer~]` takes its
name from its creation argument and has no documented runtime rename, so a wrapper-minted
id can never reach a box frozen at build time. `#0` is the only mechanism available. The
subtlety is that **`#0` is per PATCHER**, and a `[poly~]` voice is its own patcher - so
the device passes its `#0` to `poly~` as an argument and the voice reads it back as `#1`.
Both spellings, one buffer.

**If it does not expand**, the name keeps a literal `#0`, nothing resolves, and every load
fails LOUDLY - a clean answer, and a better failure than the silent one it replaces.

**How to run it: [TESTING.md](../../m4l-strudel/doc/TESTING.md) section 2.** It is two
copies of the sampler and your ears. **P3's drum rack cannot be built until this is a
YES.**

## 1. Spike R1: the dynamic rack - hand the graph to Live  ← **HARNESS BUILT, NOT RUN**

> [!WARNING]
> **DO NOT build the reconciler (2B) until this spike has run.**

> The harness exists: `spike_rack` in `m4l-strudel`'s `wrapper/device.ts`, marked
> throwaway, answering Q1-Q3 by itself and printing what to do for Q4/Q5.
> **How to run it: [TESTING.md](../../m4l-strudel/doc/TESTING.md) section 1.** Write the
> answers into that repo's R2 and DELETE the block - it must not become a feature.

If a Max device can create **real Ableton devices** next to itself, then
`.lpf(800).gain(1.2)` should populate an **Auto Filter** and a **Utility** in the
user's own rack - Ableton's DSP, automation, presets, undo, third-party plugins -
rather than run through filters we ported. That is `m4l-strudel`'s Translate mode.

**What is documented and safe to build on** (checked against the LOM reference):
`this_device canonical_parent` is a `Chain` inside a rack (the path contains
`chains N`); `Chain.delete_device(index)` / `Track.delete_device(index)` (removal);
`Song.move_device(device, target, position)` since Live 11 (reordering);
`live.remote~` (item 2).

**What is NOT documented, and is the whole gate**: instantiation. The Browser
(`load_item`, `audio_effects`, hotswap) is documented for CONTROL SURFACE Python
scripts; whether any of it is reachable through `new LiveAPI("live_app browser")`
from `[js]` is unknown.

**The spike** - an afternoon, falsifiable, in a throwaway `wrapper/device.ts` handler
on any existing device. Answer in order, stop at the first NO:

1. Does `new LiveAPI("live_app browser")` return a live object (id != 0)?
2. Can a `BrowserItem` for a factory device (Auto Filter) be reached, and does
   `call("load_item", ...)` exist on the browser object?
3. WHERE does the device land - selected track / after selected device? Can it be
   steered by setting `song.view.selected_track` / `select_device` first, then
   corrected with `Song.move_device`?
4. Does insertion during playback click or drop out? (Play a pad, load an item.)
5. Does an inserted device survive undo grouping sanely (one user undo step, not
   twelve)?

**If it passes**, the reconciler is CONSUMER-SIDE code (`m4l-strudel`'s
`wrapper/device.ts` - NOT a second `[js]`, which would fight `claimAppMessages()`),
and the library's contribution is this spec plus item 2. The diff rules every
implementation must share: only delete or move a device that re-identifies as owned
(name AND recorded position - LOM ids are NOT stable across set reloads, so never
persist raw ids); idempotent; parameter values set through `DeviceParameter.value`
interpolated from the parameter's own `min`/`max`, never hardcoded.

**If it fails**, the fallback keeps most of the value: the device does not CREATE
devices, it ADOPTS them - the user drops an Auto Filter in the rack once, the
reconciler binds `.lpf()` to it, and the UI says "add an Auto Filter to enable
.lpf()".

**Where 2B lands, the static FX chains are not wasted**: they remain the home for
effects Live has no device for. Per-hap TOPOLOGY change stays impossible either way -
topology is per-commit, values are per-hap via item 2.

## 2. Modulation: the `remote` chain - SHIPPED IN CODE, UNVERIFIED

Built as specified: one `live.remote~` per declared slot (`remotes: <n>` in the
manifest), bound by LOM id, each value ramped by a `[line~]` (`REMOTE_RAMP_MS`, exported
because it only makes sense in relation to the app's tick). Bridge API: `bindRemote()`,
`writeRemote()`, and `resolveParamId()`.

- **The `[line~]` is the whole trick.** The app is control-rate - one value per tick -
  and a bare number into `live.remote~` steps exactly as audibly as a parameter write.
  The ramp makes the control-rate stream signal-rate at the Max end.
- **It takes no audio stage**, so it composes with any chain list without claiming one,
  and it has no neutral for the same reason: an unbound slot modulates nothing.
- **It throws at build time without `remotes: <n>`.** 0 slots would generate no
  `live.remote~` at all - a device that builds, loads, and silently ignores every
  modulation it sends.
- **`get_param_id` / `resolveParamId()` came with it** (item 6.2's direction, in
  miniature): only `[js]` can ask Live for a LOM id, and the join works because the build
  already writes `parameter_longname: <id>` from the same surface declaration the app
  imports - so a surface id IS the Live parameter's name, with no second table to drift.
  It resolves on request rather than caching: **LOM ids do not survive a set reload.**
  - **A trap it walked into, now documented:** `reply()` takes exactly TWO arguments by
    fixed arity (a Max host function will not take `.apply` - it fails silently in Live,
    and once took the whole `ui_ready` handshake with it). A three-argument `reply()`
    silently drops the third. This uses `outlet(0, ...)`, like `buffer_error`.
- `LiveAPI`'s type gained `id` / `path` / `type` / `info` - all real, documented
  properties that were simply never declared.

**What is NOT done:** nothing streams yet. `m4l-strudel`'s fx app has no transport tick
(it has never been an engine), so this chain is reachable and untested end-to-end. See
that repo's R3.

## 3. State-default seeding: `default` that means what it says  ← **spike**

`applyPersistence()` emits the `[dict]` and `[pattr]` but **seeds the dict with
nothing** - so a FRESH instance's dict is empty (`{}`), and the app's declared
`default` is overwritten by that empty dict. `m4l-strudel`'s drum device works around it
app-side today.

> **CORRECTION (2026-07-17).** This item used to claim the fx device's black screen -
> `named` coming back `{}` - as a second symptom. **It was not.** `named` is an ARRAY and
> a `[dict]` is a key/value map, so that slot could never be stored at all, on a fresh
> instance or a saved one; it was the envelope bug (see the state note at the top),
> fixed. Two bugs with one symptom, and the wrong one had a TODO item. Worth the
> correction: this item is now smaller than it looked, and the seeding gap is only ever
> about a slot Live has genuinely never saved.

The library should seed the built `[dict]` with `JSON.stringify(spec.default)`, but
that is **not the one-liner it first looked like**: embedding data in a Max `dict`
from the patcher JSON is an undocumented format, and the load-bearing subtlety - a
restored `[pattr]` value must WIN over the build-time seed on set reload - cannot be
settled without Max/Live. So it is a spike (open a device in Max, add a `dict @embed
1`, save, diff the JSON - the same archaeology as Push banks below), then a test that
pins "restore beats seed".

## 4. Reverse-engineered Push banks

`m4l-jweb` lets a device declare parameter banks (groups of 8, for Push) in
`surface.ts`, and the web mock shows them - but the build does not inject the banking
data into the `.amxd`, so Live shows all parameters in one unbanked list.

1. **Patcher-JSON archaeology:** configure banks by hand in the Max editor, save, and
   diff the JSON to find where/how Max stores bank data.
2. **Write the round-trip test FIRST:** Max corrupts patches on malformed JSON. Do not
   guess the shape; pin the known-good JSON before writing the generator.

The precondition for item 6 (extract the contract pattern).

## 5. Installers: copy a device repo's `presets/` into the User Library

Small, and it is what lets a consumer ship a RACK as its front door.
`m4l-strudel`'s Rack is a hand-saved `.adg` (gzipped XML, undocumented, so committed
not generated) that the installers must place:

- `packageDevices()`: if `<root>/presets/` exists, copy `*.adg` into `dist/<name>/`
  and the release zip.
- `install-windows.ps1` / `install-mac.sh`: copy those `.adg` into the User Library
  next to the devices (same step, so the two cannot skew). Generating `.adg` at build
  time is explicitly NOT this item.

## 6. Extract the contract pattern - `defineWatch()`, `defineSamples()`

**Only after Push banks (item 4) ships**, when there are two real instances to
generalise from. `defineSurface()` is one instance of a rule: *you declare what the
Max side has, the build derives everything else* - objects, wiring, protocol
selectors, a typed React hook, a harness mock.

- **6.1 Lift the shared codegen.** Declaration -> boxes -> wiring -> selectors is one
  pipeline. Leave the user-facing APIs bespoke.
- **6.2 `defineWatch()`** - the real prize. It kills hard rule 4 (a LiveAPI object
  created during `loadbang` is dead, forever) BY CONSTRUCTION: declare what to
  observe, the codegen emits the observers into `bang()`. `liveapi.ts` becomes
  generated.
- **6.3 `defineDevice()`** - fold in the manifest. End state: you do not write `[js]`.

Do NOT build the generic compiler first and express the Surface in terms of it. An
abstraction from one example is a guess.

## 7. Retake README screenshots

Whenever the example devices change shape. Batch behind the layout work (item 4/the
fx examples already changed) and any Push-bank UI change.

## 8. Priority 2: the native audio bridge (JS -> Max MSP) - `FEAT-STRUDEL-002`

Stream raw PCM from the JS runtime (WebAudio in `[jweb]`) into Max's `~` graph, so a
Strudel **instrument** can act like a plugin instead of bypassing the track. `[jweb]`
has no `~` outlets; bridging realtime audio over the JSON message bridge is impossible
(latency, jitter, CPU). It needs a native C++ external or a local socket bridge.

**Read [ENHANCEMENTS.md](ENHANCEMENTS.md) first**: it argues the native external is the
LEAST promising of four routes, and that **Route B (offline render +
`saveToFile()` + `[buffer~]`) is the spike to run first** - also the concrete first
step toward the Rack's instrument slot.

## 9. Priority 3: a VST3 backend, so a device runs outside Live

Assessed in [PATCHBOARD-VST3.md](PATCHBOARD-VST3.md): the app, the bridge, the surface
and the harness port; the LiveAPI wrapper does not. **One repo, not a fork** - the
shared traps *are* the product. Its first step is a `Target` seam extracted from
`packages/build` while there is still only one target, which is worth doing on its own
merits.

---

# What `m4l-strudel` is waiting on

The sibling repo parks a feature rather than working around the library, so its
backlog is a live specification of this one's.

| # | `m4l-strudel` wants | Needs from here | State |
|---|---|---|---|
| 1 | Drum map + FX line surviving the set | state persistence | **shipped, verified** |
| 2 | Downloading + previewing samples through the track | fetch-to-disk + the `samples` chain | **shipped, verified** |
| 3 | A mono sample in both ears | `samples` mono fold | **shipped, verified** |
| 4 | A chain that drives DSP from a parameter | `fanParamInto()` exported | **shipped** |
| 5 | An editor in a floating window | window `[jweb]` -> `[js]` return path + state | **shipped, verified** |
| 6 | `.room()` / `.delay()` making sound | static FX chains + neutrality contract | **shipped, audible in Live** |
| 7 | Native dials in the device view; the two-screen fx panel | `layout.native` + `panel`/`switch` + `useNativePanel` | **shipped 0.7.0, verified in Live** |
| 8 | A polyphonic Strudel instrument | the `instrument` chain / `[poly~]` | **shipped, polyphony verified in Live** |
| 9 | `.lpf(sine.range(...))`, modulating real Live devices | the `remote` chain (item 2) | **shipped in code, unverified** - the consumer has no tick yet |
| 10 | Translate mode: `.lpf(800)` -> an Auto Filter | Spike R1 (item 1), then the reconciler | **spike-gated** - harness built, not run |
| 11 | The polyphonic drum rack | instance-scoped buffer names in `instrument` | **shipped in code**, gated on the `#0` spike (item 0) |
| 12 | Shipping the Rack preset | installers copy `presets/` (item 5) | **open, small** |
| 13 | `state()` defaults that mean what they say | seed the built `[dict]` (item 3) | **open, spike** - but see the correction on item 3 |
| 15 | A pattern / an fx line that survives the set | `state<string>` and `state<T[]>` working at all | **fixed in code** (the envelope), unverified |
| 16 | A reference window that stays in front of Live | `alwaysOnTop` on `window()` | **shipped in code**, unverified |
| 14 | A Strudel instrument (WebAudio into MSP) | native audio bridge / Route B (item 8) | **hard, open** |

**Instance-scoped buffer names (row 11): built, one spike from done.** Both
`instrumentChain()` and `samplesChain()` now name buffers `#0-buf-<device>-<slot>`, so N
instances own N sets of buffers instead of fighting over one global name. The
wrapper-minted-id route was ruled OUT rather than deferred: a `[buffer~]` takes its name
from its creation argument and has no documented runtime rename, so an id minted after
load can never reach a box frozen at build time. See item 0 for the `#0`-in-an-`.amxd`
spike that gates it, and for the `#0`/`#1` hand-off into the `[poly~]` voice.

<a id="shipped"></a>

---

# Shipped

### `hpf` and `crush` chains (0.9.0) - CONFIRMED WORKING IN LIVE
The cheap siblings of `lowpass`/`drive`, both neutral at rest and pinned by
`tests/neutrality.test.mjs`. Two decisions worth keeping:

- **`hpf` is `lowpass`'s COMPLEMENT, not a highpass object.** `onepole~` is lowpass-only,
  and a one-pole highpass is exactly `dry - lowpass(dry)`. That is also what gives it a
  TRUE neutral: a lowpass at 0 Hz passes nothing, so the subtraction returns the dry
  signal bit-for-bit. A real highpass object would rest at its cutoff floor, still
  turning DC and the bottom octave - an always-on colouration the frozen-graph law
  forbids. There was no object to add; there was an identity to use.
- **`crush` rests at 24 bits, not Strudel's 16.** 16-bit quantisation is a quiet crush,
  not a wire. It drives `degrade~`'s bit depth only and leaves the rate ratio at 1.0 -
  that is `.coarse()`, a different effect and a different chain.

Kept, rather than deleted, for one reason: **each of these was broken in a way that
produced no error**, and the note says what the fix actually was.

### Native declarative layout + two-screen panel + `button` (0.7.0) - VERIFIED IN LIVE
`layout.native` in `surface.ts` renders parameters as NATIVE `live.*` objects in the
device view (`computeNativeSlots()` grid, `[jweb]` shifted or - with `panel: true` -
full-width and layered). Confirmed in Live, in this order:

- **hide/show WORKS at runtime** (`obj.hidden` via the wrapper's
  `native_show`/`native_hide`, reached by `this.patcher.getnamed`). So a native dial
  the state does not use vanishes from the device view.
- **reposition/resize does NOT** - `presentation_rect` writes at runtime are stored
  but never redrawn in a frozen M4L device (measured with a `thispatcher script hide`
  attempt AND a Maxobj `presentation_rect` attempt; both failed to move anything).
  So we do not reflow objects.
- Therefore the **two-screen panel** (`layout.native.panel` + `useNativePanel`):
  `[jweb]` full-width with the dials layered over it, flip between the web UI and the
  native knob panel by hiding one layer - the only mechanism that works. The
  `layout.native.switch` param is the view toggle, pinned top-right (over the web UI's
  own button) and out of the grid.
- **`button` kind** (`live.text`, toggle mode): a labelled button where a `live.toggle`
  is a mute square - `m4l-strudel`'s fx panel uses it for its "Back" switch.

`m4l-strudel`'s fx device adopted all of it (dials, panel, Back button); automation,
MIDI-map and Push confirmed working on the native dials. The reflow API that could not
work (`useNativeLayout` / `native_rect`) was removed rather than shipped.

### The `instrument` chain: polyphony - VERIFIED IN LIVE
`[poly~]` voices around `groove~`/`play~`, a stage in the signal path, driven by the
note contract the bridge exports. The `[poly~]` voice patch is generated per device
and FROZEN into the `.amxd` as a named dependency (the way factory instruments ship
their voice abstraction). **A user confirmed `hello-instrument` plays a polyphony of
piano notes in Live.** Multi-sample keymap (N named buffers, picked by `sel`, played
at an explicit rate) is in. Buffer names are still global to Max (row 11 above).

### Static FX chains + neutrality contract - SHIPPED, audible in Live
`delay` and `reverb` in `packages/build/src/chains.mjs`, `CHAIN_NEUTRAL` /
`WET_DRY_CHAINS`, pinned by `tests/neutrality.test.mjs`. `m4l-strudel` runs
`["lowpass","drive","delay","reverb","gain"]`; **`.delay()` and `.room()` confirmed to
produce audible differences in Live.** Easy follow-ons when asked: `hpf`, `crush`.

### Floating window that talks back (#5/#6) - VERIFIED IN LIVE
The window's `[jweb]` output is tagged `window <id>` in the subpatcher and routed to
`[js]`; `reply()` answers the asking window BY NAME (`messnamed`). A window reads and
writes the device's shared `[dict]`, and `sync_state` broadcasts each edit to every
other view. **Trap:** `reply()` first used `.apply` on Max host functions, which fails
silently in Live and took the whole `ui_ready` handshake with it - it now takes a fixed
`(selector, value)`. A window is an EDITOR, not an engine: `tick`/`tempo` go to the
device view only.

### `fanParamInto()` exported (#4) - SHIPPED
`@m4l-jweb/build/chains` exports it, with the `set`-silences-the-outlet fix already in
it. Pinned by a contract test.

### Fetch-to-disk - VERIFIED IN LIVE
`fetchToFile(url, path)` + the `download` chain + `[maxurl]`. A download goes to
`<dest>.part`, is validated (status AND the `error` key AND the bytes on disk), then
`[maxurl]` performs the move via `file://` (libcurl) - no bytes through `[js]`, and a
404 can no longer destroy a good cached file.

### State persistence - VERIFIED IN LIVE
`state: { x: state({ default }) }` + `useStateSync()`. The switch is `parameter_enable`
on the `[pattr]` - the one thing that makes Live save a value with the set.
`@save`/`@autorestore` saved nothing. (The `default` seeding gap is item 3 above.)

### `alwaysOnTop` windows (2026-07-17) - SHIPPED IN CODE, UNVERIFIED
`window({ alwaysOnTop: true })` compiles a `loadbang` -> message -> `[thispatcher]` into
the window's subpatcher. A window you READ while working (a reference) is useless
without it: clicking back into Live to type is exactly what buries it. A window you work
IN wants the default, so it is opt-in.
**The trap, pinned by a test:** `window flags` REPLACES the whole flag list rather than
adding to it, so the generated message names `grow close title` alongside `float`. Send
`float` alone and the window comes up with no close box - a reference card the user
cannot get rid of.

### Declarative floating windows - VERIFIED IN LIVE
`windows: { x: window({...}) }` + `useWindow()`, with `hello-window`. A `maxclass` is
not a name you invent: `open`/`wclose` are message boxes, `[pcontrol]` is `newobj`
text - all were emitted wrong and failed silently.

### The `samples` chain - VERIFIED IN LIVE
The first M4L-JWEB device that ORIGINATES a sound. A named `[buffer~]` per slot,
`buffer_load`/`buffer_play` through one `[groove~]` summed into the signal path.
**Two silent traps, both now in ARCHITECTURE.md:** `[buffer~]` does not resolve a
relative path the device's way (resolve once, in the wrapper); `[buffer~]` reads
WAV/AIFF, NOT MP3 (a format it will not decode is a console line and no bang - hence
the `loadSample()` timeout).
