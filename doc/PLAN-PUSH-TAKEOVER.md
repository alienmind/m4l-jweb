# PLAN-PUSH-TAKEOVER.md - the pads as a surface you program

**Separate from [TODO.md](TODO.md).** That file is the library's open backlog; this is
a line of evolution that has not started, and it stays out of the backlog until the
spike in §4 lands its findings in [MAX-FACTS.md](MAX-FACTS.md).

---

## 1. The idea

M4L-JWEB already gives a device eight Push encoders: declare a parameter in
`surface.ts` and it is on the hardware, labelled, banked, automatable, MIDI-mappable
([ARCHITECTURE.md](ARCHITECTURE.md), "Parameters: the Surface Push reads").

**It gives you nothing at all on the 8x8 grid.** Sixty-four RGB pads, the scene
column, the transport and mode buttons - the entire performance surface of the
instrument - are Live's, and a device can neither read them nor light them.

This plan closes that. The goal, in one line:

> **`grid.draw()` and `grid.onPad()` in TypeScript, and sixty-four pads on the
> hardware do what your device says.**

Not eight parameters rendered by Live. A frame buffer you paint and an event stream
you handle, from the same React app that already draws the device view - so a
sequencer, a game, a DJ deck or a scale explorer is a page of ordinary TypeScript that
happens to run on a piece of hardware instead of a screen.

The mechanism is a documented Live API (§3), it is a patcher-level feature the build
can generate, and the first device to ship on it is a **playable Snake** (§5) - because
an example whose bug you can see across the room is the fastest possible way to know
the surface works.

### What it is not

- **Not a replacement for the Surface.** Encoders stay Live parameters. Grabbing one
  would cost it automation, MIDI mapping and its automation lane - everything the
  parameter path exists for. Grab the *grid*; leave the knobs alone.
- **Not `live.push`.** That object is real and configures Push's own note mode (§3.4);
  it colours *notes*, not pads, so it cannot address a step grid. Worth shipping, on
  its own, as a smaller separate thing.
- **Not always on.** Takeover is a Live parameter the user can turn off, defaulting
  off, with a focus policy beside it (§2.4). A device that seizes the pads of every
  set it lands in is a device people uninstall.

---

## 2. How the pads are programmed

This section is the deliverable: what a device author writes. Everything here is
proposed API. §3 is the machinery under it, §4 is what is still unmeasured.

### 2.1 Declare what the device claims

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
not resolve** instead of grabbing nothing. Push 1/2/3 appear to share names (§3.2);
Move does not; and [CLAUDE.md](../CLAUDE.md)'s first hard rule is that a wrong name
Max looks up is not an error, it is a feature that silently does nothing.

Checks that throw at declaration time: a role outside the vocabulary; a grid whose
dimensions do not match its role; two declarations claiming one role; a key with
whitespace (it becomes a selector); and a role the library refuses - the encoders,
for the reason in §1.

### 2.2 Paint

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
generations until §4's U2 says it is.

### 2.3 Read

```tsx
pads.onPad((e) => {
  // e: { x, y, value, down }
  if (!e.down) return;
  turn();
});
```

`x` is 0-7 left to right, `y` is 0-7 **bottom to top** - the Push's own orientation, and
the one every layout in §5-§7 is written in. `value` is the raw value from the
hardware (velocity on a press, 0 on release); `down` is `value > 0`, precomputed
because that is the check nine handlers in ten want.

Buttons are the degenerate case:

```tsx
const shift = usePadButton(controls, "shift");   // boolean, live
if (shift) { ... }
```

### 2.4 Turn it on, and decide when it applies

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

Two of these devices in one set is the normal case, not the edge, and §3.3 is how the
handover works.

### 2.5 The loop belongs in the Worker

The device view is *usually not visible* - a Push user is looking at the Push. Chromium
throttles timers on a hidden page, and a game or sequencer clocked off
`requestAnimationFrame` will stutter or stop exactly when it matters. Dedicated Workers
are exempt, which is why [ARCHITECTURE.md](ARCHITECTURE.md) makes them pattern 2.

