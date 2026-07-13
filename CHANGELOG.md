# Changelog

## 0.5.0 - composable audio chains

**Audio chains stack.** `chains: ["lowpass", "drive", "gain"]` is a series -
`plugin~ -> onepole~ -> overdrive~ -> *~ -> plugout~` - and the **order of the list
is the signal path**. Confirmed by ear, in Live.

Before this, they did not stack: they **mixed**, silently. Every audio chain created
its own `plugin~` and `plugout~` and wired itself between them, so two of them were
two devices fighting over one patcher - duplicate box ids, and the dry signal summed
back over the wet one. No error at build time, none in Live; the device just sounded
wrong in a way you would blame on your own DSP.

The endpoints now belong to the **device**, created once by the build for any `audio`
or `instrument` type, and a chain claims one **stage** between them. It is the twin
of `claimAppMessages()`: one stream, several claimants, chained in series with an
explicit hand-off rather than hung off the source in parallel.

New chain: **`drive`** (`overdrive~`, soft-clipping distortion, 1 = clean to 10 =
filthy). It is in the vocabulary for testability as much as for sound - `lowpass` and
`gain` are both linear and therefore *commute*, so a composition built only from
those two sounds identical whichever way round it goes, and cannot be verified by
ear.

### Breaking

**A chain must not create `plugin~` / `plugout~`.** Take the stage before you and
hand yours on:

```js
const [srcId, srcOutlet] = ctx.audioIn(channel);   // whatever the last stage left
// ...create your DSP, wire srcId -> yours...
ctx.setAudioOut(channel, myId, 0);                 // you are the tail now
```

A chain that still creates the endpoints now **fails the build**: a second box with
an existing id throws (`assertUniqueBoxIds()`), because a patcher with two boxes
sharing an id is one Max resolves however it likes. That guard is the error message
this bug never had.

**An audio chain on a `type: "midi"` device fails the build** too, instead of
conjuring endpoints and quietly making the device something the manifest never
declared.

### Also

- **`composePatcher()`** is exported from `@m4l-jweb/build`: the build's own
  per-device pipeline (endpoints, chains, surface, close, validate), so a test can
  generate a patcher exactly as the build does rather than re-implementing the order
  of its steps.
- **A chain takes a parameter in REAL units and does no arithmetic on it.** The range,
  the unit and the curve live on the parameter (`range: [40, 18000]`, `unit: "Hz"`,
  `exponent`). A chain that re-introduces an `[expr]` mapping double-maps a parameter
  that already carries its own curve.
- **`hello-audio` is now three chains** (`lowpass`, `drive`, `gain`), and
  **`hello-audio-rev`** is the same app and the same parameters with the *opposite*
  order - the pair that proves the series is real. See below.

## 0.4.0 - the Surface

A device's Live parameters are declared **once**, in `src/app/<device>/surface.ts`,
and everything else is generated from that declaration: the `live.*` objects, their
patcher wiring in both directions, the protocol selectors the lint checks, and a
typed React binding. See [doc/ARCHITECTURE.md](doc/ARCHITECTURE.md).

```ts
// src/app/<device>/surface.ts
export default defineSurface({
	params: {
		cutoff: dial({ range: [40, 18000], unit: "Hz", exponent: 4, default: 18000, short: "Cutoff" }),
	},
});
```

```tsx
const [cutoff, setCutoff] = useParam(surface, "cutoff"); // number, typed, two-way
```

### Breaking

**1. `parameters` is gone from `patcher/devices.mjs`.** Declare them in
`surface.ts`. The build **fails** on a leftover `parameters` field rather than
ignoring it - a silently dropped parameter is a device whose knobs vanished.

**2. A custom chain must claim the app's messages with `claimAppMessages()`.**
Routes are chained in **series**, each handing its unmatched outlet to the next
(`[jweb] -> [route midinote flush] -> [route set_*] -> [js]`), because two routes
hanging off `[jweb]` in parallel each pass the unrouted messages on - so the
wrapper sees every `ui_ready` twice. If your chain does this:

```js
removeLine(lines, jwebId, unmatchedId);
lines.push(line(jwebId, 0, "obj-my-route", 0));
lines.push(line("obj-my-route", 2, unmatchedId, 0)); // unmatched carries on
```

replace all three lines with:

```js
claimAppMessages(ctx, "obj-my-route", 2); // ctx, the route's id, its unmatched outlet
```

The build **fails** if a chain cut `[jweb]`'s cord without saying where the messages
went. A chain that never touched that cord (it only *taps* `[jweb]`'s outlet in
parallel) needs no change.

> Do **not** find the cord to cut by searching for whatever feeds `[js]`.
> `live.thisdevice` feeds it too, and cutting *that* cord kills every LiveAPI
> observer in the device, silently.

**3. A parameter's selectors must not be re-declared in `protocol.ts`.** `<id>` and
`set_<id>` are generated; the lint fails if a device also names them by hand. Bind
them with `useParam()`, which derives both from the declaration.

**4. A chain that drives DSP from a parameter reads it from the surface.** `lowpass`
needs a `cutoff`, `gain` needs a `gain`, and the build fails with a clear message if
the device's `surface.ts` does not declare it. Wire a parameter into DSP only via
`fanParamInto()`, which wires the object's outlet **and** the route's, or neither -
`set` silences a `live.*` object's outlet for *everyone*, including whatever it
drives inside the patcher.

### Fixed - three bugs that were silent in Live

- **A range was written to a key Max ignores.** `parameter_range` is not what Max
  uses for a continuous parameter (it appears in none of the patchers Ableton
  ships); the range is `parameter_mmin` / `parameter_mmax`. Every declared range was
  quietly discarded and the object kept its default.
- **A float parameter was printed as an integer.** With no `parameter_unitstyle`,
  Live rounds the *readout*: a smooth 0-1 cutoff reads "0" or "1" on a Push.
  Declare `unit` (`"Hz"`, `"dB"`, `"ms"`, `"%"`, `"st"`, or any custom string) and
  put the range in **real units**, with `exponent` for the knob's curve.
- **`live.thisdevice`'s cord could be cut** by the Surface interposing its route -
  which would kill every LiveAPI observer in the device. Routes now hand off
  explicitly.

### Added

- `@m4l-jweb/surface/react` - `useParam()`, `useSurface()`.
- `@m4l-jweb/surface/store` - the same state with no React in it.
- The dev harness renders the **parameter panel** and a **Push preview** from the
  declaration.
- `esbuild` is now a dependency of `@m4l-jweb/build` (it bundles `surface.ts`, which
  is TypeScript importing TypeScript, so Node can import it at build time).

### Not yet

**Push banks.** They need patcher-JSON archaeology and block nothing: Live falls back
to declaration order and shows every parameter. The harness's Push preview already
renders declared banks.
