# M4L-JWEB: what is left to do

The backlog for the library itself - things any device built on M4L-JWEB could use, not
one device's business logic. **Only open work lives here.** Shipped work is recorded
elsewhere: **what the library does** in [README.md](../README.md), **how and why** in
[ARCHITECTURE.md](ARCHITECTURE.md), and **what was measured on hardware** in
[MAX-FACTS.md](MAX-FACTS.md).

Device designs are not here either. The pad use cases live in
[PUSH-USECASES.md](PUSH-USECASES.md), and this file links to them.

Two rules everything here follows:

- **`[js]` is a control plane, not a data plane.** Bulk data travels via disk, never
  through Max messages.
- **Gate every unknown behind a cheap spike** that can fail in an afternoon rather than a
  week.

**The order is priority order.** Item 1 is the next thing to do.

A third rule, learned the expensive way in 0.9.9: **re-check a premise before designing
around it.** The biggest item this file ever carried was "a page cannot put audio on a
track, so we need a C++ external". It was false about the object we were already using.
Four routes were analysed and one was fully built before anyone checked. That postmortem
now lives in
[ARCHITECTURE.md](ARCHITECTURE.md#the-native-audio-bridge-four-routes-and-the-object-that-replaced-them),
because it is settled history rather than work.

---

## 1. The pads as a surface you program

**Built, and confirmed working on hardware.** `defineControls` ships, `push-snake` runs in
Live on a Push 3 - grid, HUD, sprint, music, state, the lot - and the checklist that could
only be run with the hardware in the room has been run. The jog wheel is answered too. How it fits together is in [ARCHITECTURE.md](ARCHITECTURE.md), "The pads: a control
surface you program". What was measured is in [MAX-FACTS.md](MAX-FACTS.md), "Grabbing a
Push control".

Two things are still open, and neither blocks anything. Both are questions the
hardware has to answer, and both have the machinery to ask already built. A third, 1c,
is on this list by accident and should probably go.

### 1a. Where the touch strip's position lives

**Answered:** the jog wheel works. Grabbed, `Jogwheel` streams continuously and reports a
DELTA of one detent as a signed 7-bit step - 1 clockwise, 127 anticlockwise, one event per
detent. A device integrates them itself, and the DJ platter in
[PUSH-USECASES.md](PUSH-USECASES.md) is buildable.

**Answered in the negative:** `Touch_Strip_Control` also streams, but its `value` is a byte
counting in steps of 64 and wrapping - four distinct values over 180 events. The direction
of travel is recoverable from the wrapped difference; the position is not. That is a
relative control, not the ~64-step fader the crossfader wanted. Both are measured in
[MAX-FACTS.md](MAX-FACTS.md).

**Still to do:** find the control that carries the strip's absolute position, or establish
that none does. `get_control_names` lists `Nav_Select_Touch` and
`Mpe_Pitch_Bend_Elements`; neither has been read. `probe_other <name> 1` in `push-probe`
grabs any control by name, dumps its atoms and says whether the trace looks like a delta or
a position, so this is one button press per candidate.

**What it costs if it stays open:** the DJ crossfader, and nothing else. Every other
use case in [PUSH-USECASES.md](PUSH-USECASES.md) is buildable today.

### 1b. Naming the 128 palette indices

`PUSH_PALETTE` ships 23 names in `@m4l-jweb/surface`, read off two photographs of the
palette pages through a camera at one white balance. `push-snake` runs on them, so they
work; they are not a table anybody measured.

**Answered:** the palette is not a structure. A Push 2 scheme described it as four greys at
0-3 then fourteen hues every four indices from 5, which would have made the table a formula.
Painted on a Push 3 and photographed with an orientation marker, it fails twice: index 2 is
a red and index 3 an orange, so there is no grey block, and 33-57 is one pale pastel region
rather than a second hue ladder. Every index the photographs already named came back as
that colour. Written up in [MAX-FACTS.md](MAX-FACTS.md), "The Push 2 colour scheme does not
describe a Push 3".

Three consequences, all of which shrink the work rather than grow it:

- The two Push 2 sources ([Ableton/push-interface](https://github.com/Ableton/push-interface),
  the [push2_display crate](https://crates.io/crates/push2_display/0.2.0/code/)) describe
  different hardware and cannot name a Push 3 index. Nothing to read there.
- There is no formula to generate. The table is a list.
- It is one table per generation, not one table.

**Still to do, in order:**

1. **Find a grey.** None of the 23 names is one, which is why `push-snake`'s wall is `tan`,
   and the Push 2 scheme's claim that 1 and 2 are greys is now known false. A wall, a
   grid line and a dimmed pad all want one, and no index is known to be one.
2. **Shoot both `probe_palette` pages under one known white balance and sample them.**
   Page 0 is self-orienting: index 0 is off, so the only dark pad is the top-left one.
   The paint path's coordinates are confirmed correct end to end by the `struct` button's
   L marker, so a photograph of either page can be trusted to be the right way up.
3. **Write the names out.** Use Ableton's own vocabulary where it fits rather than
   inventing one: `live.push`'s note colours are a named palette shipped by Live -
   `red_red`, `red_red_shade`, `red_red_shade_two`, `ocean`, `deep_ocean`, `sky`,
   `light_grey`, `dark_grey`, `black`, `white`, `yellow_highlight`. It maps symbols to
   notes rather than to pad indices, so it cannot shortcut the sampling, but the names
   and the `_shade` suffixes are the ones Ableton uses for this hardware.

Two indices are named that were not: **1 is pink, 17 is cyan.** Neither is in
`PUSH_PALETTE` yet - `pink` there is already index 26.

**What it costs if it stays open:** nothing is blocked. A device picks from 23 working
names and cannot say "grey".

### 1c. `live.push` in `defineSurface` - no consumer, probably delete

**This is not work anybody asked for.** It entered the plan as a CORRECTION: a brief
claimed `live.push` was "an abstraction for talking to the pads", which is false, and the
section proving it false was later carried into this backlog as an item. No device wants
it and none is planned.

What it does: `live.push` configures Push's own note mode - `play_pad_map`
(`scale` or `serial`), `play_note_colors` (up to 128 symbols, one per MIDI note),
`play_usage` (`never` / `first_or_selected` / `first`), and the expressive-pad geometry.
Its consumer would be a device that KEEPS Push's note path and restyles it, which is the
opposite of takeover - takeover claims `Button_Matrix` and takes the pads off the note
path entirely. Its own refpage disowns the pad coordinate anyway: the note-to-pad
positions change with the user's layout and octave buttons, so the colours are not pinned
to pads.

The fact worth keeping is the disclaimer, and it is already in
[PUSH-USECASES.md](PUSH-USECASES.md) under "What it is not". Delete this item unless a
device turns up that wants it.

---

## 2. Rename the project to `m4l-patchboard`

**Nothing blocks this any more.** The headless target was the gate, and it shipped in
1.6.0: `target: "headless"` emits only the `[js]` wrapper and the patcher - no `[jweb]`, no
HTML payload, no Chromium - and `hello-headless` is the device that proves it. How the seam
works is in [ARCHITECTURE.md](ARCHITECTURE.md), "Targets: where a device's logic runs".

It waits behind item 1 by choice, not by need: the pad work has loose ends worth closing
while it is fresh, and a rename in the middle of them would make every one of those
commits harder to read. Merge 1.6.0, close what is worth closing in item 1, then rename.

**The name is now wrong, and measurably so.** `m4l-jweb` says what the library was when it
was one thing: a bridge to `[jweb]`. The web half is now optional - a device declares its
interface in TypeScript and the build emits `[js]` and a patcher, with or without a
Chromium page. So the name describes a COMPONENT rather than the project, and names one
that `hello-headless` does not contain at all. `m4l-patchboard` says what it actually is:
a generic Max for Live development framework in TypeScript.

Do it in one commit, and now rather than later. A rename is cheap while the reason for it
is visible, and expensive to explain afterwards. What it touches, so nobody rediscovers it
in the middle:

- the four published packages (`@m4l-jweb/{bridge,surface,build,wrapper}`), which are on
  npm. This is a new SCOPE and a major version, not a rename of existing packages. The old
  scope stays up, deprecated, pointing at the new one.
- the `m4l-jweb` CLI binary, and `m4l-jweb init`'s scaffold, which writes the scope into
  every generated `package.json`.
- the payload and window filename prefixes the wrapper extracts next to the `.amxd`. They
  are per-device, but some device repos carry the library name in their path.
- the repo, its docs, and the two device repos that use it - `../m4l-gugelhupf` and
  `../m4l-qobuz-dj`.
- as part of this process, we will carve out the mini game, "push-snake", under its own separate,
  m4l-patchboard compatible-scaffolded separate project, under ../m4l-push-games. This will be a new
  separately buildable project with separate pipeline just for push based minigames structured
  like current push-snake. It needs to carve out also the necessary pipeline elements
  The project needs to have room for new games planned in the future (like push-tetris, etc, not
  yet detailed enough)

The one thing NOT to rename with it: `doc/MAX-FACTS.md`'s contents. Those measurements are
about Max, not about this library, and they outlive both names.

---

# Next: a VST3 backend, so a device runs outside Live

**Not a backlog item.** It is what this library could become NEXT, and it is written down
here so the shape is not re-derived from scratch by whoever picks it up - possibly as a
separate project rather than as work on this one.

Assessed in [FEAT-PATCHBOARD-VST3.md](FEAT-PATCHBOARD-VST3.md): the app, the bridge, the surface
and the harness port; the LiveAPI wrapper does not. **One repo, not a fork** - the
shared traps *are* the product, and a fork would have to re-learn every one of them
recorded in [MAX-FACTS.md](MAX-FACTS.md).

Its first step is a `Target` seam extracted from `packages/build` while there is still
only one target, which is worth doing on its own merits and is the only part of it that
belongs in this repo today.
