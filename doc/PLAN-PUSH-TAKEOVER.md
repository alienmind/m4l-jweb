# PLAN-PUSH-TAKEOVER.md - taking the pads

**Separate from [TODO.md](TODO.md).** That file is the library's open backlog; this
is a line of evolution that has not started, and it stays out of the backlog until
Stage 1 confirms in Live what section 1 establishes on paper.

**What it proposes:** a device that decides what every Push pad *does* and what
colour it *is* - not eight encoders mapped to eight parameters, which the library
already does, but the 8x8 grid and the buttons around it, owned by the device for
as long as it is selected.

**Note on sources.** Section 1 was read off this machine: Max's own reference inside
Live, Live's `MIDI Remote Scripts`, and one shipping third-party device that does
exactly this (§1.6). [CLAUDE.md](../CLAUDE.md) forbids inventing a name Max is going
to look up, and this whole feature is one long lookup of names. What remains
unmeasured is flagged as a spike with a gate. Paths here are Windows; the same trees
exist on macOS under
`/Applications/Ableton Live 12 Suite.app/Contents/App-Resources/`.

---

## 0. The brief that started this, corrected

The proposal that opened this line came from an LLM. It is **right in shape and
wrong in almost every name**, which is the failure mode
[MAX-FACTS.md](MAX-FACTS.md) opens with. Recorded so nobody re-derives it:

| Claim | Verdict |
|---|---|
| A M4L device can take the pads over via `control_surfaces` and `grab_control` | **True**, and now confirmed twice - the LOM function list is on disk (§1.1) and a shipping device does it (§1.6). |
| The control is called `Pad_Matrix` | **False.** No such name exists anywhere in Live. The 8x8 grid is **`Button_Matrix`**, on Push 1, 2 and 3 alike. |
| `live.push` is "an abstraction for talking to the pads" | **False, and it is a real object.** `live.push` exists and ships a refpage, but it *configures* Push's own note mode - pad-to-note map, note colours, expressive-pad geometry. It grabs nothing, and the device that does takeover does not use it. |
| `grab_control` lives on `control_surfaces 0` | **False as written.** `control_surfaces` is a *property of `live_app`*, observed as a list of ids; you walk it and ask each one its type (§1.2). |
| "Paint a pad by sending Note On with a velocity from Push's colour palette" | **Wrong route, right palette.** Painting is `call send_value <x> <y> <colour>` on the grabbed control; `<colour>` is a palette index (§1.6). |
| "The plugin detects that it is selected" | True, and it is the device's job: compare `this_device`'s id against `live_set view selected_track view selected_device` (§1.6). |

One-line summary: **the mechanism is real, the vocabulary in that brief is not.** Do
not copy a name out of it.

---

## 1. What is actually there

### 1.1 The ControlSurface LOM API (verified on disk, Live 12 Suite)

`control_surfaces N` is a documented root object, alongside `live_app`, `live_set`
and `this_device`
(`Resources/Max/resources/docs/userguide/content/m4l/live_api_overview.json`).

Its function list, read from
`Resources/MIDI Remote Scripts/_MxDCore/LomTypes.pyc`:

```
get_control_names   get_control   grab_control   release_control
grab_midi           release_midi  send_midi      send_receive_sysex
```

with children `components` and `controls`. The implementations are in
`_MxDCore/MxDControlSurfaceAPI.pyc` (`object_get_control_names`,
`object_get_control`, `object_grab_control`, `object_release_control`,
`_get_control_or_raise`) and are wired into the `[js]`/`live.object` call table in
`_MxDCore/MxDCore.pyc`.

Three details worth having:

- `_get_control_or_raise` accepts **an id or a name**, and raises
  `"{} is not a control of '{}'"` on a miss. This API *does* report a bad name -
  unusual for Max.
- `LocalControlSurfaceWrapper.grab_control` carries `mxd_grab_control_priority` and
  `suppress_script_forwarding`, so two devices grabbing one control is a case Live
  has thought about.
- `MxDCore` keeps a `GRABBED_CONTROLS_KEY` per device context and walks it in
  `release_device_context`. **Grabs are dropped when the device goes away** - the
  difference between this and a leaked LiveAPI observer.

### 1.2 Finding the surface

