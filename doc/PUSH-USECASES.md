# PUSH-USECASES.md - what the programmable pads are FOR

Three devices, in detail, written against the pad-takeover API. **This file is design.
It is not a schedule and not evidence.**

- **The schedule** is [TODO.md](TODO.md): what is built, in what order, and what is
  still gated. One backlog, and this is not it.
- **The evidence** is [MAX-FACTS.md](MAX-FACTS.md), "Grabbing a Push control": how a Push
  control is really grabbed, painted and read, measured on hardware. Nothing here repeats
  a mechanism. Where a use case leans on one, it links.

**Only the first was built.** `push-snake` is the device that proves the surface works,
and it exists. The other two are **design pressure on the API**: an API shaped around one
game is an API that fits one game, and the cheapest guard against that was two more
devices that want incompatible things. They did their job - the `padStream()` shape and
the rule that a non-matrix control may be claimed without the grid are both here because
use case 2 asked for them. Do not build them.

## Why the pads

M4L-JWEB already gives a device eight Push encoders. Declare a parameter in
`surface.ts` and it is on the hardware: labelled, banked, automatable, MIDI-mappable
([ARCHITECTURE.md](ARCHITECTURE.md), "Parameters: the Surface Push reads").

**It gives you nothing on the 8x8 grid.** Sixty-four RGB pads, the scene column, the
transport and the mode buttons all belong to Live. A device can neither read them nor
light them. Closing that is one line:

> **`grid.draw()` and `grid.onPad()` in TypeScript, and sixty-four pads on the hardware
> do what your device says.**

A frame buffer you paint and an event stream you handle, from the same React app that
draws the device view - so a sequencer, a game, a DJ deck or a scale explorer is a page
of ordinary TypeScript that happens to run on a piece of hardware instead of a screen.

### What it is not

- **Not a replacement for the Surface.** Encoders stay Live parameters. They ARE
  grabbable, and grabbing one stops it moving anything - which costs automation, MIDI
  mapping and its automation lane. Grab the grid; leave the knobs alone.
- **Not `live.push`.** That object configures Push's own note mode and colours *notes,
  not pads*, so it cannot address a step grid. Worth shipping separately; it is its own
  [TODO.md](TODO.md) item.
- **Not always on.** Takeover is a Live parameter the user can switch off, defaulting
  off, with a focus policy beside it. A device that seizes the pads of every set it
  lands in is a device people uninstall.

### Claiming the matrix stops the pads playing notes

**Claiming `Button_Matrix` takes the pads off the note path.** No MIDI notes and no MPE
expression until it is released. The grabbed control carries only press and release, with
a velocity: no pressure, no slide, and no event when a finger moves across pads.

Claiming a non-matrix control - the scene column, the jog wheel, the touch strip - costs
nothing on the note path.

All measured, all in [MAX-FACTS.md](MAX-FACTS.md). It is why the DJ surface below was
redrawn, and why the scale explorer is harder than it looks.

---

## The API

**BUILT.** The sketch below is what was designed; three names moved on the way in, and
the shipped shape is in [ARCHITECTURE.md](ARCHITECTURE.md), "The pads: a control surface
you program", with the reference in `packages/surface/src/controls.ts`:

- `button({ role })` is **`padButton({ role })`** - `button()` already belongs to
  `defineSurface`, as the `live.text` parameter, and a device declaring both would
  import two different things under one word. There is a third shape too,
  `padStream()`, for a jog wheel or a touch strip.
- The declaration is passed to **`defineSurface({ controls })`** rather than standing
  beside it, because it CONTRIBUTES the two parameters below - and a parameter has to
  be in the surface for the codegen to emit its object, for Push to page it, and for
  `useParam` to bind it.
- The colours are **names the palette can actually point at**. `dark_grey`,
  `red_red` and `yellow_highlight` are not among them: the table is read off
  photographs and no grey was identified.

The use cases were written against it before it existed, which is the point: a use case
that cannot be expressed here is a hole in the API, found on paper instead of in Live.
The two below are still design pressure and still not scheduled.

### Declaring what a device claims

