# PUSH-USECASES.md - what the programmable pads are FOR

Four devices, in detail, written against the pad-takeover API. **This file is design,
not schedule and not evidence.**

- **The schedule** - what is built, in what order, and what is still gated - is
  [TODO.md](TODO.md). One backlog, and this is not it.
- **The evidence** - how a Push control is actually grabbed, painted and read, measured
  on hardware - is [MAX-FACTS.md](MAX-FACTS.md), "Grabbing a Push control". Nothing here
  re-states a mechanism; where a use case leans on one, it links.

**Only the first is being built.** `push-snake` is the device that proves the surface
works. The other two exist as **design pressure on the API**: an API shaped around one
game is an API that fits one game, and the cheapest guard against that is two more
devices that want incompatible things. Read them before finalising `defineControls`;
do not build them.

## Why the pads at all

M4L-JWEB already gives a device eight Push encoders: declare a parameter in
`surface.ts` and it is on the hardware, labelled, banked, automatable, MIDI-mappable
([ARCHITECTURE.md](ARCHITECTURE.md), "Parameters: the Surface Push reads").

**It gives you nothing on the 8x8 grid.** Sixty-four RGB pads, the scene column, the
transport and mode buttons - the entire performance surface - are Live's, and a device
can neither read them nor light them. Closing that is one line:

> **`grid.draw()` and `grid.onPad()` in TypeScript, and sixty-four pads on the hardware
> do what your device says.**

A frame buffer you paint and an event stream you handle, from the same React app that
draws the device view - so a sequencer, a game, a DJ deck or a scale explorer is a page
of ordinary TypeScript that happens to run on a piece of hardware instead of a screen.

### What it is not

- **Not a replacement for the Surface.** Encoders stay Live parameters. Grabbing one
  costs it automation, MIDI mapping and its automation lane - measured, they ARE
  grabbable and taking them stops them moving anything. Grab the *grid*; leave the
  knobs alone.
- **Not `live.push`.** That object configures Push's own note mode and colours *notes,
  not pads*, so it cannot address a step grid. Worth shipping separately; it is its own
  [TODO.md](TODO.md) item.
- **Not always on.** Takeover is a Live parameter the user can switch off, defaulting
  off, with a focus policy beside it. A device that seizes the pads of every set it
  lands in is a device people uninstall.

### The one constraint every use case here is shaped by

**Claiming `Button_Matrix` takes the pads off the note path.** No MIDI notes and no MPE
expression until it is released, and the grabbed control itself carries only press and
release with a velocity - no pressure, no slide, no event when a finger moves across
pads. Claiming a NON-matrix control (the scene column, the jog wheel, the touch strip)
costs nothing on the note path.

All measured; all in [MAX-FACTS.md](MAX-FACTS.md). It is why the DJ surface below was
redrawn and why the scale explorer is harder than it looks.

---

## The API these are written against

Proposed, not built - it is [TODO.md](TODO.md)'s `defineControls` item. The use cases
below are written against it, which is the point: a use case that cannot be expressed
here is a hole in the API, found on paper instead of in Live.

### Declare what the device claims

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
library works out what changed: the callback fills an off-screen 64-byte buffer, the
buffer is diffed against the last one actually sent, and only the changed cells reach
the hardware. That is not an optimisation detail you can ignore - it is the contract.
Sixty-four messages a frame across the bridge is a data plane, and
[TODO.md](TODO.md)'s first rule is that `[js]` is a control plane.

So a device redraws freely - every animation frame, every tick, on every state change -
and pays only for the pads that moved. A blinking cursor costs one cell per blink.

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

### Turn it on, and decide when it applies

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

The device view is *usually not visible* - a Push user is looking at the Push. Chromium
throttles timers on a hidden page, and a game or sequencer clocked off
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

# Use case 1 - `push-snake`, the one being built


**This is the scope of the work.** Everything after [TODO.md](TODO.md) is a sketch of what the same API
could carry later and is explicitly **not** being implemented.

Snake, on the 8x8, in TypeScript, sounding through the track. Chosen because its bugs
are visible from across the room, its rules fit in a paragraph, and it exercises every
part of the API at once: a frame per tick, a press handler, a worker clock, parameters,
and Web Audio.

### 1 The rules, and the layout they imply

```
 y
 7  # # # # # # # #      #  wall  - dark_grey, always lit, never enters play
 6  # . . . . . . #      .  arena - the 6x6 the snake lives in
 5  # . . . . . . #
 4  # . . . o . . #      o  fruit - a random colour on a random free cell
 3  # . . @ * . . #      @  head   * body
 2  # . . * * . . #
 1  # . . . . . . #
 0  < > # # # # # #      <  turn anticlockwise    >  turn clockwise
     x=0 1 2 3 4 5 6 7
```

**The border is a wall.** Row 0, row 7, column 0 and column 7 are drawn, permanently,
and the snake dies on contact. The arena is the inner 6x6 - thirty-six cells - and a
lit border is worth more than the six cells it costs: on a grid with no edge you cannot
see, "I hit a wall" and "the device stopped responding" look identical.