Not a fixed path. `control_surfaces` is a **property of `live_app`**, and it reads
as a flat list of `id N` pairs - one per configured control surface slot, including
empty ones (`id 0`). The working sequence, taken from §1.6:

```
[live.path]  path live_app
[live.observer]  property control_surfaces     -> id 0 id 1 id 0 ...
[zl iter 2]                                    -> one "id N" at a time
[live.object]  gettype                         -> type <name>
[sel Push3 Push2 Push Move]
```

**The LOM type names are `Push`, `Push2`, `Push3` and `Move`.** Observing rather than
polling matters: a surface can be plugged in, unplugged or reconfigured while the set
is open, and the observer fires on each.

### 1.3 The control names, and the generation question

Push 1 and Push 2 are **Python remote scripts** on disk
(`Resources/MIDI Remote Scripts/Push/`, `Push2/`, shared base `pushbase/`), so their
elements are named in `pushbase/elements.pyc` and `Push2/elements.pyc`:

```
Button_Matrix              the 8x8 grid
Double_Press_Matrix        Single_Press_Event_Matrix   Double_Press_Event_Matrix
Scene_Launch_Buttons       Track_State_Buttons         Track_Select_Button
Up_Arrow  Down_Arrow  Left_Arrow  Right_Arrow
Shift_Button  Select_Button  Duplicate_Button  Undo_Button  New_Button
Double_Button  Quantization_Button  Fixed_Length_Button  Repeat_Button
Play_Button  Record_Button  Automation_Button  Metronome_Button  Tap_Tempo_Button
Octave_Up_Button  Octave_Down_Button  Accent_Button
Note_Mode_Button  Session_Mode_Button  Device_Mode_Button  Clip_Mode_Button
Browse_Mode_Button  Vol_Mix_Mode_Button  Pan_Send_Mode_Button
Scale_Presets_Button  User_Button  Master_Select_Button  Track_Stop_Button
Global_Mute_Button  Global_Solo_Button  Single_Track_Mode_Button
Create_Device_Button  Create_Track_Button  Foot_Pedal
Swing_Control  Swing_Control_Tap  Master_Volume_Tap  Tempo_Control_Tap
Track_Controls  Track_Control_Touches       (the eight encoders and their touch)
Touch_Strip_Control  Touch_Strip_Tap                              (Push 2)
Page_Left_Button  Page_Right_Button  Setup_Button  Layout  Convert (Push 2)
```

**Push 3 has no remote script.** `Resources/MIDI Remote Scripts/` holds `Push`,
`Push2` and `pushbase` and nothing else Push-shaped; Push 3 is native
(`Resources/Program/Push3.exe`, a separate process). Live's Max bridge handles both:
`_MxDCore/ControlSurfaceWrapper.pyc` defines a `LocalControlSurfaceWrapper` for a
Python `ControlSurface` and a `RemoteControlSurfaceWrapper` for a
`Live.Application.ControlSurfaceProxy`, whose controls are `ControlProxy` objects
with `name`, `id`, `send_value`, `receive_value` and a value listener, built from
`control_descriptions` the hardware hands over. `Push3.exe`'s own `M4lServices`
message set confirms the other end:

```
add_control_description   set_type_name   pad_layout
grab_control  release_control  release_all_controls
send_value    receive_value
subscribe_to_control  unsubscribe_from_control
```

So Push 3's names are declared by the firmware at runtime and appear in no file here.
**But the evidence says they are the same names**: §1.6's device normalises `Push3`,
`Push2` and `Push` to one code path and grabs the literal `Button_Matrix` for all
three. Treat that as strong evidence, not as measurement - confirm it in Stage 1, on
the generation you own.

**`Move` is grabbable by the same API.** Same device, same abstraction, a separate
branch. Out of scope here, worth knowing the door exists.

### 1.4 `live.push` - real, useful, and not takeover

`Resources/Max/resources/docs/refpages/m4l-ref/live.push.maxref.xml`. Digest:
*"Configuration of Push 2 and 3"*. It overrides Push's settings while the device is
selected, or is first in the chain.

| Attribute | What it does |
|---|---|
| `play_pad_map` | `scale` (pads follow the selected scale and tuning) or `serial` (all MIDI notes in order, scale ignored) |
| `play_note_colors` | up to **128 symbols**, one per MIDI note, used when `play_pad_map` is `serial` |
| `play_usage` | `never` / `first_or_selected` / `first` |
| `play_flat_zone`, `play_slide_height`, `play_in_tune_location` | expressive-pad geometry (Push 3 pads only) |