The fourth sibling of `defineSurface`, `defineWatch` and `defineFiles` - one thing a
device does, declared once, checks throwing at declaration time so `pnpm build` fails
rather than the hardware going quiet.

```ts
// src/app/<device>/controls.ts
import { defineControls, grid, button } from "@m4l-jweb/surface";

export default defineControls({
  surface: "push",                                   // push | move
  controls: {
    pads:   grid({ role: "matrix", rows: 8, cols: 8 }),
    scenes: grid({ role: "scene_launch", rows: 8, cols: 1 }),
    shift:  button({ role: "shift" }),
    play:   button({ role: "play" }),
  },
});
```

**`role`, never a Max name.** The library owns the role -> name table per generation
and resolves it at runtime against `get_control_names`, then **reports a role it could
not resolve** instead of grabbing nothing. Push 1/2/3 appear to share names (measured - see [MAX-FACTS.md](MAX-FACTS.md));
Move does not; and [CLAUDE.md](../CLAUDE.md)'s first hard rule is that a wrong name
Max looks up is not an error, it is a feature that silently does nothing.

Checks that throw at declaration time: a role outside the vocabulary; a grid whose
dimensions do not match its role; two declarations claiming one role; a key with
whitespace (it becomes a selector); and a role the library refuses - the encoders,
for the reason in the opening.

### Paint

```tsx
const pads = usePadGrid(controls, "pads");    // 8 x 8

pads.draw((f) => {
  f.clear("black");
  f.set(3, 4, "green");
  f.row(0, "dark_grey");
  f.rect(0, 6, 4, 2, "ocean");
});
```

`draw` takes a **frame**, not a pad. You describe the whole grid every time and the
library works out what changed. The callback fills an off-screen 64-byte buffer, that
buffer is diffed against the last one sent, and only the changed cells reach the
hardware.

This is the contract, not an optimisation you can ignore. Sixty-four messages a frame
across the bridge is a data plane, and [TODO.md](TODO.md)'s first rule is that `[js]` is a
control plane.

So a device redraws as often as it likes - every animation frame, every tick, every state
change - and pays only for the pads that moved. A blinking cursor costs one cell per
blink.

Colours are **names**, resolved to hardware palette indices by the library. A device
that writes `36` is a device nobody can read, and the index is not portable across
generations until [MAX-FACTS.md](MAX-FACTS.md) says it is.

### Read

```tsx
pads.onPad((e) => {
  // e: { x, y, value, down }
  if (!e.down) return;
  turn();
});
```

`x` is 0-7 left to right, `y` is 0-7 **bottom to top** - the Push's own orientation, and
the one every layout in the use cases below is written in. `value` is the raw value from the
hardware (velocity on a press, 0 on release); `down` is `value > 0`, precomputed
because that is the check nine handlers in ten want.

**Claiming the MATRIX stops the pads being an instrument.** Measured: while
`Button_Matrix` is grabbed the pads emit only this - no MIDI notes, and no MPE
expression even on a device that declares `is_mpe` and receives a full stream when
ungrabbed. So `pads: grid({ role: "matrix" })` means this device's pads cannot also
play notes, and a device wanting both has to grab and release around the moments it
needs each, the way the surveyed device's mode subpatchers do.

**It is the pads specifically, not grabbing in general.** Holding
`Scene_Launch_Buttons` leaves the note and MPE stream untouched, so a declaration that
claims the scene column, the transport or the mode buttons costs nothing on the note
path. A device may own part of the surface and stay playable - which is what makes a
mixed declaration worth allowing rather than refusing.

Buttons are the degenerate case:

```tsx
const shift = usePadButton(controls, "shift");   // boolean, live
if (shift) { ... }
```

### Turning it on, and when it applies

`defineControls` generates two parameters into the device's Surface:

```ts
takeover: toggle({ default: false, short: "Takeovr" }),
focus:    menu({ options: ["Device", "Track", "Always"], default: "Track", short: "Focus" }),
```

Both are real Live parameters, so the user can switch takeover off, automate it, put it
on an encoder, and see it in the device view. **Default off**, and `focus` decides when
an enabled device actually holds the grid:

