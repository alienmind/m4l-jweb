# The Surface - parameters, declared

*Status: the declaration and the **Max-side codegen** ship - `defineSurface()` in
`@m4l-jweb/surface`, compiled by `applySurface()` in `@m4l-jweb/build`. The
**app-side** derivations - `useParam()`, the generated protocol selectors, the
harness's parameter panel and Push preview - do not, and neither do banks. This
file is the design; **[TODO.md](TODO.md)** is the order, and says what is left.*

---

## What it does

The Surface brings the capability to put a device's parameters on the control
surface **declaratively**, instead of hand-wiring them.

A control that Push can see is a real Live parameter, and a real Live parameter is
several things at once: a `live.*` object with `parameter_enable` on, a short name
that fits an encoder label, a bounded range with an initial value, patcher wiring
out to the app and back in again, a selector on the message protocol, and a bank
to sit in. You declare it once, and the build emits all of that.

## The primitives

Three parameter kinds, which are the three things Live can automate and Push can
render. Each becomes a `live.*` box, produced by the existing `box()` DSL:

| Declaration | Max object | `parameter_type` | Notes |
|---|---|---|---|
| `dial({ range, step })` | `live.dial` | 0 (float), or 1 (int) if `step` is 1 | `parameter_range` from `range` |
| `toggle()` | `live.toggle` | 2 (enum) | range `[0, 1]` |
| `menu({ options })` | `live.menu` | 2 (enum) | `parameter_enum` from `options` |

Every one of them carries `parameter_enable: 1`, `parameter_longname` (the key you
declared it under, which is also the message selector), `parameter_shortname` (from
`short`), and `parameter_initial` + `parameter_initial_enable` (from `default`).

They are grouped into **banks**: Push renders eight encoders at a time, and a bank
is a page.

## Using it

### 1. Declare the parameters

```ts
// src/app/<device>/surface.ts
import { defineSurface, dial, menu, toggle } from "@m4l-jweb/surface";

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
			format: (v) => `${Math.round(v * 100)}%`, // what the harness and Push print
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

	banks: [{ name: "Perform", params: ["slot", "density", "octave", "running"] }],
});
```

**Set `default`.** A `live.*` object with no initial value loads at the *bottom* of
its range, and for many parameters the bottom of the range is a broken device - a
filter cutoff of 0 loads as a device that eats the signal, and it looks exactly
like a bug in your DSP.

### 2. What that gets you

From that one declaration the build derives:

1. the **Max objects**, per the table above;
2. their **patcher wiring, in both directions** - a knob turn (or an automation
   lane, or a Push encoder) arrives in the app as `density 0.42`, and the app
   writes the parameter back with `set_density 0.42`, which moves the dial, the
   automation lane, Push, and whatever the parameter drives in the signal path;
3. the **protocol selectors**, so the existing lint covers a parameter exactly as
   it covers a hand-written message;
4. a **typed React binding**, `useParam(surface, "density")`;
5. a **mock** for the dev harness, which renders the parameters and a Push preview
   beside your app in a browser.

### 3. Bind it in the app

```tsx
// src/app/<device>/App.tsx
import { useParam } from "@m4l-jweb/surface/react";
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
encoder moves the React state; dragging the React slider moves the Live parameter,
so it is visible to automation, to MIDI mapping and to Push, all at once.
`useSurface(surface)` returns the whole bag for the rare component that wants it.

The value type follows the declaration: `number` for a `dial`, `boolean` for a
`toggle`, the union of `options` for a `menu`.

### What is checked, and when

- `banks` may only name params that exist - enforced by the type system
  (`keyof typeof params`), so a renamed parameter breaks the build at the typo.
- A bank holds at most 8 params. Push has eight encoders; a ninth is a silent
  truncation.
- A `dial`'s `default` is inside its `range`; a `menu`'s is one of its `options`.
- `short` is at most 8 characters, because Push truncates rather than complains.
- A chain that drives DSP from a parameter (`lowpass` wants `cutoff`) fails the
  build if the surface does not declare it.

The last four throw at declaration time rather than in the type system. That is not
a weaker guarantee: the build imports `surface.ts` to generate the patcher, so a
violation fails `pnpm build` and fails CI. It is only a less pretty error message.

---

# The design

## Two surfaces, one state

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
                        src/app/<device>/surface.ts
```

Push cannot see your React UI - not yours, not anyone's. It reads Live parameters
and nothing else. So the Surface is not a lesser copy of the app's UI; it is the
half of the device that reaches the hardware, and it is generated from the same
declaration the app binds to.

This is a component model in the React sense - declarative, composable, code, not
pixels - but it compiles to Max objects instead of DOM.

## How it compiles

### 1. Reading the declaration at build time

`surface.ts` is TypeScript, and it imports `@m4l-jweb/surface`, so it has to be
bundled before Node can evaluate it: esbuild, to a temp ESM module, in
milliseconds. `defineSurface()` returns plain serializable data, so nothing exotic
crosses the boundary.

> **Constraint:** `format` is a *function*, and functions do not serialize into a
> patcher. It survives the import (this is a module, not JSON) and is used
> app-side only - the dev mock, and the Push preview. Do not try to ship it into
> `[js]`.

### 2. Generating the objects

Per the primitives table above. **Built** - `applySurface()` in
`packages/build/src/surface.mjs`. It replaced `addParameters()`, and the manifest's
`parameters` field is gone.