**Two reserved pads turn the snake**, and they sit *in* the wall - bottom-left corner
and the pad beside it - so they cost nothing playable:

| Pad | Does |
|---|---|
| `(0, 0)` | rotate **anticlockwise** |
| `(1, 0)` | rotate **clockwise** |

Every other pad is inert. Two buttons is what the game needs and no more: a direction
per pad would want four, an absolute-heading grid would want the arena, and both make
the wall harder to read. The two turn pads pulse on press, so the input is visible on
the hardware even when the device view is closed.

The snake moves one cell per tick and speeds up as it grows. Fruit appears on a random
free arena cell in a random colour; eating it grows the snake by one. Hitting the wall
or itself ends the run.

### 2 The device

```js
// patcher/devices.mjs
{
  name: "push-snake",
  type: "instrument",     // `webaudio` needs a signal path
  chains: ["webaudio"],   // the page's AudioContext IS the track
  unmatchedTo: "js",
}
```

`webaudio` compiles the device page to `[jweb~]` and sums its L/R into the device's
audio path, so the same page that owns the grid owns the sound. No window, no second
bundle.

### 3 `controls.ts`

```ts
import { defineControls, grid } from "@m4l-jweb/surface";

export default defineControls({
  surface: "push",
  controls: {
    pads: grid({ role: "matrix", rows: 8, cols: 8 }),
  },
});
```

### 4 `surface.ts`

```ts
import { defineSurface, dial, toggle, state } from "@m4l-jweb/surface";

export default defineSurface({
  params: {
    running: toggle({ default: false, short: "Run" }),
    // Ticks per second at length 1. Real units, so the automation lane and the
    // encoder both read Hz rather than a mystery 0-1.
    speed: dial({ range: [1, 16], default: 4, unit: "Hz", short: "Speed" }),
    volume: dial({ range: [0, 1], default: 0.6, format: (v) => `${Math.round(v * 100)}%`, short: "Volume" }),
  },
  banks: [{ name: "Snake", params: ["running", "speed", "volume"] }],
  // The high score survives saving the set. A number Live must never automate is
  // exactly what a state slot is for.
  state: { best: state<number>({ default: 0 }) },
});
```

`defineControls` adds `takeover` and `focus` to that Surface (see the takeover parameters above), so the bank shows
five controls and the user can hand the pads back without deleting the device.

### 5 `worker.ts` - the game

Everything stateful lives here, so it keeps running with the device view closed.

```ts
// src/app/push-snake/worker.ts
type Cell = [number, number];
type Colour = "green" | "red_red" | "yellow_highlight" | "sky" | "purple";

/** The arena is the inner 6x6; everything outside it is wall. */
const MIN = 1, MAX = 6;
const inArena = (c: Cell) => c[0] >= MIN && c[0] <= MAX && c[1] >= MIN && c[1] <= MAX;

const FRUIT_COLOURS: Colour[] = ["red_red", "yellow_highlight", "sky", "purple"];
// Clockwise from up. A turn steps one place around this ring, either way.
const DIRS: Cell[] = [[0, 1], [1, 0], [0, -1], [-1, 0]];

let snake: Cell[] = [];
let dir = 0;
let fruit: Cell = [0, 0];
let fruitColour: Colour = "red_red";
let alive = false;
let baseHz = 4;
let timer: ReturnType<typeof setInterval> | null = null;

const same = (a: Cell, b: Cell) => a[0] === b[0] && a[1] === b[1];
const free = (c: Cell) => !snake.some((s) => same(s, c));

function placeFruit(): void {
  const open: Cell[] = [];
  for (let x = MIN; x <= MAX; x++) for (let y = MIN; y <= MAX; y++) if (free([x, y])) open.push([x, y]);
  if (!open.length) return;                       // arena full: you won
  fruit = open[Math.floor(Math.random() * open.length)]!;
  fruitColour = FRUIT_COLOURS[Math.floor(Math.random() * FRUIT_COLOURS.length)]!;
}

function reset(): void {
  snake = [[3, 3], [3, 2]];
  dir = 0;
  alive = true;
  placeFruit();
  reschedule();
  paint();
}

/** Speed rises with length, so the run gets harder as it gets longer. */
function reschedule(): void {
  if (timer) clearInterval(timer);
  const hz = baseHz * (1 + (snake.length - 2) * 0.06);
  timer = setInterval(step, 1000 / hz);
}

function step(): void {
  if (!alive) return;
  const [hx, hy] = snake[0]!;
  const [dx, dy] = DIRS[dir]!;
  const head: Cell = [hx + dx, hy + dy];

  // The wall is the border ring, and there is no wrap.
  if (!inArena(head) || !free(head)) {
    alive = false;
    if (timer) clearInterval(timer);
    self.postMessage(["dead", snake.length]);
    paint();
    return;
  }

  snake.unshift(head);
  if (same(head, fruit)) {
    placeFruit();
    reschedule();
    self.postMessage(["ate", snake.length]);
  } else {
    snake.pop();
    self.postMessage(["moved", snake.length]);
  }
  paint();
}

/**
 * One frame out per tick: a flat 64-cell array of colour NAMES, row-major from the
 * bottom-left. The page hands it straight to pads.draw(); the library works out which
 * cells actually changed.
 */
function paint(): void {
  const f: string[] = new Array(64).fill("dark_grey");     // the wall, everywhere
  const at = (c: Cell) => c[1] * 8 + c[0];
  for (let x = MIN; x <= MAX; x++) for (let y = MIN; y <= MAX; y++) f[at([x, y])] = "black";

  f[at([0, 0])] = "ocean";                                  // turn anticlockwise
  f[at([1, 0])] = "sky";                                    // turn clockwise

  if (alive) f[at(fruit)] = fruitColour;
  snake.forEach((c, i) => { f[at(c)] = i === 0 ? "white" : alive ? "green" : "red_red"; });
  self.postMessage(["frame", f]);
}

self.onmessage = (e: MessageEvent) => {
  const [type, arg] = e.data as [string, number];
  if (type === "start") reset();
  else if (type === "stop") { alive = false; if (timer) clearInterval(timer); }
  // arg is +1 clockwise, -1 anticlockwise. A dead snake ignores both.
  else if (type === "turn") { if (alive) dir = (dir + arg + 4) % 4; }
  else if (type === "speed") { baseHz = arg; if (alive) reschedule(); }
};
```

