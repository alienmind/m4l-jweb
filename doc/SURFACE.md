# Addendum: the Surface - a component model for the Max side

*Design document. Nothing here is implemented yet. It describes
`@m4l-jweb/surface`, the planned fourth package.*

---

## The problem, stated precisely

M4L-JWEB's [architecture doc](ARCHITECTURE.md) makes a claim about Push and then
leaves the reader to do the work by hand:

> Push support is not about the UI technology at all. It is about exposing your
> musically meaningful controls as real Live parameters: add `live.dial` /
> `live.toggle` / `live.menu` objects with `parameter_enable` on, give them short
> names and sensible ranges, wire them into the same message protocol your UI
> uses, and group them into banks so Push pages read like a performance surface.

Every sentence of that is a manual, error-prone step, and it is the one part of
the stack that fell back to "go draw it in Max". You end up maintaining the same
control in four places: the Max object, the patcher wiring, the app's protocol,
and the app's state. Change a range, and three of the four silently disagree.

The rest of the project deleted the visual editor by making patchers generated.
This does the same for parameters.

## The idea

A device has **two surfaces**, and they are not competing - they are different
projections of the same state:

```
   the Surface (Max)                     the App (Chromium)
   real Live parameters                  your React UI
   automatable, MIDI-mappable            canvas, WebGL, whatever
   THE ONLY THING PUSH SEES              the deep editor on the laptop
  +---------------------+               +----------------------------+
  |  Slot  Dens  Oct    |  <--------->  |                            |
  |  ( )   ( )   ( )    |   one shared  |    your actual UI          |
  |  Run                |    protocol   |                            |
  +---------------------+               +----------------------------+
              \                                     /
               \                                   /
                +----- one declaration in code ---+
                        src/app/surface.ts
```

You declare the parameters **once, as code**. From that one declaration the
build derives:

1. the `live.*` objects, with `parameter_enable`, ranges, units and short names;
2. their patcher wiring, in both directions;
3. the Push bank layout;
4. a typed React hook (`useParam("density")`) for the app;
5. the protocol selectors, so the existing protocol lint covers them for free;
6. a **mock Live** for `pnpm dev`, which renders the Surface next to your app.

That last one is the point where this stops being plumbing and starts being a
development environment: **you see both halves of your device, side by side, in a
browser, with hot reload, and you can see what Push will show.**

This is a component model in the React sense - declarative, composable, code, not
pixels - but it compiles to Max objects instead of DOM.

---

## The API

### Declaring the Surface

```ts
// src/app/surface.ts
import { defineSurface, dial, toggle, menu } from "@m4l-jweb/surface";

export default defineSurface({
	params: {
		slot: menu({
			options: ["A", "B", "C", "D"],
			default: "A",
			short: "Slot", // Push has ~8 chars per encoder label
		}),
		density: dial({
			range: [0, 1],
			default: 0.5,
			unit: "%",
			format: (v) => `${Math.round(v * 100)}%`, // what Push prints under the encoder
			short: "Dens",
		}),
		octave: dial({
			range: [-4, 4],
			step: 1, // integer parameter
			default: 0,
			short: "Oct",
		}),
		running: toggle({ default: false, short: "Run" }),
	},

	// Push renders parameters in banks of eight. A bank is a page.
	banks: [
		{ name: "Perform", params: ["slot", "density", "octave", "running"] },
		{ name: "Shape", params: ["attack", "decay", "swing"] },
	],
});
```

Type-level guarantees worth having:

- `banks` may only name params that exist (`keyof typeof params`).
- A bank may hold at most 8 params. Push has eight encoders; a ninth is a silent
  truncation today.
- `default` must be within `range`.
- `format` receives the parameter's own value type (`number` for `dial`,
  `boolean` for `toggle`, the union of `options` for `menu`).

### Using it from the app

```tsx
// src/app/App.tsx
import { useParam, useSurface } from "@m4l-jweb/surface/react";
import surface from "./surface";

export default function App() {
	const [density, setDensity] = useParam(surface, "density"); // number, typed
	const [running, setRunning] = useParam(surface, "running"); // boolean, typed

	return (
		<>
			<Slider value={density} onChange={setDensity} />
			<button onClick={() => setRunning(!running)}>{running ? "stop" : "start"}</button>
		</>
	);
}
```

`useParam` is a two-way binding to a **real Live parameter**. Turning the Push
encoder moves the React state; dragging the React slider moves the Live
parameter, which means it is visible to automation, to MIDI mapping, and to Push,
all at once. `useSurface(surface)` returns the whole bag for the rare component
that wants it.