So the shape of every device in §5-§7 is the same:

```
  Worker            owns the state and the clock, emits a 64-cell frame
    |  postMessage
    v
  React page        pads.draw(frame)     -> the hardware
                    pads.onPad(...)      -> postMessage into the worker
                    Web Audio            -> the track, via the `webaudio` chain
```

The page is a thin shell: it moves frames out and events in, and it makes the noise.

### 2.6 The protocol underneath

Not something a device author writes, but it is what the lint checks, so it is part of
the contract. The id goes in the ARGUMENTS, never baked into the selector
(`sync_state <id> <json>`, never `sync_state_<id>` - the rule and its scar are in
[CLAUDE.md](../CLAUDE.md)):

```
in  (Max -> app)   pad <control> <x> <y> <value>      from the value observer
                   controls_ready <n> <name> ...      resolved roles, at grab time
                   controls_lost <reason>             released, or focus moved away

out (app -> Max)   paint <control> <x> <y> <color>    one cell
                   paint_all <control> <b64>          a whole frame, one message
```

`tests/protocol.test.mjs` covers all of it once the selectors are in `CONTROLS_IN` /
`CONTROLS_OUT` in `@m4l-jweb/bridge`.

---

## 3. What the Max side does

Read off this machine: Max's reference inside Live, Live's `MIDI Remote Scripts`, and
one shipping third-party device that implements takeover. Paths are Windows; the same
trees exist on macOS under
`/Applications/Ableton Live 12 Suite.app/Contents/App-Resources/`.

### 3.1 The call sequence

A commercial M4L device with an optional full takeover was read to find out which
documented calls a working implementation uses, and in what order. An `.amxd` is an
ordinary container - `ampf` / `meta` / `ptch`, patcher JSON in plain text, the same
layout `packages/build/src/amxd.mjs` writes - so this is an afternoon with a JSON
parser. **What was taken is the sequence of public API calls. No code, no logic, no
assets.**

**The takeover is entirely in the PATCHER.** No `[js]` is involved: that device's
scripts are its sequencer, while the grab is `live.path`, `live.object` and
`live.observer`. Which means this is generatable by `packages/build`, not necessarily
wrapper work. One reusable abstraction, instantiated once per control:

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

Four things settled by that diagram:

- **Addressing is by id.** `get_control <name>` returns one; the grab, the release and
  the observer all use it thereafter. `release_control` takes it too.
- **The whole 8x8 is ONE control.** `Button_Matrix` is grabbed once, not sixty-four
  times.
- **Input is a `live.observer` on the control's `value` property** - not `[js]`, not
  MIDI, not `[notein]`. Three atoms per event, `<x> <y> <value>`.
- **Painting is `call send_value <x> <y> <colour>`** on the same object. Colour is a
  palette index; `0` (off), `18`, `29` and `36` are attested.

The underlying LOM API, read from
`Resources/MIDI Remote Scripts/_MxDCore/LomTypes.pyc`:

```
get_control_names   get_control   grab_control   release_control
grab_midi           release_midi  send_midi      send_receive_sysex
```

`_get_control_or_raise` in `MxDControlSurfaceAPI.pyc` accepts an id *or* a name and
raises `"{} is not a control of '{}'"` on a miss - unusual for Max, and it is what
makes §4's spike cheap. `MxDCore.pyc` keeps a `GRABBED_CONTROLS_KEY` per device context
and walks it in `release_device_context`, so **grabs are dropped when the device goes
away**.

### 3.2 Finding the surface, and the generation question

Not a fixed path. `control_surfaces` is a **property of `live_app`**, read as a flat
list of `id N` pairs including empty slots (`id 0`):

```
[live.path] path live_app
[live.observer] property control_surfaces   -> id 0 id 1 id 0 ...
[zl iter 2]                                 -> one "id N" at a time
[live.object] gettype                       -> type <name>
[sel Push3 Push2 Push Move]
```