### 6 `App.tsx` - frames out, presses in, and the sound

```tsx
import { useEffect, useRef, useState } from "react";
import { useDevice, Frame } from "../shared/device";
import { useParam, useStateSync, usePadGrid, usePadsHeld } from "@m4l-jweb/surface/react";
import GameWorker from "./worker.ts?worker&inline";
import surface from "./surface";
import controls from "./controls";

/** The two reserved pads, in the wall, bottom-left. */
const TURN_CCW = { x: 0, y: 0 };
const TURN_CW = { x: 1, y: 0 };

export default function App() {
  const device = useDevice();
  const pads = usePadGrid(controls, "pads");
  const held = usePadsHeld(controls);
  const [running, setRunning] = useParam(surface, "running");
  const [speed] = useParam(surface, "speed");
  const [volume] = useParam(surface, "volume");
  const [best, setBest] = useStateSync(surface, "best");
  const [length, setLength] = useState(2);

  const worker = useRef<Worker | null>(null);
  const audio = useRef<AudioContext | null>(null);

  /** One blip. The whole sound design: pitch says what happened. */
  const blip = (hz: number, ms: number, type: OscillatorType = "square") => {
    const ctx = (audio.current ??= new AudioContext());
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(hz, t);
    gain.gain.setValueAtTime(volume * 0.25, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + ms / 1000);
  };

  useEffect(() => {
    const w = new GameWorker();
    w.onmessage = (e: MessageEvent) => {
      const [type, arg] = e.data as [string, unknown];
      if (type === "frame") {
        // The whole grid, every tick. The diff is the library's problem.
        pads.draw((f) => (arg as string[]).forEach((c, i) => f.set(i % 8, Math.floor(i / 8), c)));
      } else if (type === "moved") {
        setLength(arg as number);
        blip(160, 25, "triangle");
      } else if (type === "ate") {
        const n = arg as number;
        setLength(n);
        blip(220 + n * 40, 90);              // rises as the snake grows
        if (n > best) setBest(n);
      } else if (type === "dead") {
        blip(90, 400, "sawtooth");
        setRunning(false);
      }
    };
    worker.current = w;
    return () => w.terminate();
  }, []);

  // The `running` toggle is the transport: it works from the device view, from an
  // encoder, and from an automation lane, because it is a real Live parameter.
  useEffect(() => { worker.current?.postMessage([running ? "start" : "stop"]); }, [running]);
  useEffect(() => { worker.current?.postMessage(["speed", speed]); }, [speed]);

  // TWO pads, and only on the way down. Everything else on the grid is inert.
  useEffect(() => pads.onPad((e) => {
    if (!e.down) return;
    if (e.x === TURN_CCW.x && e.y === TURN_CCW.y) worker.current?.postMessage(["turn", -1]);
    else if (e.x === TURN_CW.x && e.y === TURN_CW.y) worker.current?.postMessage(["turn", +1]);
  }), [pads]);

  return (
    <Frame device={device} title="Snake">
      <p>{held ? "Pads: held" : "Pads: released - turn Takeover on"}</p>
      <p>length {length} · best {best}</p>
    </Frame>
  );
}
```

### 7 What it has to prove

Not "Snake works". These, because they are what the next device inherits:

| | Checked by |
|---|---|
| a full frame every tick survives the diff without flooding `[js]` | it plays smoothly at speed 16 with a long snake |
| a press reaches the app fast enough to steer | a turn taken one tick before the wall does not hit the wall |
| the worker clock survives a hidden page | close the device view mid-run; the snake keeps moving |
| parameters drive the loop from Live's side | `running` from an encoder, `speed` from an automation lane |
| a state slot outlives the set | save, close, reopen: `best` is still there |
| audio reaches the track from the same page | Live's meters move on every blip |
| **two instances in one set** | the second device does not steal the grid from the first |
| **takeover off** | the device loads, shows its state, and does nothing to Push |

---

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