The colours are a **named palette**: `scale_base_note`, `scale_note`,
`non_scale_note`, plus `orange_one`, `orange_one_shade`, `orange_one_shade_two`,
`brown_two`, `brown_two_shade`, `brown_two_shade_two`, `yellow_highlight`, `purple`,
`ocean`, `deep_ocean`, `sky`, `green_green`, `green_green_shade`, `red_red`,
`red_red_shade`, `red_red_shade_two`, `blue_blue`, `light_grey`, `dark_grey`,
`black`, `white`.

And the refpage states the limit:

> *"the positioning of MIDI notes on matrix pads can change according to the
> user-selected layout and the octave up and down buttons on Push, so the assigned
> colors do not necessarily correspond to a specific pad."*

**`live.push` colours NOTES, not PADS.** For a step grid, where pad 3 of row 2 is
step 19 and has no pitch at all, that is the wrong coordinate system. Still worth
having - one box, a few attributes, no protocol - but it is **Route B**, not the
feature.

### 1.5 What the library already gives Push, and must not rebuild

Eight encoders, labelled, banked, automatable, MIDI-mappable, in real units, from one
`surface.ts` - done and shipped ([ARCHITECTURE.md](ARCHITECTURE.md), "Parameters: the
Surface Push reads"), down to the `parameterbanks` registry a page turn reads. What
is missing is the grid.

### 1.6 How a shipping product actually does it

A commercial M4L MIDI effect that ships an optional full takeover was read to find
out which of §1.1's calls a working implementation actually uses, and in what order.
An `.amxd` is an ordinary container - `ampf` / `meta` / `ptch`, patcher JSON in plain
text, the same layout `packages/build/src/amxd.mjs` writes - so this is an afternoon
with a JSON parser.

**What was taken is the sequence of documented Live API calls. No code, no
sequencer logic, no assets.** Everything below is the public API being used as
designed; it is written down here so we can use the same API without a week of
guessing, and the spike in §2 exists to confirm every line of it first-hand.

**The takeover is entirely in the PATCHER.** No `[js]` is involved: that device's
scripts are its sequencer, while the grab is `live.path`, `live.object` and
`live.observer`. That is a real finding for us - it means this is generatable by
`packages/build`, not necessarily wrapper work.

**One reusable `p GrabControl` abstraction, instantiated once per control.** It is
the whole mechanism, in about thirty boxes:

```
[get_control $1] -> [live.object] -> [route get_control]        the control's ID
                                          |
                    +---------------------+---------------------+
                    v                                           v
   [grab_control] / [release_control]                  [live.observer value]
        -> [prepend call] -> [live.object]                      |
                                                    input: <x> <y> <value>
   paint: [prepend send_value] -> [prepend call] -> [live.object]
```

The answers that matter, all four in that diagram:

- **Addressing.** `get_control <name>` returns an **id**; both the grab and the
  observer use that id thereafter. `release_control` accepts it too - a literal
  `release_control id -49` message box is in the file.
- **The whole 8x8 is ONE control.** `Button_Matrix` is grabbed once, not sixty-four
  times.
- **Input arrives as a `live.observer` on the control's `value` property** - not
  through `[js]`, not as MIDI, not on a `[notein]`. Three atoms per event, `<x> <y>
  <value>`, which the device fans into four row receives.
- **Painting is `call send_value <x> <y> <colour>`** on the same object. Colour is a
  palette index; message boxes in the file carry `0` (off), `18`, `29`, `36`. Fixed
  arity, so [MAX-FACTS.md](MAX-FACTS.md)'s `.apply` crash does not apply here - but
  it will the moment anyone builds this message dynamically in `[js]`.

Three details that are the difference between working and nearly working, and would
have cost a week each:

- **Contention is real and is handled by waiting.** `[deferlow]` sits in front of the
  grab, next to a comment reading *"Wait with grabbing to give another instance time
  to release."* At the top level, `[live.thisdevice]` gates everything (our hard rule
  4, independently arrived at) and feeds `[delay 300]` and `[delay 500]` before the
  first grab. Two copies of the device in one set is the normal case, not the edge.
