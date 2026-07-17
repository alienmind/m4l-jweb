# M4L-JWEB: what is left to do

The backlog for the library itself - things any device built on M4L-JWEB could use,
not one device's business logic. **Only open work lives here**, ordered from smallest
effort to biggest. What has shipped is recorded where it belongs: **what the library
does** in [README.md](../README.md), **how and why (including everything measured in
Live)** in [ARCHITECTURE.md](ARCHITECTURE.md).

- Designs still being argued - how Strudel's own audio could reach a track - are in
  [ENHANCEMENTS.md](ENHANCEMENTS.md).
- The cross-repo plan is [m4l-strudel's PLAN.md](../../m4l-strudel/doc/PLAN.md).
- The two rules everything follows: **`[js]` is a control plane, not a data plane**
  (bulk data travels via disk, never through Max messages), and **gate every unknown
  behind a cheap spike that can fail in an afternoon rather than a week.**

---

## 1. Publish 0.9.x to npm

`m4l-strudel`'s `package.json` points `@m4l-jweb/*` at `^0.9.0`, and until that
version is on npm a fresh clone or CI cannot install - the local
`link:../m4l-jweb/packages/*` is what makes the two repos build together today.
[RELEASING.md](RELEASING.md) is the recipe. Publish after the current round's Live
checks (m4l-strudel's [TESTING.md](../../m4l-strudel/doc/TESTING.md)) come back clean.

## 2. Retake README screenshots

The example devices changed shape (native dials, the two-screen panel, banks). Batch
with any future layout change rather than chasing every one.

## 3. Extract the contract pattern - `defineWatch()`, `defineSamples()`

`defineSurface()` is one instance of a rule: *you declare what the Max side has, the
build derives everything else* - objects, wiring, protocol selectors, a typed React
hook, a harness mock. There are now two real instances to generalise from (the
Surface, and the parameter registry/banks emission), which was the precondition.

- **3.1 Lift the shared codegen.** Declaration -> boxes -> wiring -> selectors is one
  pipeline. Leave the user-facing APIs bespoke.
- **3.2 `defineWatch()`** - the real prize. It kills hard rule 4 (a LiveAPI object
  created during `loadbang` is dead, forever) BY CONSTRUCTION: declare what to
  observe, the codegen emits the observers into `bang()`. `liveapi.ts` becomes
  generated.
- **3.3 `defineDevice()`** - fold in the manifest. End state: you do not write `[js]`.

Do NOT build the generic compiler first and express the Surface in terms of it. An
abstraction from one example is a guess.

## 4. A VST3 backend, so a device runs outside Live

Assessed in [PATCHBOARD-VST3.md](PATCHBOARD-VST3.md): the app, the bridge, the surface
and the harness port; the LiveAPI wrapper does not. **One repo, not a fork** - the
shared traps *are* the product. Its first step is a `Target` seam extracted from
`packages/build` while there is still only one target, which is worth doing on its
own merits.

## 5. Phase 8: the native audio bridge (JS -> Max MSP) - `FEAT-STRUDEL-002`

Stream raw PCM from the JS runtime (WebAudio in `[jweb]`) into Max's `~` graph, so a
Strudel **instrument** can act like a plugin instead of bypassing the track. `[jweb]`
has no `~` outlets; bridging realtime audio over the JSON message bridge is impossible
(latency, jitter, CPU). It needs a native C++ external or a local socket bridge.

**Read [ENHANCEMENTS.md](ENHANCEMENTS.md) first**: it argues the native external is
the LEAST promising of four routes, and that **Route B (offline render +
`saveToFile()` + `[buffer~]`) is the spike to run first** - also the concrete first
step toward the Rack's instrument slot. See m4l-strudel's
[SPIKE-OFFLINE.md](../../m4l-strudel/doc/SPIKE-OFFLINE.md).
