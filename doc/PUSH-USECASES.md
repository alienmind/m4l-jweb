# PUSH-USECASES.md - what the programmable pads are FOR

**Devices that are NOT built, written against the pad-takeover API.** This file is design.
It is not a schedule and not evidence.

The one device that WAS built is `push-snake`, and it is not described here - a game
described in two places is a game described differently in two places. Its one
description is [SNAKE.md](SNAKE.md).

- **The schedule** is [TODO.md](TODO.md): what is built, in what order, and what is
  still gated. One backlog, and this is not it.
- **The evidence** is [MAX-FACTS.md](MAX-FACTS.md), "Grabbing a Push control": how a Push
  control is really grabbed, painted and read, measured on hardware. Nothing here repeats
  a mechanism. Where a use case leans on one, it links.

**Only the first was built.** The other two are **design pressure on the API**: an API
shaped around one game is an API that fits one game, and the cheapest guard against that
was two more devices that want incompatible things.

They did their job before either was written. `padStream()`, and the rule that a
non-matrix control may be claimed without claiming the grid, are both in the shipped
library because use case 2 asked for them. Do not build them.

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

**Built and shipped.** How it works is [ARCHITECTURE.md](ARCHITECTURE.md), "The pads: a
control surface you program", and the reference is
`packages/surface/src/controls.ts`. The short version, so the two devices below can be
read without leaving this file:

```ts
// src/app/<device>/controls.ts
export default defineControls({
  surface: "push",
  controls: { pads: grid({ role: "matrix", rows: 8, cols: 8 }) },
});
```

```tsx
const pads = usePadGrid(controls, "pads");
pads.draw((f) => { f.clear("black"); f.set(3, 4, "green"); });   // y is BOTTOM-up
useEffect(() => pads.onPad((e) => e.down && turn(e.x, e.y)), [pads]);
```

You name a **role**, never a Max control name, and the library resolves it at runtime
against the connected hardware. `draw` takes a whole FRAME and the library works out what
changed. The declaration adds `takeover` and `focus` as real Live parameters, off by
default.

Three names moved between the design and the build, and the reasons are worth keeping:

- `button({ role })` is **`padButton({ role })`**, because `button()` already belongs to
  `defineSurface` as the `live.text` parameter. There is a third shape too, `padStream()`,
  for a jog wheel or a touch strip.
- The declaration is passed to **`defineSurface({ controls })`** rather than standing
  beside it, because it contributes those two parameters - and a parameter has to be in
  the surface for the codegen to emit its object, for Push to page it, and for `useParam`
  to bind it.
- The colours are **names the palette can actually point at**. `dark_grey`, `red_red` and
  `yellow_highlight` are not among them: the table is read off photographs and no grey was
  identified. See [TODO.md](TODO.md), the colour item.

---

# Use case 1 - `push-snake`, the one that was built

**It shipped, and it runs on a Push 3.** It is not described here, because a game
described in two places is a game described differently in two places. The one
description is [SNAKE.md](SNAKE.md): the rules, the layout, the HUD, the soundtrack and
the parameters, written for somebody playing it.

What it was for, and what it proved:

- **a frame per tick survives the diff.** The whole grid is redrawn on every move, and
  what crosses the bridge is one message per changed frame, not sixty-four per frame.
- **a press reaches the app fast enough to steer**, through a `[live.observer]` with no
  `[js]` in the way.
- **the worker clock survives a hidden page**, which is the normal case: a Push user is
  not looking at the device view.
- **the parameters drive the game from Live's side** - `Run` from an encoder, `Diff` from
  an automation lane.
- **two instances in one set take turns**, which is what `focus` is for.
- **takeover off does nothing to the Push**, which is what makes it shippable.

It also ships as its own release zip - one `.amxd` and a README, for somebody who wants a
game and has never heard of this library. See `bundles` in `patcher/devices.mjs`.

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