| | The device grabs while |
|---|---|
| `Device` | it is the selected device |
| `Track` | its track is the selected track |
| `Always` | the set is open |

The app is told either way:

```tsx
const held = usePadsHeld(controls);   // boolean: do we own the grid right now?
```

Two of these devices in one set is the normal case, not the edge, and [MAX-FACTS.md](MAX-FACTS.md) records how the
surveyed device handles the handover.

### The loop belongs in the Worker

The device view is usually not visible, because a Push user is looking at the Push.
Chromium throttles timers on a hidden page, so a game or sequencer clocked off
`requestAnimationFrame` will stutter or stop exactly when it matters. Dedicated Workers
are exempt, which is why [ARCHITECTURE.md](ARCHITECTURE.md) makes them pattern 2.

So the shape of every device in the use cases below is the same:

```
  Worker            owns the state and the clock, emits a 64-cell frame
    |  postMessage
    v
  React page        pads.draw(frame)     -> the hardware
                    pads.onPad(...)      -> postMessage into the worker
                    Web Audio            -> the track, via the `webaudio` chain
```

The page is a thin shell: it moves frames out and events in, and it makes the noise.

---

# Use case 1 - `push-snake`, the one that was built

**This is the scope of the work, and it shipped.** Everything after it is a sketch of
what the same API could carry later and is explicitly **not** being implemented. What
remains for this one is nothing: it runs on a Push 3 and the checklist has been run.

Snake, on the 8x8, in TypeScript, sounding through the track. Chosen because its bugs
are visible from across the room, its rules fit in a paragraph, and it exercises every
part of the API at once: a frame per tick, a press handler, a worker clock, parameters,
and Web Audio.

### 1 The rules and the layout

```
 y
 7  G G G G G G G G      G  LENGTH GAUGE - 7 + 6 + 7 = 20 cells. One green per
 6  G . . . . . . G         segment, filled UP the left, ACROSS the top, DOWN
 5  G . . . . . . G         the right. Full is the WIN.
 4  G . . . o . . G      .  arena - the 6x6 the snake lives in
 3  G . . @ * . . G      o  fruit   @ head   * body
 2  G . . * * . . G
 1  G . . . . . . G
 0  < ^ > # # V V V      <  turn anticlockwise    ^  HOLD to sprint
     x=0 1 2 3 4 5 6 7   >  turn clockwise. All three START while stopped
                         V  three LIVES, green until spent, RIGHTMOST first
```

**THE BORDER IS THE HUD, and that is why the arena is only 6x6.** A Push user cannot see
the device view - it is on a laptop behind them - so every number the game has must be on
the grid. The ring was already being spent on a visible wall. Carrying the score and the
lives costs nothing more, and the whole state of a run becomes readable from across the
room.

The bottom row is the one edge NOT in the gauge. It belongs to the controls and the
lives. A gauge running through the turn pads would light them for a reason that has
nothing to do with what they do.

**The border is a wall.** Row 0, row 7, column 0 and column 7 are drawn, permanently,
and the snake dies on contact. The arena is the inner 6x6 - thirty-six cells - and a
lit border is worth more than the six cells it costs: on a grid with no edge you cannot
see, "I hit a wall" and "the device stopped responding" look identical.

**A crash costs a LIFE, not the run.** There are three, spent bottom-right first, and the
snake starts over at length two each time. That is what makes twenty hard.

When the third goes red the game is over and the arena paints a RED frowning face.
Filling the gauge paints a GREEN smiling one. Either one blinks three times and then
STAYS, until somebody presses a turn pad - a result nobody was in the room for is a result
they never saw.

Each segment earned adds ten percent of the base rate to the speed, linearly, so the last
few are the hard ones. The base rate itself is the `difficulty` parameter: Easy, Normal or
Hard.

**Two reserved pads turn the snake**, and they sit *in* the wall - bottom-left corner
and the pad beside it - so they cost nothing playable:

| Pad | Does |
|---|---|
| `(0, 0)` | rotate **anticlockwise** |
| `(1, 0)` | **hold to sprint** - 2.5x, and only while held |
| `(2, 0)` | rotate **clockwise** |