The `[js]` layer stops being "thin glue you write" and becomes "generated code
you do not write at all".

---

## How it compiles

### 1. Reading the declaration at build time

`surface.ts` is TypeScript that must be evaluated by Node during the build. Bundle
it with esbuild to a temp ESM module and import it - the same trick the manifest
already relies on, one step fancier because this file has app imports. The
`defineSurface()` call returns a plain, serializable object, so nothing exotic
crosses the boundary.

> **Constraint:** `format` is a *function*, and functions do not serialize into
> a patcher. It is used in two places only - the dev mock, and (optionally) a
> generated `live.text` display - so it stays app-side. The Max object's own
> unit/format attributes cover what Push prints. Do not try to ship `format`
> into `[js]`.

### 2. Generating the objects

Each param becomes a `live.*` box, produced by the existing `box()` DSL:

| Declaration | Max object | `parameter_type` | Notes |
|---|---|---|---|
| `dial({ range, step })` | `live.dial` | 0 (float) or 1 (int) if `step` is 1 | `parameter_range` from `range` |
| `toggle()` | `live.toggle` | 2 (enum) | range `[0, 1]` |
| `menu({ options })` | `live.menu` | 2 (enum) | `parameter_enum` from `options` |

with `parameter_enable: 1`, `parameter_longname: <id>`, and
`parameter_shortname: <short>`. This is a superset of what
`addParameters()` in `chains.mjs` already does; the Surface replaces that
function and deletes the `parameters` field from the manifest.

### 3. Wiring, in both directions

This is the part with a real trap in it.

**Parameter -> app** is easy and already exists:

```
[live.dial] -> [prepend density] -> [jweb]
```

**App -> parameter** is new. The app emits `set_param density 0.42`; the patcher
routes it to the object's inlet:

```
[jweb] -> [route set_param] -> [route density octave ...] -> [live.dial]
```

Sending a value to a `live.dial`'s inlet **sets it and makes it output**, which
sends it straight back to the app, which may set it again. That is a feedback
loop, and with floats it can oscillate rather than settle.

Two defences, both required:

1. **Suppress the echo at the source.** Feed the app-bound path through the Max
   object's *set* semantics rather than its *output* semantics. `live.dial`
   accepts a `set <value>` message that updates the value **without** producing
   output - exactly what we want. So the generated wiring is
   `[route density] -> [prepend set] -> [live.dial]`.
2. **Suppress the echo at the destination anyway.** The React hook drops an
   inbound value that equals the one it just sent (within an epsilon for floats).
   Belt and braces: `set` is the documented behaviour, but a value that arrives
   from automation *while* the user drags the slider must not fight them either.

> **Verify before implementing:** that `set` on `live.dial` / `live.toggle` /
> `live.menu` sets-without-output in the M4L build of Max, and that the value
> still reaches Live's automation lane (it should - the parameter value changed;
> only the *outlet* is silent). If it does not, fall back to a `[gate]` around the
> app-bound path that the wrapper closes for one scheduler tick after a
> `set_param`.

### 4. Push banks

Max stores parameter-bank definitions in the patcher. The generator writes them
from `banks`, in order, with `parameter_shortname` doing the labelling.

> **Verify before implementing:** the exact patcher JSON key and shape for
> banks. It is discoverable the way the container format was - configure banks
> once in the Max editor, save, and diff the patcher JSON. Do not guess it from
> memory; write the round-trip test first. Until it is known, Push will still
> show every parameter (Live falls back to declaration order), so banks are a
> refinement, not a blocker: **shipping the parameters is what makes Push work at
> all.**

### 5. Protocol, for free

The Surface generates its own selectors: one `IN` per param (`density`), plus a
single `OUT` (`set_param`). These are appended to the protocol the existing lint
already checks, so a param that is declared but never wired fails CI - the same
guarantee the hand-written selectors get.

---

## The dev harness: a mocked Live

`pnpm dev` today opens your app in a browser with `maxSimulate` on the console.
That is a shim, not an environment. The Surface makes something much better
possible, because now the build **knows what the Max side is**.

Ship `@m4l-jweb/surface/dev`: a dev-only React harness that renders

