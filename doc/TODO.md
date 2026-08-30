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

Three things are still open, and none of them blocks anything:

### 1a. The touch strip has no readable position

**J1 is answered and the jog wheel works.** Grabbed, `Jogwheel` streams continuously and
reports a DELTA of one detent as a signed 7-bit step - 1 clockwise, 127 anticlockwise, one
event per detent. A device integrates them itself. The DJ platter in
[PUSH-USECASES.md](PUSH-USECASES.md) is buildable.

**J2 is answered in the negative.** `Touch_Strip_Control` also streams, but its `value` is
a byte counting in steps of 64 and wrapping: four distinct values over 180 events. The
direction of travel is recoverable from the wrapped difference; the position is not. That
is a relative control, not the ~64-step fader the crossfader wanted.

Both are measured in [MAX-FACTS.md](MAX-FACTS.md).

What is left is one question, and it is not scheduled: **where the strip's real position
lives.** `get_control_names` lists `Nav_Select_Touch` and `Mpe_Pitch_Bend_Elements` and
nobody has read either. `probe_other <name> 1` in `push-probe` grabs any control by name,
dumps its atoms and says whether the trace looks like a delta or a position.

### 1b. The colour table is photographs, and there is a better source

`PUSH_PALETTE` ships about 23 names, read off two photographs of the palette pages through
a camera at one white balance. Index 0 = off is measured. Nothing else is. No grey is
named because none was identified, which is why `push-snake`'s wall is `tan`.

**A Push 2 scheme turned up, and it is a STRUCTURE rather than a list**
([sonicbloom](https://sonicbloom.net/ableton-live-tutorial-create-your-own-colour-scheme-for-ableton-push/)):

```
BLACK 0   DARK_GREY 1   GREY 2   WHITE 3
RED 5   AMBER 9   YELLOW 13   LIME 17   GREEN 21   SPRING 25   TURQUOISE 29
CYAN 33   SKY 37   OCEAN 41   BLUE 45   ORCHID 49   MAGENTA 53   PINK 57
```

Four greys, then fourteen hues **every four indices from 5**. The `.highlight()` and
`.shade(n)` in that API are the other three indices in each group of four. If it holds,
the table stops being 23 photographed guesses and becomes a formula: 14 hues x 4
brightnesses, named and generated.

**It contradicts what was measured here.** The photographs put pure red at index **2**,
where this scheme puts GREY. One of the two is wrong, and there are only two ways it can
be: the Push 3 palette is not the Push 2 one, or the photographs were read a row out.
Both are cheap to settle and neither has been.

Two more sources, both Push 2 and neither read yet:
[Ableton/push-interface](https://github.com/Ableton/push-interface) (Ableton's own, so
check its licence before lifting a table out of it - a measured fact is a fact, a copied
table is a copied table) and the
[push2_display crate](https://crates.io/crates/push2_display/0.2.0/code/).

**The plan, in order, and each step can kill the one after it:**

1. **Test the structure, not the values.** Paint index 5, 21 and 41 on three pads with
   `probe_paint`. If they are red, green and ocean, the Push 2 scheme holds on a Push 3
   and steps 2 and 3 are unnecessary - go to 4.
2. **If it does not hold, re-shoot the photographs with an orientation marker.** The
   current ones are ambiguous about which corner is index 0, and that is exactly the error
   that would put red at 2 instead of 5. `probe_palette` paints `base + y*8 + x` with y
   from the TOP; painting a known asymmetric marker first makes a misread impossible.
3. **Only then read the two repos**, to name what the photographs show rather than to
   replace them.
4. **Generate the table rather than list it.** `hue(name, brightness)` beats 23 constants,
   and it is what makes `.shade()` and `.highlight()` expressible.

**And the question that decides whether this is one table or three:** whether an index
means the same colour on a Push 1, 2 and 3. Every source above is Push 2. Everything
measured here is Push 3. Nobody has held both.

### 1c. `live.push` in `defineSurface` - separate, droppable

`live.push` configures Push's own note mode: `play_pad_map`, `play_note_colors`,
`play_usage`, and the expressive-pad geometry. It colours **notes, not pads**, so it cannot
address a step grid and shares nothing with the above. One box, a few attributes, no
protocol, no risk. Ship it separately, or not at all.

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
  separately buildable project with separate pipeline just for push based minigames

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