All three START a game while one is stopped.

**While the game is stopped all three pads are GREEN and all three mean START.** That is not a
convenience. These three pads are the only control this device has on the hardware, so they have to be
enough to play it: begin a run, steer it, sprint, begin another after a crash. A Push user
cannot reach the `start` button, which is in a device view on a laptop behind them.

Pressing one while stopped does not also turn. A fresh snake points up by definition, so
a turn before the first tick would mean nothing and read as a lost press.

Every other pad is inert. Three buttons is what the game needs and no more. A direction
per pad would want four, and an absolute-heading grid would want the arena. Both make the
wall harder to read. The three are lit in different colours - `ocean`, `amber`, `sky` -
so which is which is readable from the hardware alone, and the sprint pad goes `white`
while it is held.

**The sprint is HELD, not toggled.** It is a risk you commit to and let go of. A toggle
would turn that into a mode you can forget you are in.

The snake moves one cell per tick and speeds up as it grows. Fruit appears on a random
free arena cell in a random colour, and eating it grows the snake by one. Hitting the
wall or itself costs a life.

### 2 The device, and where the code is

```js
// patcher/devices.mjs
{ name: "push-snake", type: "instrument", chains: ["webaudio"], unmatchedTo: "js" }
```

`webaudio` compiles the device page to `[jweb~]` and sums its L/R into the device's
audio path, so the same page that owns the grid owns the sound. No window, no second
bundle. The `takeover` chain is **not listed** - it is derived from the `controls`
declaration, the way `download` is derived from a `files.ts`.

**It is built, and the code is the documentation.** Rather than a second copy that
drifts:

| | |
|---|---|
| what it claims | [`src/app/push-snake/controls.ts`](../src/app/push-snake/controls.ts) |
| its parameters and state slot | [`src/app/push-snake/surface.ts`](../src/app/push-snake/surface.ts) |
| the game and the clock | [`src/app/push-snake/worker.ts`](../src/app/push-snake/worker.ts) |
| the soundtrack | [`src/app/push-snake/music.ts`](../src/app/push-snake/music.ts), and [`music/README.md`](../src/app/push-snake/music/README.md) for what to render |
| frames out, presses in, the sound | [`src/app/push-snake/App.tsx`](../src/app/push-snake/App.tsx) |

**The soundtrack is four loop layers and a main tune.** The layers go sparsest to densest,
climbing one level every three segments and holding on the densest. A change is booked for
the next BAR rather than run on the spot, because a fruit is eaten mid-bar and swapping the
arrangement there sounds like a mistake. The bar comes from the loop length: 18.823537 s is
8 bars of 4/4 at 102.0000 BPM exactly.

All four are 18.823537 s at 22.05 kHz - the same length to the sample. They are decoded
and started at the same moment and play in sync, and a level change crossfades their GAINS
rather than restarting anything. That is what makes every transition sample-accurate, and
why they must be the same length.

`theme.ogg` is 88.2 s at 48 kHz. It is a different piece, not a denser mix of the same one,
so it cannot share their clock. It plays once, on its own bus, twice in a session: as a
welcome when the device loads, and again when the gauge fills. A loss gets silence.

**While idle the pads scroll SNAKE**, in a 4x5 font - three columns cannot draw an N
without it reading as an H. The bottom row keeps the HUD.

Two things the shipped version does that the sketch above does not, both of them the
API telling the truth about the hardware:

- **The wall is `tan`, not `dark_grey`.** No grey was identified in the palette
  photographs, and `PUSH_PALETTE` names nothing it cannot point at. An index invented by
  analogy with the Push 2 velocity palette would be a guess wearing a name.
- **`speed` became `difficulty`.** A dial in hertz was wrong three ways: the number on
  Push stopped agreeing with the grid once the snake grew, nobody thinks about a game in
  hertz, and most of the range was unplayable. Three named settings say what the control
  is for.
- **The device view tells "takeover off" apart from "another device has the grid".** On
  the hardware those two look the same - a dark Push - and the second one is what a
  second instance in the same set produces.