```
+---------------------------+  +--------------------------------------+
|  LIVE (mocked)            |  |  [jweb] - your app, hot-reloading    |
|                           |  |                                      |
|  Transport                |  |                                      |
|   [>] play   120.0 BPM    |  |        <App />                       |
|   bar 3 | beat 2.75       |  |                                      |
|                           |  |                                      |
|  Device parameters        |  |                                      |
|   Slot    [ A v ]         |  |                                      |
|   Dens    (o)   50%       |  |                                      |
|   Oct     (o)   0         |  |                                      |
|   Run     [x]             |  |                                      |
|                           |  +--------------------------------------+
|  PUSH preview  (bank 1/2) |
|  +----+----+----+----+    |  Message log
|  |Slot|Dens|Oct |Run |    |   -> tick 1 10.25
|  | A  |50% | 0  |on  |    |   <- set_param density 0.42
|  +----+----+----+----+    |   -> density 0.42
+---------------------------+
```

Concretely, the harness provides:

- **A mock transport.** Play/stop and a BPM field, driving a real clock that
  emits `tick <playing> <beats>` and `tempo <bpm>` into the bridge at the same
  50 ms cadence the wrapper polls at. Suddenly a sequencer is developable without
  Live.
- **The Surface, rendered as HTML controls**, from the same declaration the Max
  objects come from. Moving one sends the param message exactly as `[live.dial]`
  would. This is the left half of the device - the half that is real to Push.
- **A Push preview.** The banks, eight cells at a time, with `short` names and
  `format`ted values. You are looking at what a Push user will look at. Getting
  this wrong is normally a hardware-in-the-loop discovery; here it is a browser
  tab.
- **A message log.** Every selector crossing the bridge, both directions. The
  single best debugging tool this stack could have, and it costs almost nothing
  once the bridge is the only channel.
- **Automation injection.** Optional: script a param over time to prove the app
  responds to automation, not just to the mouse.

The harness renders only when `import.meta.env.DEV`; it is never in the bundle
that gets embedded into the `.amxd`.

**The honest limit.** A mock is a mock. It cannot tell you about MIDI timing
jitter, real DSP, or the LiveAPI's genuine behaviour on a loaded set. What it
gives you is the *whole message-level contract* of your device, exercised
without a DAW - which is the part that is tedious to test and easy to get wrong.
Keep "load it in Live" for what genuinely needs Live.

---

## Why this is the interesting part of the project

The current split is: the app is modern, the Max side is a thin escape hatch you
keep as small as possible because working on it is unpleasant.

The Surface inverts that. The Max side becomes *declarative and typed*, so it
stops being the part you avoid. And it happens to be the half that reaches the
hardware: the parameter surface is what a performer touches on Push, and the
web UI is what the producer touches on the laptop. Both, from one declaration,
in one language, testable in a browser.

That is not a nicer build. That is the actual thing a device author wants.

---

## CI invariants this must add

Following the project's rule that an invariant is enforced, not documented:

1. Every param in `surface.ts` produces a `live.*` box with `parameter_enable: 1`
   in every generated patcher.
2. Every param is wired in **both** directions (to `[jweb]`, and from
   `[jweb]` via `set_param`).
3. Every bank names only declared params, and holds at most 8.
4. Every param's `default` is inside its `range`.
5. A generated patcher still round-trips through the container writer.
6. The dev harness never appears in a production bundle (assert the built
   `ui.html` does not contain the harness marker).

## Implementation order

1. **`defineSurface()` + types.** Pure data and typing. No Max, no React. Ship
   the type-level guarantees (bank membership, bank size, default-in-range)
   first; they are most of the value and cost nothing at runtime.
2. **Codegen.** Replace `addParameters()` in `chains.mjs` with the Surface
   compiler: objects, both wiring directions, protocol selectors. Land the
   feedback-loop defence (`set`) with a test that the app-bound path stays
   silent.
3. **React hooks.** `useParam` / `useSurface`, with echo suppression.
4. **The dev harness.** Transport, parameter panel, message log. This is where
   the project stops being a build system and becomes a development environment.
5. **Push banks.** Last, because it needs the patcher-format archaeology and
   nothing else is blocked on it.
6. **Port the transposer.** Its one `live.dial` becomes three lines of
   `surface.ts` and the example gets *shorter*. If it does not, the API is wrong.

## Open questions

- **`set` semantics.** The whole no-feedback design rests on `live.*` objects
  accepting `set` without producing output. Verify first; the `[gate]` fallback
  is uglier but workable.
- **The bank format.** Unknown patcher JSON. Discover by diffing, as above.
- **Parameter count limits.** Live's per-device parameter budget is not something
  this design has checked. A device with 60 declared params may hit a wall.
- **Modulation vs. value.** Live parameters have both a value and a modulation
  amount. This design only models value. Whether that is a real limitation
  depends on devices nobody has written yet.
- **Should the manifest keep `parameters`?** No: the Surface subsumes it. But that
  is a breaking change to `devices.mjs`, so land the Surface first and delete the
  old field in the same release.