**The LOM type names are `Push`, `Push2`, `Push3` and `Move`.** Observing rather than
polling matters: a surface can be plugged in or reconfigured while the set is open.

Push 1 and 2 are Python remote scripts on disk (`Resources/MIDI Remote Scripts/Push/`,
`Push2/`, base `pushbase/`), so their element names are readable there:

```
Button_Matrix              the 8x8 grid
Scene_Launch_Buttons       Track_State_Buttons       Track_Select_Button
Up_Arrow  Down_Arrow  Left_Arrow  Right_Arrow
Shift_Button  Select_Button  Duplicate_Button  Undo_Button  New_Button
Play_Button  Record_Button  Automation_Button  Metronome_Button  Tap_Tempo_Button
Octave_Up_Button  Octave_Down_Button  Accent_Button  Repeat_Button
Note_Mode_Button  Session_Mode_Button  Device_Mode_Button  Clip_Mode_Button
Scale_Presets_Button  User_Button  Master_Select_Button  Track_Stop_Button
Track_Controls  Track_Control_Touches      (the eight encoders and their touch)
Touch_Strip_Control  Touch_Strip_Tap                          (Push 2)
Page_Left_Button  Page_Right_Button  Setup_Button  Layout  Convert (Push 2)
```

**Push 3 has no remote script.** It is native (`Resources/Program/Push3.exe`), reached
through `RemoteControlSurfaceWrapper` / `Live.Application.ControlSurfaceProxy`, and its
control names are declared by the firmware at runtime via an `M4lServices` protocol
(`add_control_description`, `grab_control`, `release_control`, `send_value`,
`receive_value`, `subscribe_to_control`, `pad_layout`, `release_all_controls`). No file
here lists them - **but the evidence says they are the same names**: §3.1's device
normalises `Push3`, `Push2` and `Push` to one code path and grabs the literal
`Button_Matrix` for all three. Strong evidence, not measurement (§4, U4).

`Move` is grabbable by the same API. Out of scope; worth knowing the door exists.

### 3.3 Three details that are the difference between working and nearly working

- **Contention is handled by waiting.** `[deferlow]` sits in front of the grab, beside
  a comment reading *"Wait with grabbing to give another instance time to release."* At
  the top, `[live.thisdevice]` gates everything (our hard rule 4, independently arrived
  at) and feeds a `[delay 300]` / `[delay 500]` before the first grab.
- **Focus is computed.** `this_device`'s id against
  `live_set view selected_track view selected_device` for device focus; `live_set view
  selected_track` against `[zl slice 4]` of the device's own canonical path for track
  focus. That is where §2.4's `focus` parameter lands.
- **Every send/receive name is `---` prefixed**, which is exactly the per-device
  expansion [MAX-FACTS.md](MAX-FACTS.md) records (`#0` does not expand in an `.amxd`;
  `---` does). Two instances otherwise share every receive.

### 3.4 `live.push` - real, useful, and a different feature

`Resources/Max/resources/docs/refpages/m4l-ref/live.push.maxref.xml`, digest
*"Configuration of Push 2 and 3"*: `play_pad_map` (`scale` | `serial`),
`play_note_colors` (up to 128 palette symbols, one per MIDI note), `play_usage`
(`never` | `first_or_selected` | `first`), and expressive-pad geometry
(`play_flat_zone`, `play_slide_height`, `play_in_tune_location`). Its own refpage states
the limit:

> *"the positioning of MIDI notes on matrix pads can change according to the
> user-selected layout and the octave up and down buttons on Push, so the assigned
> colors do not necessarily correspond to a specific pad."*

It colours **notes, not pads**. One box, a few attributes, no protocol, no risk - ship
it separately and first.

### 3.5 Where the library work lands

| Half | Where | Why there |
|---|---|---|
| discovery, grab, release, the value observer | a `takeover` chain in `packages/build/src/chains.mjs`, generated from `defineControls` | proven shape, and no `[js]` in the input path - a grabbed pad must not stop responding because a React render is slow |
| the frame diff and `send_value` | `packages/wrapper/src/controls.ts` | sixty-four cells is a frame buffer and wants a diff; the patcher cannot diff without sixty-four `[change]` objects |