- **The device view draws the grid too.** The same frame the worker emits goes to
  `pads.draw()` and to React, so the two surfaces cannot disagree about the game - and
  the device is playable with no Push connected, from the two lit pads or the arrow
  keys. The pads are 12 px: eight rows and their gaps come to 110 px, and the device
  view is a fixed ~169 px that clips silently rather than scrolling.

### 3 What it has to prove

Not "Snake works". These, because they are what the next device inherits - and none of
them could be checked without a Push in the room, because **a rejected LiveAPI call
reports nothing**. They have been: `push-snake` runs on a Push 3, grid, HUD, sprint,
music and state.

---

# Use case 2 - a DJ surface for `qobuz-dj`


**REDRAWN, 2026-08-28, after the spike.** The first version of this section built a
crossfader you drag along a row of pads and a platter you spin around a ring of them.
Both are unbuildable: the grabbed matrix carries **press and release with a velocity
and nothing else** - no pressure, no slide, and no event at all when a finger moves
across pads ([MAX-FACTS.md](MAX-FACTS.md)). A gesture inferred from pad taps is eight
taps.

The mistake was bigger than the measurement, though. It was trying to synthesise a jog
wheel out of pads **on a device that has a jog wheel**. `get_control_names` on a Push 3
returns, among 176 names:

```
Jogwheel   Jogwheel_Tap   Jogwheel_Press   Jogwheel_Left_nudge   Jogwheel_Right_nudge
Touch_Strip_Control   Touch_Strip_Tap
```

A jog wheel with a press, a tap and two nudges, and a touch strip. So the continuous
controls move to the hardware that has them, the pads do what they are good at
(discrete, velocity-sensitive triggers), and the encoders stay Live parameters as this file's opening
insists. That is a better instrument than the original layout AND a simpler one.

**CONDITIONAL. Everything below assumes the use case 2's spike spike passes.** Whether `Jogwheel`
and `Touch_Strip_Control` emit a usable continuous stream under a grab is unmeasured,
and it is the whole load-bearing assumption. Written optimistically so the work can be
scoped; not to be started before the spike answers.

### 1 The layout: two decks, chosen not mixed

```
 y
 7  1 1 1 1   2 2 2 2      the pads: two 4x4 tiles, a numeral each
 6  1 1 1 1   2 2 2 2
 5  1 1 1 1   2 2 2 2      SELECTED deck lit in its colour
 4  1 1 1 1   2 2 2 2      the other dimmed
 3  1 1 1 1   2 2 2 2
 2  1 1 1 1   2 2 2 2
 1  1 1 1 1   2 2 2 2
 0  1 1 1 1   2 2 2 2
     x=0 1 2 3   x=4 5 6 7

    [ - - - - touch strip - - - - ]   crossfade, A .. B
    ( jogwheel )                      scrubs / nudges the SELECTED deck
    [ 8 encoders: 4 for A, 4 for B ]  EQ and filter, as Live parameters
```

**The pads select, they do not mix.** Left half is deck A, right half deck B, each
carrying a large numeral drawn across its 4x4 - readable across a room, which is the
entire argument for using 32 pads to hold one bit of state. Tap either half to select
that deck; the selected one is lit in its deck colour and the other is dimmed.

Thirty-two pads for a two-way choice is extravagant and it is the right trade. The
alternative uses two pads and needs the performer to look; this one is legible in a
dark room at arm's length, which is what a DJ surface is for. The numerals are an 8x8
frame like any other - the frame API's `draw` with a glyph table.

**A DJ device does not want the note path**, so the one real cost of grabbing
`Button_Matrix` - the pads stop sending notes and MPE - is free here. That is not true
of use case 3's scale explorer, and it is why this example and that one pull the API in
different directions.

### 2 The crossfader is the touch strip

```tsx
strip.onValue((v) => setCrossfade(v * 2 - 1));   // 0..1 -> -1..+1
```

One control, continuous, exactly where a fader belongs on the hardware, and it writes
the **real `xfader` parameter** - so the strip, the on-screen fader, an encoder and an
automation lane are all moving the same value. That is the whole reason the Surface
stays the Surface (see the opening).