### 2 The crossfader is NOT the touch strip - measured

This section wanted `strip.onValue((v) => setCrossfade(v * 2 - 1))`. It cannot have it.

**Measured on a Push 3** ([MAX-FACTS.md](MAX-FACTS.md)): grabbed,
`Touch_Strip_Control` streams continuously, and its `value` is a byte counting in steps
of 64 and wrapping. Four distinct values over 180 events:

```
-128, -64, 0, 64          as unsigned bytes: 0, 64, 128, 192
```

The direction of travel is recoverable from the wrapped difference between events. The
position is not - it repeats every four. That is a relative control, not the ~64-step
fader a crossfade needs, and a crossfade you cannot put at a known position is not a
crossfade.

So the crossfader falls back to the `xfader` **encoder**, and it still writes the real
Live parameter, which was always the point: the encoder, the on-screen fader and an
automation lane all move the same value.

**What would answer it properly** is `Nav_Select_Touch` or `Mpe_Pitch_Bend_Elements`.
`get_control_names` lists both and nobody has read either. `probe_other <name> 1` in
`push-probe` grabs any control by name and says whether its trace is a delta or a
position.

### 3 The platter is the jog wheel - measured, and it works

```tsx
jog.onDelta((d) => scrub(selectedDeck, d));
```

**Measured on a Push 3**: grabbed, `Jogwheel` streams continuously and reports a DELTA of
one detent as a signed 7-bit step - `1` clockwise, `127` for -1. One event per detent, and
turning faster sends them faster rather than sending a bigger number. There is no
acceleration in the value and no position at all, which is correct for a continuous
rotary: a device integrates the steps and owns the result.

So a scrub is its delta rather than an angle inferred from which pad is under a finger. `Jogwheel_Left_nudge` and
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

### 6 The spike this depended on - run, and answered

Two questions, both one button press in `push-probe`'s `probe_other`. Both were run on a
Push 3 on 2026-08-29, and the answers are in [MAX-FACTS.md](MAX-FACTS.md):

| # | Question | Answer |
|---|---|---|
| J1 | Does `Jogwheel` emit a continuous stream under a grab, and is it a DELTA or an absolute position? | **A delta**, one detent per event, signed 7-bit. The platter lives. |
| J2 | Does `Touch_Strip_Control` emit a continuous position, and at what resolution? | **No position.** A byte counting in 64s and wrapping - four values. The crossfader falls back to the encoder. |

So this section survives, one control poorer, and it survives on the half that mattered:
there is no other continuous rotary on the hardware, and a DJ deck without a platter is a
playlist.

Still unread, same cost each: `Jogwheel_Press`, `Jogwheel_Tap`, `Jogwheel_Left_nudge`,
`Jogwheel_Right_nudge`, `Touch_Strip_Tap`, and the two controls that might carry the
strip's real position.

### 7 Where this sits in the order

Still not being implemented, and still behind `../m4l-qobuz-dj`'s own gates: its CORS
spike, and the memory question in its stage 2 (a decoded 10-minute FLAC is ~210 MB in
the AudioContext; two decks plus a preload is over half a gigabyte inside a Chromium
context inside Live). **Pads on a mixer that has never made a sound are decoration.**

**It already paid for itself, before being built.** Every demand this section made of the
API is in the shipped `defineControls`, and none of them came from Snake:

- a declaration can claim **non-matrix** controls - a jog wheel, a touch strip, the scene
  column - **without** claiming the grid, because those cost nothing on the note path and
  the grid costs everything;
- a control is not necessarily a grid or a button. A jog wheel is a **stream**, so
  `padStream()` and `usePadStream()` exist, and they hand over raw atoms without decoding
  them - which is exactly right, now that the measurement says the two streams mean two
  different things;
- and use case 3 pulls the other way, wanting the pads while keeping notes playable, which
  it cannot have. Two examples, two incompatible demands, which is what they are here
  for.

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