`packages/wrapper/src/controls.ts` obeys the usual constraints: ES5, `var` and
`function`, `Task` not `setTimeout`, `post()` not `console`, and `send_value` called at
fixed arity - never assembled through `.apply`, which crashes the `[js]` engine
([MAX-FACTS.md](MAX-FACTS.md)).

### 3.6 The harness gets an 8x8 grid

`@m4l-jweb/surface/dev` already renders a mocked Live beside the app. Add a grid of divs
that paints from `paint`/`paint_all` and sends `pad` on click, and every device in
§5-§7 is buildable in a browser tab with no hardware in the room.

Not a nice-to-have here the way it was for parameters. Without it, every iteration is a
rebuild, a reinstall, a re-drag (Live embeds a copy of the device in the set, so
instances already on tracks do not update) and a squint at sixty-four LEDs. **Build the
mock grid before the first real device.** Its honest limit is the usual one: the
message-level contract, not pad latency, not pressure curves.

---

## 4. What is not known, and the spike

| # | Question | Why it matters |
|---|---|---|
| U1 | Does the value observer carry **pressure/aftertouch and slide**, or only press and release? | §6's continuous gestures are designed around this. §3.1's device carries 18 aftertouch and slide destinations, but those may ride the ordinary MIDI note path, not the grabbed control. |
| U2 | The **colour palette**: all 128 indices, and whether they mean the same on Push 1, 2 and 3. | §2.2's colour names are library data and have to be right. Only `0`, `18`, `29`, `36` are attested. |
| U3 | What does the user **see** during a grab, and does release restore Live's own mode? | A device that leaves Push broken after deletion is unshippable. The grab is dropped on teardown; the *display* is a separate question. |
| U4 | Does `Button_Matrix` resolve on **Push 3**? | Strong evidence yes (§3.2), no measurement. One `get_control_names` settles it. |
| U5 | The **repaint budget** - how many `send_value` calls per frame before Live's UI thread suffers? | Decides how hard §2.2's diff has to work. Snake at 8 fps is the cheap case; §7's full-grid repaint is not. |
| U6 | Are the **encoders** grabbable? | The answer should be "yes, and never" - confirming it lets the library refuse the role for a stated reason. |

### The spike: `push-probe`

A throwaway device in `src/app/`, a button and a log pane, the wrapper doing the work:

1. Observe `live_app`'s `control_surfaces`; `gettype` each id; post the list.
2. `get_control Button_Matrix`; post the id. Then `get_control_names` - the full
   vocabulary for whichever generation is plugged in (U4).
3. `grab_control`, observe `value`. Press, hold, press hard, slide, release; post every
   event (U1).
4. `call send_value x y c` across `c` in 0..127 on one pad; photograph it (U2). Then
   repaint all 64 in a loop and time it (U5).
5. `release_control`, and watch what Live puts back (U3).

Hard rules unchanged: every LiveAPI object created from `live.thisdevice`'s bang and
never in `loadbang`, recreated unconditionally on reload; `---` on every send/receive;
nothing out through `outlet.apply`.

**GATE: U1-U5 answered, with the console output, in a new
[MAX-FACTS.md](MAX-FACTS.md) section "Grabbing a Push control", on both a Push 2 and a
Push 3 if both are reachable - and if only one, the fact says which.**

---

## 5. Example 1 - `push-snake`, and it makes noise

**The exemplary device for this feature.** Snake, on the 8x8, in TypeScript, sounding
through the track. Chosen because its bugs are visible from across the room, its rules
fit in a paragraph, and it exercises every part of the API at once: a frame per tick, a
press handler, a worker clock, parameters, and Web Audio.

**Rules.** The snake moves one cell per tick. **Any pad press rotates it 90 degrees
clockwise** - the whole grid is one button, which is the entire input. Fruit appears on
a random free cell in a random colour; eating it grows the snake by one and speeds it
up. The walls are the edge of the grid - there is no wrap - and hitting a wall or
yourself ends the run.

