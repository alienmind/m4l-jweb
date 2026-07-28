# M4L-JWEB: what is left to do

The backlog for the library itself - things any device built on M4L-JWEB could use,
not one device's business logic. **Only open work lives here**, ordered from smallest
effort to biggest. What has shipped is recorded where it belongs: **what the library
does** in [README.md](../README.md), **how and why (including everything measured in
Live)** in [ARCHITECTURE.md](ARCHITECTURE.md).

The two rules everything here follows: **`[js]` is a control plane, not a data plane**
(bulk data travels via disk, never through Max messages), and **gate every unknown
behind a cheap spike that can fail in an afternoon rather than a week.**

A third rule, learned the expensive way in 0.9.9: **re-verify a premise before designing
around it.** The biggest item this file ever carried - "a page cannot put audio on a
track, so we need a C++ external" - was false about the object we were actually using,
and four routes were analysed and one fully built before anyone checked. That
postmortem now lives in
[ARCHITECTURE.md](ARCHITECTURE.md#the-native-audio-bridge-four-routes-and-the-object-that-made-all-four-moot),
because it is settled history rather than work.

---

## 1. Lift the shared codegen, now that there are three declarations

`defineFiles()` shipped in 1.3.0, so the precondition is met: declaration -> boxes ->
wiring -> selectors is one pipeline across Surface, Watch and Files, and three
instances is enough to extract from where two was not. Leave the user-facing APIs
bespoke. End state is `defineDevice()` - folding in the manifest, so you never write
`[js]`.

Do NOT build the generic compiler first and express the Surface in terms of it. An
abstraction from one example is a guess.

**What the three have in common, as the starting point:** each loads a TypeScript
declaration through esbuild (`loadSurface` / `loadWatch` / `loadFiles` are the same
function three times), and each emits some mix of a data banner and patcher boxes.
The loader is the obvious extraction; the emitters are the part worth being careful
with, because `defineFiles()` is the only one that derives a CHAIN and the shape of
that is not yet proven twice.

## 2. (for next generation) A VST3 backend, so a device runs outside Live

Assessed in [FEAT-PATCHBOARD-VST3.md](FEAT-PATCHBOARD-VST3.md): the app, the bridge, the surface
and the harness port; the LiveAPI wrapper does not. **One repo, not a fork** - the
shared traps *are* the product. Its first step is a `Target` seam extracted from
`packages/build` while there is still only one target, which is worth doing on its
own merits.
