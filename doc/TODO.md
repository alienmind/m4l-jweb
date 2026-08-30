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

## 1. The touch strip has no readable position

**This is the only thing left in the pad work, and it is what blocks a release.**

Everything else about the takeover ships and is confirmed on a Push 3 in Live:
`defineControls`, `push-snake` end to end, the grid, the HUD, the music, the jog wheel,
and now the colours. How it fits together is in [ARCHITECTURE.md](ARCHITECTURE.md), "The
pads: a control surface you program"; what was measured is in
[MAX-FACTS.md](MAX-FACTS.md), "Grabbing a Push control".

**What is wrong.** `Touch_Strip_Control` streams while grabbed, but its `value` is a byte
counting in steps of 64 and wrapping - four distinct values over 180 events. You can
recover the DIRECTION of travel from the wrapped difference. You cannot recover WHERE the
finger is. So a device can be told the strip moved up, and never told to what.

That is a relative control. The DJ crossfader in [PUSH-USECASES.md](PUSH-USECASES.md)
needs an absolute one - a ~64-step fader - and cannot be built on this.

For contrast, the jog wheel is fine and needs nothing: `Jogwheel` reports a delta of one
detent as a signed 7-bit step (1 clockwise, 127 anticlockwise, one event per detent) and
a device integrates them itself. Both are measured in [MAX-FACTS.md](MAX-FACTS.md).

**What to do, in order:**

1. **`probe_other Nav_Select_Touch 1`** in `push-probe`, slide a finger up the strip, read
   the log. It says whether the trace looks like a delta or a position.
2. **`probe_other Mpe_Pitch_Bend_Elements 1`**, same. This is the other name
   `get_control_names` lists that nobody has read.
3. If neither carries a position, **say so in [MAX-FACTS.md](MAX-FACTS.md) and delete the
   crossfader from [PUSH-USECASES.md](PUSH-USECASES.md).** A use case that cannot be built
   is worse than no use case, and the strip is then a two-way switch: a device reads
   direction and nothing more.

One button press per candidate, and the machinery is already built and shipped. Nothing
else in [PUSH-USECASES.md](PUSH-USECASES.md) is waiting on it.

## 2. Rename the project to `m4l-patchboard`

**Nothing blocks this any more.** The headless target was the gate, and it shipped in
1.6.0: `target: "headless"` emits only the `[js]` wrapper and the patcher - no `[jweb]`, no
HTML payload, no Chromium - and `hello-headless` is the device that proves it. How the seam
works is in [ARCHITECTURE.md](ARCHITECTURE.md), "Targets: where a device's logic runs".

It waits behind item 1 by choice, not by need: item 1 is two button presses and a note,
and a rename in the middle of them would make those commits harder to read. Merge 1.6.0,
answer the touch strip, then rename.

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

---

# Parked

Things that were on this list and are not work any more. Kept so nobody rediscovers them
and starts over.

**The pad colour table.** It was 23 names read off two photographs, with no grey, and a
plan to re-shoot and sample them. Done, and not that way: Live holds the palette on disk -
`Program/Push/python/Push2/colors.pyc`, `COLOR_TABLE`, 128 entries - and it now ships as
`PUSH_PAD_RGB` in `@m4l-jweb/surface`, with `PALETTE_CSS` derived from it. It found a live
bug (`white` was index 69, `#5D1700`, a dark brown - page 1 of the photographs had been
read 180 degrees out) and the greys that were never missing, only at the far end of the
table. Written up in [MAX-FACTS.md](MAX-FACTS.md), "Live holds the pad palette, and the
photographs were a page upside down".

**A Push 2 colour scheme as a formula.** Four greys at 0-3 then fourteen hues every four
indices from 5, which would have made the table generated rather than listed. Painted on a
Push 3 and photographed: it is a DEFAULT MAP that Live replaces, not a property of the
hardware, and it does not describe a Push 3. The two Push 2 repos
([Ableton/push-interface](https://github.com/Ableton/push-interface), the
[push2_display crate](https://crates.io/crates/push2_display/0.2.0/code/)) describe
different hardware. Nothing to read there.

**`live.push` in `defineSurface`.** Never requested. It entered the plan as a CORRECTION -
a brief claimed `live.push` was "an abstraction for talking to the pads", which is false -
and the section proving it false was carried into this backlog as though it were work. The
object configures Push's own note mode (`play_pad_map`, `play_note_colors`, `play_usage`),
so its consumer would be a device that KEEPS Push's note path and restyles it, which is the
opposite of takeover. Its own refpage says the note-to-pad positions move with the user's
layout and octave buttons, so the colours are not pinned to pads anyway. The disclaimer
worth keeping is already in [PUSH-USECASES.md](PUSH-USECASES.md) under "What it is not".