### 5.1 The device

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

### 5.2 `controls.ts`

```ts
import { defineControls, grid } from "@m4l-jweb/surface";

export default defineControls({
  surface: "push",
  controls: {
    pads: grid({ role: "matrix", rows: 8, cols: 8 }),
  },
});
```

### 5.3 `surface.ts`

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

`defineControls` adds `takeover` and `focus` to that Surface (§2.4), so the bank shows
five controls and the user can hand the pads back without deleting the device.

### 5.4 `worker.ts` - the game

Everything stateful lives here, so it keeps running with the device view closed.

```ts
// src/app/push-snake/worker.ts
type Cell = [number, number];
type Colour = "green" | "red_red" | "yellow_highlight" | "sky" | "purple";

const W = 8, H = 8;
const FRUIT_COLOURS: Colour[] = ["red_red", "yellow_highlight", "sky", "purple"];
// Clockwise from up. A press advances one step around this ring.
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
  for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) if (free([x, y])) open.push([x, y]);
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

  // The wall is the outside of the grid, and there is no wrap.
  const hitWall = head[0] < 0 || head[0] >= W || head[1] < 0 || head[1] >= H;
  if (hitWall || !free(head)) {
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
 * One frame out per tick: a flat 64-cell array of colour NAMES, row-major from
 * the bottom-left. The page hands it straight to pads.draw(); the library works
 * out which cells actually changed.
 */
function paint(): void {
  const f: (Colour | "black" | "dark_grey" | "white")[] = new Array(W * H).fill("black");
  const at = (c: Cell) => c[1] * W + c[0];
  if (alive) f[at(fruit)] = fruitColour;
  snake.forEach((c, i) => { f[at(c)] = i === 0 ? "white" : alive ? "green" : "dark_grey"; });
  self.postMessage(["frame", f]);
}

self.onmessage = (e: MessageEvent) => {
  const [type, arg] = e.data as [string, number];
  if (type === "start") reset();
  else if (type === "stop") { alive = false; if (timer) clearInterval(timer); }
  else if (type === "turn") { if (alive) dir = (dir + 1) % 4; }   // any pad, clockwise
  else if (type === "speed") { baseHz = arg; if (alive) reschedule(); }
};
```

*(Variant worth one line: `dir = (dir + (e.x < 4 ? 3 : 1)) % 4` in the page turns left
on the left half and right on the right half. Same game, and it shows the coordinates
being used for something.)*

### 5.5 `App.tsx` - frames out, presses in, and the sound

```tsx
import { useEffect, useRef, useState } from "react";
import { useDevice, Frame } from "../shared/device";
import { useParam, useStateSync } from "@m4l-jweb/surface/react";
import { usePadGrid, usePadsHeld } from "@m4l-jweb/surface/react";
import GameWorker from "./worker.ts?worker&inline";
import surface from "./surface";
import controls from "./controls";

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

  // Any pad, on the way down only. Sixty-four pads, one verb.
  useEffect(() => pads.onPad((e) => { if (e.down) worker.current?.postMessage(["turn"]); }), [pads]);

  return (
    <Frame device={device} title="Snake">
      <p>{held ? "Pads: held" : "Pads: released - turn Takeover on"}</p>
      <p>length {length} · best {best}</p>
    </Frame>
  );
}
```