The old eight-cell row is gone. It could only ever have been eight taps, and a
crossfade that jumps in eighths is not a crossfade.

### 3 The platter is the jog wheel

```tsx
jog.onDelta((d) => scrub(selectedDeck, d));
```

`Jogwheel` is a real encoder-style control, so a scrub is its delta rather than an
angle inferred from which pad is under a finger. `Jogwheel_Left_nudge` and
`Jogwheel_Right_nudge` are beat nudges without any inference at all, and
`Jogwheel_Press` is the natural "scratch vs pitch-bend" modifier.

ONE jog wheel, TWO decks - which is why the layout section spends the pads on selection. The wheel
always drives the selected deck, the pads say which that is, and the numeral is
legible from across the room precisely because the wheel is ambiguous without it. The
layout and the hardware explain each other.

### 4 The encoders: four and four

The eight encoders as one Push page, split down the middle:

```ts
banks: [{ name: "DJ", params: ["hiA", "midA", "loA", "filterA", "hiB", "midB", "loB", "filterB"] }]
```

EQ and filter for both decks, side by side, no page turning mid-transition. They stay
**Live parameters** - automatable, MIDI-mappable, in the automation lane - because
grabbing an encoder costs all three, and the library refuses the role for that reason
(measured: they ARE grabbable, and taking them stops them moving anything).

`gain`, `pitch`, `master` and `sync` move to a second bank or to the web UI. A
transition needs EQ and filter under the fingers; trim does not.

### 5 Cues and loops - and what the pads give up

The original use case 2's cues and loops put eight hot cues and a row of loop lengths on the pads. That
still works - discrete, velocity-sensitive triggers is what the grabbed matrix is
good at, and velocity is a free extra dimension (a soft cue could preview, a hard one
could jump).

It does not fit **at the same time** as the deck-select layout's numerals, and that is a real design
choice rather than an oversight: either the pads are a legible deck selector or they
are a control panel, not both. A `shift`-held layer, or the numerals shrinking to 2x2
corners once a set is running, are the obvious ways out. Decide it against a
performance, not against a diagram.

### 6 THE SPIKE THIS ALL DEPENDS ON

Two questions, both one button press in `push-probe`'s `probe_other`, which grabs any
control by name and dumps the atoms its `value` carries:

| # | Question | Why it decides the section |
|---|---|---|
| J1 | Does `Jogwheel` emit a continuous stream under a grab, and is it a DELTA or an absolute position? | the jog wheel section is the platter. A delta scrubs directly; an absolute wraps and needs unwrapping; nothing at all and there is no platter. |
| J2 | Does `Touch_Strip_Control` emit a continuous position under a grab, and at what resolution? | the crossfader section is the crossfader. Anything under ~64 steps reads as a stepped fader and is worse than the on-screen one. |

Nice to have, same cost: `Jogwheel_Press`, `Jogwheel_Tap`, `Jogwheel_Left_nudge`,
`Jogwheel_Right_nudge`, `Touch_Strip_Tap`.

**If J1 fails, this section dies** - there is no other continuous rotary on the
hardware, and a DJ deck without a platter is a playlist. **If J2 fails**, the crossfader section falls
back to the `xfader` encoder and the section survives, poorer.

### 7 Where this sits in the order

Still not being implemented, and still behind `../m4l-qobuz-dj`'s own gates: its CORS
spike, and the memory question in its stage 2 (a decoded 10-minute FLAC is ~210 MB in
the AudioContext; two decks plus a preload is over half a gigabyte inside a Chromium
context inside Live). **Pads on a mixer that has never made a sound are decoration.**

What this section is worth today is still mostly negative, and the negative has
changed shape. It used to be "nothing in `defineControls` should assume the grid
belongs to a sequencer". After the spike it is sharper:

- a declaration must be able to claim **non-matrix** controls - a jog wheel, a touch
  strip, the scene column - **without** claiming the grid, because those cost nothing
  on the note path and the grid costs everything;
- a control is not necessarily a grid or a button. A jog wheel is a **stream**, and
  `defineControls` needs a third shape or it will have to grow one later;
