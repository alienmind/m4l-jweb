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

**NEXT UP: Spike R1** (item 1) - an afternoon that decides whether the dynamic rack
exists at all - and the **`remote` chain** (item 2), documented, valuable whatever R1
says, and it unblocks `m4l-strudel`'s pattern modulation.

---

# What comes next (priority order)

## 1. Spike R1: the dynamic rack - hand the graph to Live  ← **NEXT, spike-gated**

> [!WARNING]
> **DO NOT build the reconciler (2B) until this spike has run.**

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

## 2. Modulation: the `remote` chain  ← **specified, valuable whatever R1 says**

`.lpf(sine.range(200, 2000))` describes **continuous** modulation. Sending it as
parameter writes from the app means 20 Hz of stepped values fighting the automation
lane - audibly stepped, and wrong in every readout.

A **`remote` chain** in `packages/build/src/chains.mjs`, one `live.remote~` per
declared slot (`remotes: <n>` in the manifest):

```
[jweb] -> route remote_bind remote_val        (claimed in series, claimAppMessages)
  remote_bind <slot> <lomId>  -> [prepend id] -> [live.remote~]   (bind by LOM id)
  remote_val  <slot> <v>      -> [line~ 20]   -> live.remote~ left inlet
```

- The app streams values on the transport tick; a ~20 ms `[line~]` ramp makes the
  control-rate bridge SIGNAL-rate at the Max end, which removes the audible stepping.
  `live.remote~` suppresses automation writing by design.
- Bridge API: `bindRemote(slot, lomId)` / `writeRemote(slot, value)`, selectors in
  `CHAIN_OUT`.
- **Useful with or without R1**: it can modulate ANY Live parameter, including devices
  the user placed by hand - a bigger feature than an LFO on our own filter. Unblocks
  `m4l-strudel`'s Phase 7.2, and is a prerequisite for Translate mode's per-hap values.

## 3. State-default seeding: `default` that means what it says  ← **spike**

`applyPersistence()` emits the `[dict]` and `[pattr]` but **seeds the dict with
nothing** - so a FRESH instance's dict is empty (`{}`), and the app's declared
`default` is overwritten by that empty dict. It bit `m4l-strudel`'s drum device (an
empty drum map) and its fx device (a black screen when `named` came back `{}`); both
work around it app-side today.

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
| 9 | `.lpf(sine.range(...))`, modulating real Live devices | the `remote` chain (item 2) | **open** |
| 10 | Translate mode: `.lpf(800)` -> an Auto Filter | Spike R1 (item 1), then the reconciler | **spike-gated** |
| 11 | The polyphonic drum rack | instance-scoped buffer names in `instrument` | **open** (see below) |
| 12 | Shipping the Rack preset | installers copy `presets/` (item 5) | **open, small** |
| 13 | `state()` defaults that mean what they say | seed the built `[dict]` (item 3) | **open, spike** |
| 14 | A Strudel instrument (WebAudio into MSP) | native audio bridge / Route B (item 8) | **hard, open** |

**Instance-scoped buffer names (row 11), open.** `instrumentChain()` names buffers
`buf-<device>-<slot>`, global to Max and fixed at BUILD time, so two copies of one
device on two tracks corrupt each other's samples, silently. A drum rack is exactly
the multi-instance case. The ask: an instance-scoped buffer name. Candidate routes, to
be settled by a spike: Max's `#0` instance argument inside the `[poly~]` voice, or a
wrapper-minted id appended at load time. Whichever wins: **N instances, each with its
own buffers, no shared global name.**

<a id="shipped"></a>

---

# Shipped

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
