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

**The order is priority order.** Item 1 is the next thing to do, and right now it is the
only open item.

A third rule, learned the expensive way in 0.9.9: **re-check a premise before designing
around it.** The biggest item this file ever carried was "a page cannot put audio on a
track, so we need a C++ external". It was false about the object we were already using.
Four routes were analysed and one was fully built before anyone checked. That postmortem
now lives in
[ARCHITECTURE.md](ARCHITECTURE.md#the-native-audio-bridge-four-routes-and-the-object-that-replaced-them),
because it is settled history rather than work.

---

## 1. Rename the project to `m4l-patchboard`

**Nothing blocks this any more.** The headless target was the gate, and it shipped in
1.6.0: `target: "headless"` emits only the `[js]` wrapper and the patcher - no `[jweb]`, no
HTML payload, no Chromium - and `hello-headless` is the device that proves it. How the seam
works is in [ARCHITECTURE.md](ARCHITECTURE.md), "Targets: where a device's logic runs".

The pad work that was ahead of it is finished, so this is the next thing to do. Merge
1.6.0, then rename.

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

**The touch strip as a fader.** The DJ crossfader in
[PUSH-USECASES.md](PUSH-USECASES.md) wanted an absolute ~64-step position off the strip.
There is not one, anywhere. `Touch_Strip_Control` reports four values on a loop - a byte
counting in 64s and wrapping - which gives direction and no position, and the two controls
that might have carried the real reading, `Nav_Select_Touch` and `Mpe_Pitch_Bend_Elements`,
both resolve to ids and report nothing at all while a finger slides the strip. Measured one
control at a time on a Push 3 in note mode; written up in [MAX-FACTS.md](MAX-FACTS.md),
"The touch strip reports a WRAPPING BYTE, not a position". The crossfader is the `xfader`
encoder, and PUSH-USECASES says so. The jog wheel, which was the other half of that
question, works and needs nothing.