- and use case 3 pulls the other way, wanting the pads while keeping notes playable - which
  it now cannot have. Two examples, two incompatible demands, which is exactly what
  they are here for.

---

# Use case 3 - the Circuit Tracks scale explorer


The full Circuit emulation is a large device: nine views, thirty-two steps, eight
patterns per track, scenes. **This example is one view of it** - Scales - because it is
self-contained, it is the view whose behaviour is already written down, and it is the
one that most obviously wants sixty-four pads.

`../trackster` implements the same feature as a web app, and its data model is the
specification: `src/components/devices/Circuit/Scales/scalesData.ts` carries sixteen
scale modes as interval sets and the Circuit's piano-shaped chromatic layout. That file
is the *spec*, not a dependency - this device shares no code with it.

### 1 What the Circuit does

Two rows select a root note, laid out like a piano keyboard (black keys above, white
keys below, four dead pads where a piano has no black key); another block selects one
of sixteen scale modes; and the notes belonging to the chosen root and mode light up.
The trackster model, verbatim in shape:

```ts
const CHROMATIC = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];

const SCALES = {
  "Natural Minor":  [0, 2, 3, 5, 7, 8, 10],
  "Major":          [0, 2, 4, 5, 7, 9, 11],
  "Dorian":         [0, 2, 3, 5, 7, 9, 10],
  "Phrygian":       [0, 1, 3, 5, 7, 8, 10],
  "Mixolydian":     [0, 2, 4, 5, 7, 9, 10],
  "Melodic Minor":  [0, 2, 3, 5, 7, 9, 11],
  "Harmonic Minor": [0, 2, 3, 5, 7, 8, 11],
  "Bebop Dorian":   [0, 2, 3, 5, 7, 9, 10, 11],
  "Blues":          [0, 3, 5, 6, 7, 10],
  "Minor Pentatonic": [0, 3, 5, 7, 10],
  "Hungarian Minor":  [0, 2, 3, 6, 7, 8, 11],
  "Ukrainian Dorian": [0, 2, 3, 6, 7, 9, 10],
  "Marva":          [0, 1, 4, 6, 7, 9, 11],
  "Todi":           [0, 1, 3, 6, 7, 8, 11],
  "Whole Tone":     [0, 2, 4, 6, 8, 10],
  "Chromatic":      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
} as const;

const inScale = (pc: number, root: number, scale: keyof typeof SCALES) =>
  SCALES[scale].includes((pc - root + 12) % 12);
```

### 2 The Push layout

The Circuit spreads this over two pages of sixteen pads. Push has sixty-four at once,
so it fits with the *playable* keyboard in the middle - which the Circuit cannot do.

```
 y
 7  [ scale 1 .. 8  ]      the sixteen modes, two rows
 6  [ scale 9 .. 16 ]
 5  [                ]
 4  [   playable     ]     four rows of in-scale notes, ascending
 3  [   keyboard     ]     root note lit differently from the rest
 2  [                ]
 1  [ .C#.D#..F#.G#.A#. ]  the black keys  (dead pads where a piano has none)
 0  [ C D E F G A B .   ]  the white keys
```

Rows 0-1 are the Circuit's piano-shaped root selector, kept deliberately - it is what
makes the layout readable to someone who has used the hardware. Rows 2-5 are the part
the Circuit has no room for: thirty-two in-scale notes ascending left-to-right, bottom
row lowest, so a scale is something you can *play* while you are choosing it.

### 3 The device

```ts
// controls.ts
export default defineControls({
  surface: "push",
  controls: { pads: grid({ role: "matrix", rows: 8, cols: 8 }) },
});

// surface.ts
export default defineSurface({
  params: {
    root:  menu({ options: CHROMATIC, default: "C", short: "Root" }),
    scale: menu({ options: Object.keys(SCALES), default: "Major", short: "Scale" }),
    octave: dial({ range: [-2, 3], step: 1, default: 0, short: "Octave" }),
    follow: toggle({ default: true, short: "Follow" }),   // track Live's own scale
  },
  banks: [{ name: "Scale", params: ["root", "scale", "octave", "follow"] }],
});
```

