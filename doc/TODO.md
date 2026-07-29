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

## 1. `createAudioClip()` - a rendered WAV straight into a Live clip

**The premise that blocked this was FALSE, and it was in our own drawer for months.**
"LOM has no create-audio-clip, so a bounce can only be dragged in by hand" is wrong.
Both of these are in the Live Object Model:

| Call | Lands in | Arguments |
|---|---|---|
| `ClipSlot.create_audio_clip` | Session view, that slot | `file_path` (absolute) |
| `Track.create_audio_clip` | Arrangement view | `file_path`, `position` (0 .. 1576800 beats) |

**Live 12.0.5 or newer.** Documented earlier but non-functional before that, so the
wrapper has to version-gate rather than trust the docs. The Browser finding
(MAX-FACTS) is unrelated and still stands - `browser` is control-surface-only, but
`ClipSlot` and `Track` are ordinary LOM and `[js]` already drives
`live_set view highlighted_clip_slot` in `read_selected_clip`.

**Both print an error if the track is not an audio track, is frozen, or is being
recorded into.** That is the whole design problem: an instrument device lives on a
MIDI track, so a device can never write a clip into its OWN track. The target has to
come from somewhere, and that choice is the API.

### The shape to build

A bridge call and a wrapper handler. **No chain and no patcher boxes** - this is pure
LiveAPI, like `defineWatch()`, so nothing is derived into the graph:

```ts
createAudioClip(path, { target: "selected" })            // the highlighted slot
createAudioClip(path, { target: "track", track: 3, slot: 0 })
createAudioClip(path, { target: "new" })                 // create_audio_track(-1)
```

`create_audio_clip <requestId> <path> <target...>` out, `clip_created <requestId>` or
`clip_error <requestId> <msg>` back - the same request/reply shape `saveToFile()` and
`fetchToFile()` already use, so it drops into the existing resolver machinery.

### Spikes to run first, cheapest and most likely to kill it first

1. **Does the path survive as ONE symbol?** `api.call("create_audio_clip", path)` with
   `.../Ableton Library/...` in it. This repo has been bitten twice by a path splitting
   into atoms at the space, and a User Library path ALWAYS has one. If it splits, the
   whole feature needs a different handoff and everything below is moot.
2. **Does Live COPY the file into the project, or reference it in place?** Our WAVs sit
   in the device folder under the User Library. If it references, a set that moves
   without Collect All and Save loses its audio, and the device should be writing into
   the project folder instead - which changes `defineFiles()`, not just this call.
3. **What does it do on a MIDI track** - a printed error the `[js]` can see, or a
   silent no-op? Decides whether the wrapper can validate up front (`has_audio_input`)
   or must pre-check every time.
4. **Live 12.0.4 and older**: confirm the failure is catchable, so the gate reports
   "needs Live 12.0.5" rather than a bare LOM exception.

### What to set after creation, so a bounce lands in time

`Clip` exposes `name`, `warping`, `warp_mode`, `gain`, `pitch_coarse/fine`,
`loop_start/end`, `start_marker/end_marker` as settable, and `crop()`. A device that
rendered at a known cps knows the loop length exactly, so it can warp the clip
correctly instead of leaving Live to guess - which is the difference between a bounce
that plays in time and one that needs hand-warping.

## 2. Lift the shared codegen, now that there are three declarations

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

## 3. (for next generation) A VST3 backend, so a device runs outside Live

Assessed in [FEAT-PATCHBOARD-VST3.md](FEAT-PATCHBOARD-VST3.md): the app, the bridge, the surface
and the harness port; the LiveAPI wrapper does not. **One repo, not a fork** - the
shared traps *are* the product. Its first step is a `Target` seam extracted from
`packages/build` while there is still only one target, which is worth doing on its
own merits.