**What this device proves, and why it is the right first one:** a full frame every
tick through the diff (U5's load, visible); a press handler with no latency budget to
spare; the worker clock surviving a hidden page; two parameters driving the loop from
Live's side; a state slot that outlives the set; and audio out of the same page - all
in under two hundred lines, none of it about Max.

---

## 6. Example 2 - a DJ surface for `qobuz-dj`

`../m4l-qobuz-dj` is a two-deck mixer, scaffolded, nothing loaded in Live yet. Its
encoders are already declared - EQ, filter, trim, pitch - and they must **stay**
parameters, because those are the controls that automate and MIDI-map. What the grid
adds is the part a knob cannot do: **gestures**.

### 6.1 The layout: two halves and a seam

```
 y
 7  [ A cue 1..4 ][ B cue 1..4 ]      hot cues, lit in the deck's colour
 6  [ A cue 5..8 ][ B cue 5..8 ]
 5  [ A loop     ][ B loop     ]      1/4 1/2 1 2 bars
 4  [ A jog ring ][ B jog ring ]  <-+ the platters
 3  [ A jog ring ][ B jog ring ]  <-+
 2  [ A jog ring ][ B jog ring ]  <-+
 1  [ A jog ring ][ B jog ring ]  <-+
 0  [ - - - -  crossfade  - - - - ]   one row, eight cells, A .. B
     x=0 1 2 3    x=4 5 6 7
```

Left half is deck A, right half is deck B, and the bottom row is the seam between them.
Deck colours run through everything - a cue pad, a loop pad and the platter all read as
one deck at a glance, which is the only way an 8x8 stays legible in a dark room.

### 6.2 The crossfader: a row you drag

Row 0 is eight cells from full-A to full-B. Dragging along it moves the crossfader, and
the row lights as a bar so the position is readable without looking at the laptop.

```ts
pads.onPad((e) => {
  if (e.y !== 0 || !e.down) return;
  setCrossfade((e.x - 3.5) / 3.5);          // -1 .. +1, the declared parameter
});
```

**Eight cells is coarse, and that is the point of U1.** If the grabbed value stream
carries pressure and slide (§4), the same row becomes continuous: the cell gives the
coarse position, the slide within the pad gives the fine one, and a drag reads as a
smooth sweep rather than eight steps. The plan is deliberately written so the coarse
version *ships* and the continuous version is an improvement to one handler - not a
redesign waiting on a measurement.

**And it writes the real parameter.** The crossfade is a `dial` in `surface.ts`, so the
pads, the on-screen fader, an encoder and an automation lane are all moving the same
value. That is the whole reason the Surface stays the Surface.

### 6.3 The platters: a circular gesture

Rows 1-4 of each half are a 4x4 block, and its twelve perimeter pads are a ring. Read
the angle of whichever pad is touched, take the delta between consecutive touches, and
that is a jog wheel - the DJ idiom the grid is actually good at.

```ts
const ring = (deck: "A" | "B") => {
  const cx = deck === "A" ? 1.5 : 5.5, cy = 2.5;
  let last: number | null = null;

  return (e: PadEvent) => {
    if (!e.down) { last = null; return; }                 // lift ends the gesture
    const a = Math.atan2(e.y - cy, e.x - cx);             // -pi .. pi
    if (last !== null) {
      let d = a - last;
      if (d > Math.PI) d -= 2 * Math.PI;                  // wrap at the seam
      if (d < -Math.PI) d += 2 * Math.PI;
      nudge(deck, -d / (2 * Math.PI));                    // turns -> beats
    }
    last = a;
  };
};
```

Twelve perimeter pads is 30 degrees of resolution, which is enough for a nudge and a
scratch and not enough for a slow pitch bend - so the *sustained* correction stays on
the pitch encoder where it belongs, and the platter is for the gesture. If U1 delivers
pressure, pressure becomes the scrub depth and the same ring gains a second axis.

The ring animates: the pad at the current playhead phase lights brighter, so both
platters visibly spin, and two decks running out of phase is something you can see
before you can hear it.

### 6.4 Cues and loops

Rows 5-7 are ordinary buttons, and they are where the grid beats a knob outright: eight
hot cues per deck, addressable in one press, lit to say which are set.

```ts
pads.onPad((e) => {
  if (e.y < 5 || !e.down) return;
  const deck = e.x < 4 ? "A" : "B";
  const col = e.x % 4;
  if (e.y >= 6) jumpToCue(deck, (7 - e.y) * 4 + col);     // 8 cues
  else setLoop(deck, [0.25, 0.5, 1, 2][col]!);            // 4 loop lengths
});
```

Cue points persist in a `state()` slot, so they save with the set - a hot cue that
vanishes when the set is reopened is worse than no hot cue.

### 6.5 Where this sits in the order

**Second, and it stays second.** `../m4l-qobuz-dj`'s own gates come first: its CORS
spike, and the memory question in its stage 2 (a decoded 10-minute FLAC is ~210 MB in
the AudioContext; two decks plus a preload is over half a gigabyte inside a Chromium
context inside Live). Pads on a mixer that has never made a sound are decoration.

What it is worth *now* is negative: nothing in `defineControls` should assume the grid
belongs to a sequencer. §7 will push hard in that direction, and this layout - halves,
a seam, a ring, no steps anywhere - is the cheapest available check that the API did
not follow it.

---

## 7. Example 3 - the Circuit Tracks scale explorer

The full Circuit emulation is a large device: nine views, thirty-two steps, eight
patterns per track, scenes. **This example is one view of it** - Scales - because it is
self-contained, it is the view whose behaviour is already written down, and it is the
one that most obviously wants sixty-four pads.

`../trackster` implements the same feature as a web app, and its data model is the
specification: `src/components/devices/Circuit/Scales/scalesData.ts` carries sixteen
scale modes as interval sets and the Circuit's piano-shaped chromatic layout. That file
is the *spec*, not a dependency - this device shares no code with it.

### 7.1 What the Circuit does

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

### 7.2 The Push layout

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

### 7.3 The device

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

**Root and scale are parameters, not app state** - the pattern §3.1's device uses for
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

### 7.4 The frame

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

### 7.5 The handler

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

### 7.6 What it demonstrates that Snake does not

Three regions with three different behaviours on one grabbed control; parameters as the
shared truth between pads, encoders and automation; a `defineWatch` binding to Live's
own state; and a repaint that is *conditional* rather than periodic - the frame is
redrawn when root, scale or octave changes and at no other time, which is the opposite
of §5's per-tick redraw and the other half of U5's load profile.

---

## 8. Order of work

```
  1. live.push in defineSurface           small, independent, ships on its own (§3.4)
  2. push-probe                           the spike; the gate for everything below (§4)
  3. the mock 8x8 grid in the harness     before any device (§3.6)
  4. defineControls + the takeover chain  the library extension (§2, §3.5)
  5. push-snake                           the exemplary device (§5)
  6. the Circuit scale view               a second shape on the same API (§7)
  7. qobuz-dj pads                        after that project's own stage 4 (§6)
```

Steps 1 and 2 are independent. **Nothing below step 2 starts until its gate is met.**

Two tests every device from step 5 on must carry, both of them cheap and both of them
invisible with one device on the desk: **two instances in one set** (contention, §3.3)
and **takeover switched off** (the device must still work, on screen, with no hardware
attached).

---

## 9. Where the names live

Never from memory, and never from a model. Under `C:\ProgramData\Ableton\`:

```
Resources\Max\resources\docs\refpages\m4l-ref\          live.push, live.banks, parameters
Resources\Max\resources\docs\userguide\content\m4l\     the LOM overview
Resources\MIDI Remote Scripts\_MxDCore\                 the LOM's own implementation
Resources\MIDI Remote Scripts\pushbase\                 Push 1/2 element names
Resources\MIDI Remote Scripts\Push2\                    Push 2's additions
Resources\Program\Push3.exe                             Push 3's M4lServices protocol
```

The `.pyc` files are Python 3.11 bytecode and do not decompile with a newer interpreter,
but their string constants come out of a plain byte scan - which is where §3.2's names
came from. `Push3.exe` yields its protocol through its C++ symbol names. A third-party
`.amxd` is an ordinary container whose patcher JSON is plain text, which is a legitimate
way to learn **which documented calls** a device makes.

**And when the name matters, ask the object.** `get_control_names` returns the truth for
the surface actually plugged in, `_get_control_or_raise` errors on a bad one, and no
file on disk can tell you what a Push 3 declared this morning.