- **Focus is computed, not assumed.** `p IsDeviceSelected` compares `this_device`'s id
  against `live_set view selected_track view selected_device` for *device* focus, and
  compares `live_set view selected_track` against `[zl slice 4]` of this device's own
  canonical path for *track* focus.
- **Every send/receive name is `---` prefixed** (`---surface_id`, `---push_active`,
  `---row1`), which is exactly the per-device expansion
  [MAX-FACTS.md](MAX-FACTS.md) records (`#0` does not expand in an `.amxd`; `---`
  does). Two instances in one set otherwise share every receive.

**And the product shape, from that device's 57 declared parameters:**

```
Enum  Push Takeover   opts=['Off ','On']                 default Off
Enum  Focus Mode      opts=['Device','Track','Always']    default Track
Enum  Note Edit / Accent Edit / Gate Edit / Octave Edit   the value a pad press writes
```

Takeover is **a Live parameter, user-optional, off by default**, and the grab policy
is a *runtime* parameter rather than a build-time constant. And the `*Edit`
parameters are a pattern worth stealing outright: **the grid is the canvas, a
parameter is the brush.** What a pad press *writes* stays automatable and stays on
the encoders, while the pads stay a plain grid.

---

## 2. What is still unknown

Section 1.6 answered most of what the first draft of this plan listed as unknown. What
is left:

| # | Question | Why it matters |
|---|---|---|
| U1 | What does the value observer emit for **press versus release**, and is there **pressure/aftertouch** on the same stream? | §1.6's device carries 18 aftertouch and slide destinations, so expression reaches it somehow - but possibly on the ordinary MIDI note path rather than the grabbed control. Decides whether `pad` carries one value or three. |
| U2 | The **colour palette**: what are all 128 indices, and do they mean the same thing on Push 1, 2 and 3? | Only `0`, `18`, `29`, `36` are attested. A colour table is library data and has to be right. |
| U3 | What does the user **see** during and after a grab, and does releasing restore Live's own mode cleanly? | A device that leaves Push broken after deletion is unshippable. `release_device_context` drops the grab; the *display* is a separate question. |
| U4 | Does `Button_Matrix` resolve on **Push 3**? | Strong evidence yes (§1.3), no measurement. One `get_control_names` settles it. |
| U5 | What is the **repaint budget** - how many `send_value` calls per frame before Live's UI thread suffers? | Decides whether the app can repaint freely or must diff. Assume it must; measure to find out how hard. |
| U6 | Are `Track_Controls` (the encoders) grabbable, and should they ever be? | The answer should be "yes, and no" - grabbing an encoder loses automation and MIDI mapping. Worth confirming so the library can refuse it for a reason. |

### Stage 1 - the confirmation spike

A throwaway device, `push-probe`, in `src/app/`. Small now that the shape is known:

1. Observe `live_app`'s `control_surfaces`; `gettype` each id; post the list.
2. `get_control Button_Matrix` on the Push; post the id. Then `get_control_names` -
   the full vocabulary for whichever generation is plugged in (U4).
3. `grab_control`. Observe the control's `value`. Press, hold, release, press hard;
   post every event (U1).
4. `call send_value x y c` across `c` in 0..127 with a fixed pad; photograph the
   sixteen you care about (U2). Then repaint all 64 in a loop and time it (U5).
5. `release_control`, and watch what Live puts back (U3).

Hard rules apply unchanged: every LiveAPI object is created from
`live.thisdevice`'s bang and never in `loadbang`, recreated unconditionally on
reload; `---` on every send/receive name; nothing leaves through `outlet.apply`.

**GATE: U1-U5 answered, with the console output, in a new
[MAX-FACTS.md](MAX-FACTS.md) section "Grabbing a Push control", and `tmp/` emptied.**

---

## 3. The library extension

### 3.0 Patcher or wrapper - the one design decision §1.6 opens

§1.6 does the whole thing in the patcher. We *could* mirror that exactly, and it
would be generatable from `packages/build/src/chains.mjs` with the `box()`/`line()`
DSL we already have.

**Recommended split, and the reason for each half:**

