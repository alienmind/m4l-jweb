# M4L-JWEB: what is left to do

The backlog for the library itself - things any device built on M4L-JWEB could use,
not one device's business logic. **Only open work lives here**, ordered from smallest
effort to biggest. What has shipped is recorded where it belongs: **what the library
does** in [README.md](../README.md), **how and why (including everything measured in
Live)** in [ARCHITECTURE.md](ARCHITECTURE.md).

- How a page's audio could reach a track used to be the big open design question here.
  `[jweb~]` settled it in 0.9.9 - see item 3 below.
- The two rules everything follows: **`[js]` is a control plane, not a data plane**
  (bulk data travels via disk, never through Max messages), and **gate every unknown
  behind a cheap spike that can fail in an afternoon rather than a week.**

---

## 1. Extract the contract pattern - `defineSamples()`, then generalise

`defineSurface()` is one instance of a rule: *you declare what the Max side has, the
build derives everything else* - objects, wiring, protocol selectors, a typed React
hook, a harness mock. `defineWatch()` is now a second (SHIPPED - see README and
CHANGELOG). Two more instances, then the generalisation:

- **`defineSamples()`** - the `buffer~` slots as a declaration, the third instance.
- **Lift the shared codegen.** Declaration -> boxes -> wiring -> selectors is one
  pipeline. Leave the user-facing APIs bespoke.
- **`defineDevice()`** - fold in the manifest. End state: you do not write `[js]`.

Do NOT build the generic compiler first and express the Surface in terms of it. An
abstraction from one example is a guess - which is why the codegen lift waits for
`defineSamples()` rather than being extracted from Surface + Watch alone.

## 2. Hybrid controls: a native-knob pool the Surface declares

A device has more controls than it can afford native `live.dial`s: a dial is stamped
into the frozen `.amxd` at build time, so their count and identity are fixed, while a
device's real controls are dynamic (Strudel's superdough device discovers its
`slider()`s per pattern). Today superdough hand-rolls the bridge: eight generic dials
`S1..S8`, an app that maps discovered controls onto them by order, renames them at
runtime (`knob_label`), and denormalises each dial's 0..1 travel into the control's own
range. That logic is device business that belongs one level down, in the library.

Push it into the Surface as a first-class contract, usable by ANY device:

- **Declare a POOL of native controls**, not individual dials - a fixed count of
  build-time `live.dial`s the device reserves (the frozen, macro-mappable, Push-visible
  slots), same way `defineSurface` already declares params.
- **Let a control declare whether it wants a native slot.** A device (or its React UI)
  declares controls dynamically; each says "map me to the native pool" or "web-only". A
  control that wants native BORROWS a slot from the pool; when it goes away the slot
  returns. The Surface owns the borrow/return bookkeeping and the by-order mapping.
- **Fold in the runtime rename and the range denormalise** (the pool slot carries the
  borrower's semantic name and maps its 0..1 travel to the borrower's min..max) so the
  device stops reimplementing `knob_label` + normalise/denormalise by hand.
- **Typed React hook + harness mock**, same as the rest of the contract: a `useControl`
  that is one value whether it landed in the native pool or stayed web-only.

Strudel's superdough device adopts it immediately - it is exactly the hand-rolled
`S1..S8` logic, generalised. This is the same "declare what Max has, derive the rest"
rule as item 1, applied to the native/dynamic control split. Gate the unknown Max bits
(runtime rename, runtime range change on a frozen dial) behind the existing spikes
before folding them into the contract.

## 3. The native audio bridge (JS -> Max MSP) - SOLVED, 0.9.9

**Closed. The premise was false.** This item read: "`[jweb]` has no `~` outlets;
bridging realtime audio over the JSON message bridge is impossible (latency, jitter,
CPU). It needs a native C++ external or a local socket bridge." The first clause is
true only of `[jweb]`. **`[jweb~]` (Max 8/9) has two signal outlets**, so the page's
Web Audio output goes straight into Max's `~` graph - no external, no socket, no PCM
over the message bridge.

What shipped instead of a C++ external:
- `base.json` emits `[jweb~]` (outlets: signal L, signal R, messages on **2**), and
  `claimAppMessages()` reads the message stream from outlet 2.
- The `webaudio` chain sums those signal outlets into the device's path with `[+~]`,
  so an audio effect stays a pass-through and an instrument originates sound.
- The `renderplay`, `samples` and `instrument` chains - all workarounds for the missing
  outlets - were deleted, along with their bridge APIs.

The old four-route analysis (a C++ external, a socket bridge, offline render, PCM over
the message bridge) is superseded and its design doc deleted: none of the four was
needed, because none of them considered `[jweb~]` - we did not know it existed. Route B
(offline render + `saveToFile` + `[buffer~]`) was built, shipped in 0.9.x, and is now
retired - see [m4l-strudel's drawer](../../m4l-strudel/doc/DRAWER_OF_FAILED_IDEAS.md)
for what it cost and what it taught.

## 4. (for next generation) A VST3 backend, so a device runs outside Live

Assessed in [FEAT-PATCHBOARD-VST3.md](FEAT-PATCHBOARD-VST3.md): the app, the bridge, the surface
and the harness port; the LiveAPI wrapper does not. **One repo, not a fork** - the
shared traps *are* the product. Its first step is a `Target` seam extracted from
`packages/build` while there is still only one target, which is worth doing on its
own merits.
