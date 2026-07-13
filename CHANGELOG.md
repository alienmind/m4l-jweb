# Changelog

## 0.4.0 - the Surface

A device's Live parameters are declared **once**, in `src/app/<device>/surface.ts`,
and everything else is generated from that declaration: the `live.*` objects, their
patcher wiring in both directions, the protocol selectors the lint checks, and a
typed React binding. See [doc/SURFACE.md](doc/SURFACE.md).

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