- **Discovery, grab, release and the value observer: the patcher.** Proven, no `[js]`
  in the timing path, and it keeps working if the browser stalls - the same argument
  the audio chains already win ("the audio path never depends on the browser being
  alive"). A grabbed pad that stops responding because a React render is slow is not
  a controller.
- **Painting: `[js]`.** Sixty-four cells is a frame buffer, and a frame buffer wants
  a diff. `[js]` can hold the last frame, compare, and emit only the changed cells -
  which is also the only answer to U5 if the budget turns out to be tight. The
  patcher cannot diff without sixty-four `[change]` objects.

The inbound path is then `live.observer` -> `[route]` -> `[jweb]`, and the outbound
path is `[jweb]` -> `[js]` -> `call send_value`. Both halves stay in the library.

### 3.1 `defineControls()` - the declaration

The fourth sibling of `defineSurface`, `defineWatch` and `defineFiles`: one thing a
device does, declared once, checks throwing at declaration time so `pnpm build`
fails.

```ts
// src/app/<device>/controls.ts
import { defineControls, grid, button } from "@m4l-jweb/surface";

export default defineControls({
  surface: "push",                 // push | move
  controls: {
    pads:   grid({ role: "matrix", rows: 8, cols: 8 }),
    scenes: grid({ role: "scene_launch", rows: 8, cols: 1 }),
    shift:  button({ role: "shift" }),
    play:   button({ role: "play" }),
  },
});
```

**`role`, not a Max name.** The library owns the role -> name table per generation,
resolves it against `get_control_names`, and **reports a role it could not resolve**
rather than grabbing nothing. Even though §1.3 says the names look identical across
Push generations, the indirection is what lets Move be a second table instead of a
second device. Same argument `CHAIN_IN`/`CHAIN_OUT` already won.

**Takeover and focus are PARAMETERS, not fields here** - §1.6's product shape, and it
is right. `defineControls` implies two generated `surface.ts` entries:

```ts
takeover: toggle({ default: false, short: "Takeovr" }),
focus:    menu({ options: ["Device", "Track", "Always"], default: "Track", short: "Focus" }),
```

so the user can turn it off, automate it, and put it on an encoder - and so a set
with two of these devices does not fight over the grid by default.

Declaration-time checks, in the style of the existing three: a role not in the
vocabulary; a grid whose dimensions do not match its role; two declarations claiming
one role; a key with whitespace, since it becomes a selector; and a role the library
refuses (the encoders - see U6).

### 3.2 The protocol

The id goes in the ARGUMENTS, never baked into the selector (`sync_state <id> <json>`,
never `sync_state_<id>` - the rule and its scar are in [CLAUDE.md](../CLAUDE.md)):

```
in  (Max -> app)   pad <control> <x> <y> <value>       from the value observer
                   controls_ready <n> <name> ...       resolved roles, at grab time
                   controls_lost <reason>              released, or focus moved away

out (app -> Max)   paint <control> <x> <y> <color>     one cell
                   paint_all <control> <b64>           the whole grid, one message
```

`paint_all` is the design, not an optimisation: sixty-four messages a frame through
`[jweb]` into `[js]` is a data plane, and [TODO.md](TODO.md)'s first rule is that
`[js]` is a control plane. One base64 blob per repaint, diffed in `[js]` against the
last frame, only changed cells sent onward (§3.0).

`tests/protocol.test.mjs` covers it for free once the selectors are in `CONTROLS_IN`
/ `CONTROLS_OUT` in `@m4l-jweb/bridge`.

### 3.3 The app side

```ts
const pads = usePads(controls, "pads");
pads.onPress((x, y, value) => { ... });
pads.paint(x, y, "red");            // batched; flushed once per frame
```

Backed by one store per control, like `useParam` - the bridge holds one handler per
selector, so two components binding the same grid would leave one permanently stale.

Colours are **named in the app and resolved to palette indices in the library**, from
U2's table. A device that writes `36` is a device nobody can read.

### 3.4 The Max side

A `takeover` chain in `packages/build/src/chains.mjs` emitting the §1.6 shape:
`live.path live_app` -> `live.observer control_surfaces` -> `zl iter 2` ->
`gettype` -> `sel Push3 Push2 Push Move`, then one GrabControl-equivalent per
declared role, gated on the `takeover` parameter and on a focus comparison built from
`this_device` / `live_set view selected_track view selected_device`.

Three things it copies from §1.6 because they are not optional:

- `[live.thisdevice]` gates the whole thing, and the first grab is deferred
  (`[deferlow]`, and a delay) so another instance can release first.
- every send/receive name carries the `---` prefix.
- release is explicit as well as automatic, so a mode-switching device can hand the
  pads back without being deleted.

Painting lives in a new `packages/wrapper/src/controls.ts`, concatenated like the
rest: ES5, `var` and `function`, `Task` not `setTimeout`, `post()` not `console`. It
holds the last frame, diffs, and calls `send_value` at fixed arity.

### 3.5 `live.push`, as its own smaller thing

Independent of all the above, and worth shipping even if Stage 1 goes badly:

```ts
push: { padMap: "serial", noteColors: [...], usage: "first_or_selected" }
```

in `defineSurface`'s `layout`, compiling to one `live.push` box. A handful of lines in
`packages/build/src/surface.mjs`, no new protocol. **Ship this first.**

### 3.6 The harness is what makes this developable

`@m4l-jweb/surface/dev` already renders a mocked Live beside the app - transport,
Surface controls, Push encoder preview, message log. Add **an 8x8 grid of divs** that
paints from `paint`/`paint_all` and sends `pad` on click, and a grid device is
buildable in a browser tab with no hardware in the room.

Not a nice-to-have here the way it was for parameters. Without it, every iteration is
a rebuild, a reinstall, a re-drag (Live embeds a copy of the device in the set, so
instances already on tracks do not update) and a squint at sixty-four LEDs. **Build
the mock grid before the first real device.**

The honest limit is the harness's usual one: the message-level contract, not pad
latency, not aftertouch curves, not what Live's own display does while a grab is held.

### 3.7 What must not happen

- **No new device type, no fork, no `[node.script]`.**
- **The Surface stays the Surface.** Encoders remain declared parameters. A grabbed
  encoder loses automation, MIDI mapping and its automation lane - everything the
  parameter path was built for. Grab the *grid*; leave the knobs alone (U6).
- **No device-specific vocabulary in `packages/`.** The library ships grids, buttons,
  roles and colours. "Step page" is a device's business.

---

## 4. Consumer 1 - `circuit-push`, the Circuit Tracks emulation

A Novation Circuit Tracks, played on a Push. Source for the behaviour:
`../trackster/doc/circuittracks/circuit-tracks-guide.md`, a digest of the v3 user
guide. `../trackster` is a web app and shares no code with this - only the documented
behaviour of the hardware.

**Why it is the right first consumer:** the Circuit is *the* 8x8-grid instrument. Its
whole interface is thirty-two step pads, sixteen performance pads, eight macros and a
shift key. It maps onto Push nearly one-to-one, it exercises every part of the new
API, and the target behaviour is written down rather than invented - which makes a
failure a bug instead of a difference of opinion.

### The mapping

| Circuit | Push |
|---|---|
| 8 macros | **the eight encoders - the existing Surface, unchanged** |
| 32 steps (2 pages of 16) | grid rows 1-2, with the `1-16 / 17-32` toggle on a side button |
| 16 performance pads (keyboard / drum pads) | grid rows 3-4 |
| Track buttons (Synth 1/2, MIDI 1/2, Drum 1-4) | one grid row, or the scene-launch column |
| View buttons (Note, Velocity, Gate, Pattern Settings, Scales, Patterns, Mixer, FX, Preset) | a mode row, plus `Shift` for the secondaries the Circuit prints under each |
| Shift | Push's `Shift` |
| Play / Record | Push's transport |

Nine views, each a different meaning for the same sixty-four pads: **a view is a pure
function from device state to a 64-cell colour buffer, plus a press handler.** Exactly
the shape a Web Worker wants ([ARCHITECTURE.md](ARCHITECTURE.md), pattern 2), and
exactly the shape the mock grid drives.

And from §1.6: the *edit* values - which note, which accent, which gate length a pad
press writes - are **parameters**, not app state. That is what keeps the Circuit's
step editing automatable and on the encoders where the Circuit itself puts it.

### What it is not

**No sound of its own, and no sample management.** The Circuit's synths, its 64
samples and its packs are out of scope - `../trackster` does the file side, on a real
SD card. This device is the *sequencer and the surface*: it emits MIDI (the `midiout`
chain) and writes clips (`writeClip`), and whatever instrument follows it on the track
makes the noise. The React UI is a mode readout and a settings panel; the device view
is 169 px tall and does not scroll.

### Staging

| Stage | What | Gate |
|---|---|---|
| C1 | One view: 16 steps on two rows, toggled by press, painted. `midiout` fires them against the transport tick. | A four-on-the-floor kick, entered on Push, in time. |
| C2 | Note view proper - bottom two rows as a scale keyboard, `live_set` `scale_name`/`root_note` via `defineWatch`, octave buttons. | Playing in key, and the scale follows Live's own. |
| C3 | The view system: Note / Velocity / Gate / Pattern Settings, `Shift` for the secondaries (Expand, Fixed, Micro Step, Probability). | Every view paints and reads back; `Shift` is not sticky where it should not be. |
| C4 | Patterns (8 per track), chaining, Mixer-view mutes, Scenes. State in `state()` slots so it saves with the set. | A set closed and reopened comes back with its patterns. |
| C5 | The eight macros as the Surface - two banks, real units, `short` under 8 characters. | Automation recorded from a macro plays back. |

C5 is last on purpose: it is the part that is already built.

**And one test C1 must include, from §1.6:** two instances of the device in one set.
Contention is the normal case, the `---` prefix and the deferred grab are what handle
it, and a bug there is invisible with one device on the desk.

---

## 5. Consumer 2 - `qobuz-dj` on the pads

`../m4l-qobuz-dj` is a two-deck DJ mixer, scaffolded, nothing loaded in Live yet (its
own `doc/PLAN.md`, stage 0 of 7). Its stage 5 is "Push", and today that means *check
the encoder labels*.

Takeover would make it a **controller** rather than a device with knobs.

| Grid region | What |
|---|---|
| rows 1-2 | Deck A hot cues (8) and loop lengths (1/4 .. 8 bars) |
| rows 3-4 | Deck B, the same |
| rows 5-6 | beat jump, reverse, censor, per deck |
| rows 7-8 | the loaded crate, one pad per track, coloured by key or BPM |
| scene column | deck load / cue / sync |

The encoders stay parameters - EQ, filter, trim, pitch - because those must automate
and MIDI-map, and that is what the Surface is for.

**It stays second.** That project's own gates come first: its stage 1 CORS spike, and
the memory question in its stage 2 (a decoded 10-minute FLAC is ~210 MB in the
AudioContext; two decks plus a preload is over half a gigabyte inside a Chromium
context inside Live). Pads on a mixer that has never made a sound are decoration.

The one thing worth doing *now* is negative: nothing in `defineControls` should assume
the grid belongs to a sequencer. The Circuit device will push hard in that direction,
and a DJ layout is the cheapest available check that the API did not follow it.

---

## 6. Order of work

```
  1. live.push in defineSurface           small, independent, ships on its own
  2. Stage 1 spike                        confirms §1.6 in Live; the gate for the rest
  3. the mock 8x8 grid in the harness     before any device
  4. defineControls + the takeover chain  the library extension
  5. circuit-push, C1..C5                 the consumer that proves it
  6. qobuz-dj pads                        after that project's own stage 4
```

Steps 1 and 2 are independent. **Nothing below step 2 starts until its gate is met.**

---

## 7. Where to read the names, when a name is needed

Never from memory, and never from a model. Under `C:\ProgramData\Ableton\`:

```
Resources\Max\resources\docs\refpages\m4l-ref\          live.push, live.banks, parameters
Resources\Max\resources\docs\userguide\content\m4l\     the LOM overview
Resources\MIDI Remote Scripts\_MxDCore\                 the LOM's own implementation
Resources\MIDI Remote Scripts\pushbase\                 Push 1/2 element names
Resources\MIDI Remote Scripts\Push2\                    Push 2's additions
Resources\Program\Push3.exe                             Push 3's M4lServices protocol
```

The `.pyc` files are Python 3.11 bytecode and do not decompile with a newer
interpreter, but their string constants come out of a plain byte scan, and that is
where the names in §1.3 came from. `Push3.exe` yields its protocol through its C++
symbol names. A third-party `.amxd` is an ordinary container and its patcher JSON is
plain text - which is how §1.6 was read, and it is a legitimate way to learn **which
documented calls** a device makes.

**And when the name matters, ask the object.** `get_control_names` returns the truth
for the surface actually plugged in, `_get_control_or_raise` errors on a bad one, and
no file on disk can tell you what a Push 3 declared this morning.