`parameter_initial` is a list, and it is **inert without
`parameter_initial_enable`** - setting one without the other silently does nothing,
which is the worst way for this to fail. The compiler always emits both.

### 3. Wiring, in both directions

This is the part with a real trap in it.

**Parameter -> app** is the easy direction:

```
[live.dial] -> [prepend density] -> [jweb]
```

**App -> parameter.** The app emits `set_density 0.42`, and the patcher routes it
to the object's inlet. But sending a bare value into a `live.dial`'s inlet **sets
it and makes it output**, which sends it straight back to the app, which may set it
again: a feedback loop that with floats can oscillate rather than settle.

Two defences, both required:

1. **Suppress the echo at the source.** `live.*` objects accept a `set <value>`
   message that updates the value **without** producing output. So the generated
   wiring is `[route set_density] -> [prepend set] -> [live.dial]`.
2. **Suppress the echo at the destination anyway.** The React hook drops an inbound
   value equal to the one it just sent (within an epsilon for floats). Belt and
   braces: `set` is the documented behaviour, but a value arriving from automation
   *while* the user drags a slider must not fight them either.

> **Measured in Live, and it is sharper than the design assumed.** `set` does
> suppress the outlet (spike 1.1) and the parameter is still written (spike 1.1b,
> on a Push). But the suppression is not scoped to the app: it silences the
> object's outlet for **everyone**, including whatever that object drives inside
> the patcher. Defence 1 alone produces a device whose slider moves the dial and
> nothing else - which is exactly what `hello-audio` shipped.
>
> So the generated wiring **fans the value out**: the route's outlet goes to the
> object (via `prepend set`) *and*, in parallel, straight to the parameter's
> consumers. `fanParamInto()` in `chains.mjs` is the only way a chain may wire a
> parameter, and it wires both sources or neither.

Routes are chained in **series**, each handing its unmatched outlet to the next
(`claimAppMessages()`): `[jweb] -> [route midinote flush] -> [route set_*] -> [js]`.
Two routes hanging off `[jweb]` in parallel would each pass the unmatched messages
on, and the wrapper would see every one of them twice.

### 4. Push banks

Max stores parameter-bank definitions in the patcher. The generator writes them
from `banks`, in order, with `parameter_shortname` doing the labelling.

> **Verify before implementing:** the exact patcher JSON key and shape. It is
> discoverable the way the container format was - configure banks once in the Max
> editor, save, and diff the patcher JSON. Do not guess it from memory; write the
> round-trip test first. Until it is known, Push still shows every parameter (Live
> falls back to declaration order), so banks are a refinement, not a blocker:
> **shipping the parameters is what makes Push work at all.**

### 5. Protocol, for free

The Surface generates its own selectors: one `IN` per param (`density`), one `OUT`
per param (`set_density`). These are appended to the protocol the existing lint
already checks, so a param declared but never wired fails CI - the same guarantee
the hand-written selectors get.

## The dev harness: a mocked Live

The build **knows what the Max side is**, so it can render it.
`@m4l-jweb/surface/dev` is a dev-only React harness:

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
|  | A  |50% | 0  |on  |    |   <- set_density 0.42
|  +----+----+----+----+    |   -> density 0.42
+---------------------------+
```

- **A mock transport.** Play/stop and a BPM field, driving a real clock that emits
  `tick <playing> <beats>` and `tempo <bpm>` into the bridge at the cadence the
  wrapper polls at. A sequencer is developable without Live.
- **The Surface, rendered as HTML controls**, from the same declaration the Max
  objects come from. Moving one sends the param message exactly as `[live.dial]`
  would.
- **A Push preview.** The banks, eight cells at a time, with `short` names and
  `format`ted values. Getting this wrong is normally a hardware-in-the-loop
  discovery; here it is a browser tab.
- **A message log.** Every selector crossing the bridge, both directions.
- **Automation injection.** Optional: script a param over time, to prove the app
  responds to automation and not just to the mouse.

It renders only when `import.meta.env.DEV`, and never reaches the bundle embedded
in the `.amxd`.

**The honest limit.** A mock is a mock. It cannot tell you about MIDI timing
jitter, real DSP, or the LiveAPI's behaviour on a loaded set. What it gives you is
the whole *message-level contract* of your device, exercised without a DAW - the
part that is tedious to test and easy to get wrong. Keep "load it in Live" for what
genuinely needs Live.

## CI invariants

An invariant is enforced, not documented:

1. Every param in `surface.ts` produces a `live.*` box with `parameter_enable: 1`
   in every generated patcher.
2. Every param is wired in **both** directions - out to `[jweb]`, and back from it
   via `set_<id>` - and the write reaches the object as `set`, never as a bare
   value.
3. A parameter's consumers receive the value the app wrote (the fan-out). Both
   halves of the `set` behaviour are pinned separately: break either and exactly
   one test fails.
4. Every bank names only declared params, and holds at most 8.
5. Every param's `default` is inside its `range`.
6. A generated patcher still round-trips through the container writer.
7. The dev harness never appears in a production bundle.

## Open questions

- **The bank format.** Unknown patcher JSON. Discover by diffing, as above.
- **Parameter count limits.** Live's per-device parameter budget is unchecked. A
  device with 60 declared params may hit a wall.
- **Modulation vs. value.** Live parameters have both a value and a modulation
  amount. This design models only value. Whether that is a real limitation depends
  on devices nobody has written yet.
