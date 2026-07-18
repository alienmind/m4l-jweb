> **Introduction:** This document describes an audible test of the audio effect plugin, demonstrating the order of operations being applied to a chain.

# The listening test

*The one test in this repo you run with your ears, and the only way to prove that a
generated signal path is the signal path you asked for.*

Most of what this project claims can be checked without Live: the build proves the
container is well-formed, the tests prove the patcher's cords, and the dev harness
drives the UI through its real message handlers. **Composition is not one of them.**
A patcher that wires three effects in series and a patcher that sums them in parallel
both build, both load, and both make sound. The difference is audible and nothing
else.

So `hello-audio` ships with a twin.

## The pair

| Device | Chains | Everything else |
|---|---|---|
| `hello-audio` | `["lowpass", "drive", "gain"]` | the same app folder (`ui: "hello-audio"`), the same `surface.ts`, the same three dials |
| `hello-audio-rev` | `["gain", "drive", "lowpass"]` | ...identical |

The **only** difference between the two devices in the entire build is the order of
three words in `patcher/devices.mjs`. That is what makes the test evidence: there is
nothing else that could account for a difference you hear.

## Running it

1. **One audio track, one loop.** Drums, or a sustained chord - something with content
   across the spectrum. Loop it.
2. **Both devices on that track**, one after the other. They are in series now, which
   is *not* what you want to hear, so:
3. **Power one off** (the button in its title bar). You are going to toggle between
   them; exactly one is on at a time. That is the A/B.
4. **Set all three dials the same on both devices**, and set them like this:

| Dial | Value | Why exactly this |
|---|---|---|
| **Drive** | **8-10** | At Drive = 1 `overdrive~` is a **linear pass-through**, and the two devices are *supposed* to sound identical. Drive is the only nonlinear stage - it is what makes the order matter at all. |
| **Gain** | **~0.25** | Same trap. At Gain = 1 the `*~` multiplies by one and does nothing, so its position in the chain stops mattering. The gain has to actually change the level for its place to be audible. |
| **Cutoff** | **~800 Hz** | Low enough that the filter is clearly doing something. |

**A wrong Drive or Gain produces "they sound the same", which is exactly what a
broken build produces.** That is the whole reason this page exists.

## What you should hear

| | |
|---|---|
| `hello-audio` (`lowpass -> drive -> gain`) | **Loud and dirty.** It distorts at full level, and nothing filters the harshness afterwards, because the filter already happened. The level cut at the end does not clean it up - it just makes the grit quieter. |
| `hello-audio-rev` (`gain -> drive -> lowpass`) | **Quiet and much cleaner.** The gain cuts the level *first*, so by the time the signal reaches the distortion there is barely enough of it to clip - and the filter at the end smooths off what little grit survived. |

**Listen for grit, not for loudness.** `hello-audio-rev` will also be quieter, which
is expected and is not the finding. The finding is *how distorted it sounds*.

Sweeping Cutoff makes it plainer still: in `hello-audio` the filter tames the dirt,
because it is upstream of it; in `hello-audio-rev` the filter is the last thing in
the path, so it simply darkens an already-distorted signal.

## Reading the result

- **Clearly different** - the generated series is real. Stages stack, in declaration
  order.
- **Identical** - check Drive is up and Gain is well below 1 **on both devices**
  first, because that explains it far more often than a bug does. If both are set
  right and they still sound alike, that is the real failure: the stages are summing
  in parallel instead of stacking, which is precisely the bug 0.5.0 fixed and which
  shipped silently before it.