**Root and scale are parameters, not app state** - the pattern the surveyed device's device uses for
everything a pad press writes. They automate, they land on the encoders, and the pads
and the encoders are then two views of one value rather than two copies of it.

`follow` binds to Live's own song scale through `defineWatch`, so the device tracks the
set instead of arguing with it:

```ts
export const watches = defineWatch({
  watches: {
    songRoot:  watch<number>({ path: "live_set", property: "root_note", default: 0 }),
    songScale: watch<string>({ path: "live_set", property: "scale_name", default: "Major" }),
  },
});
```

### 4 The frame

```tsx
const BLACK_COL: Record<number, number> = { 1: 0, 3: 1, 6: 3, 8: 4, 10: 5 };  // pc -> x
const WHITE_PC = [0, 2, 4, 5, 7, 9, 11];                                      // x -> pc

function drawScales(f: PadFrame, root: number, scale: keyof typeof SCALES, scales: string[]) {
  f.clear("black");

  // rows 6-7: the sixteen modes, the chosen one bright
  scales.forEach((name, i) => {
    const x = i % 8, y = 7 - Math.floor(i / 8);
    f.set(x, y, name === scale ? "yellow_highlight" : "dark_grey");
  });

  // rows 0-1: the piano-shaped root selector. In-scale roots glow; the root is white.
  WHITE_PC.forEach((pc, x) => {
    f.set(x, 0, pc === root ? "white" : inScale(pc, root, scale) ? "purple" : "dark_grey");
  });
  for (const [pcStr, x] of Object.entries(BLACK_COL)) {
    const pc = Number(pcStr);
    f.set(x, 1, pc === root ? "white" : inScale(pc, root, scale) ? "purple" : "dark_grey");
  }
  // Where a piano has no black key, the pad stays dark - x=2 and x=6 on row 1.

  // rows 2-5: the playable keyboard, thirty-two ascending in-scale notes
  const degrees = SCALES[scale];
  for (let i = 0; i < 32; i++) {
    const note = root + degrees[i % degrees.length]! + 12 * Math.floor(i / degrees.length);
    const x = i % 8, y = 2 + Math.floor(i / 8);
    f.set(x, y, (note - root) % 12 === 0 ? "ocean" : "sky");   // octave roots stand out
  }
}
```

### 5 The handler

```tsx
pads.onPad((e) => {
  if (e.y >= 6) {                                   // pick a mode
    if (!e.down) return;
    const i = (7 - e.y) * 8 + e.x;
    if (i < scaleNames.length) setScale(scaleNames[i]!);
  } else if (e.y <= 1) {                            // pick a root
    if (!e.down) return;
    const pc = e.y === 0
      ? WHITE_PC[e.x]
      : Object.entries(BLACK_COL).find(([, x]) => x === e.x)?.[0];
    if (pc !== undefined) setRoot(CHROMATIC[Number(pc)]!);   // undefined on a dead pad
  } else {                                          // play
    const i = (e.y - 2) * 8 + e.x;
    const degrees = SCALES[scale];
    const note = 36 + octave * 12 + rootPc
      + degrees[i % degrees.length]! + 12 * Math.floor(i / degrees.length);
    if (e.down) sendNote({ pitch: note, velocity: e.value, durationMs: 0, channel: 1, delayMs: 0 });
    else noteOff(note);
  }
});
```

`sendNote` is the existing `midiout` chain (`CHAIN_IN` in `@m4l-jweb/bridge`), so this
device is a MIDI effect that plays whatever instrument follows it. **`e.value` is the
velocity**, which is the first place in this plan where the third atom of the pad event
is doing real musical work - and the first place U1's answer would be felt as expression
rather than as convenience.

### 6 What it demonstrates that Snake does not

Three regions with three different behaviours on one grabbed control; parameters as the
shared truth between pads, encoders and automation; a `defineWatch` binding to Live's
own state; and a repaint that is *conditional* rather than periodic - the frame is
redrawn when root, scale or octave changes and at no other time, which is the opposite
of Snake's per-tick redraw and the other half of the repaint load profile.

---
