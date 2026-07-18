# An enhancement worth designing before it is built

This question comes from `m4l-strudel`, and it is about:
**how much of a device can be decided at RUNTIME rather than at build time?**

1. **Strudel's own audio** - can WebAudio in `[jweb]` reach the track?

This is a design document, not a backlog. What is *scheduled* lives in
[TODO.md](TODO.md); what is *decided* ends up in [ARCHITECTURE.md](ARCHITECTURE.md).
Everything below marked **UNVERIFIED** is a claim we have not run in Live, and this repo
has been burned twice this month by reasoning that felt airtight and was about a name
Max does not have. **Spike it before you build on it.**

---

# 1. Getting Strudel's audio into Live

## The reframe: Strudel is a pattern language, not a synthesizer

The instinct is *"hook WebAudio's output back into Max"*, and it leads directly to the
hardest possible engineering (a C++ external, shared memory, an `AudioWorklet`, two
platforms, a build toolchain, and a realtime thread you now own).

Before accepting that, notice what is actually valuable here. **The thing people love about
Strudel is the pattern engine** - the mini-notation, the combinators, the live-coding loop.
`superdough` (its audio backend) is a perfectly good WebAudio synth, but it is not the
reason anyone uses Strudel, and **it is the only part that cannot cross into Live.**

So the question is not "how do we move WebAudio's samples". It is **"where should the sound
be made?"** - and there are four honest answers, of which the C++ external is the *least*
attractive, not the most.

## Route A - Move the synthesis into Max (recommended)

Keep Strudel's scheduler in `[jweb]`; make the sound with Max objects.

A hap already crosses the bridge with everything needed: `s`, `note`, `gain`, `pan`,
`cutoff`, `begin/end`, and a timestamp. That is a **voice request**, and Max has been
answering voice requests since 1988:

- **samples** → `[buffer~]` + `[poly~]` of `[play~]`/`[groove~]` voices. This is the
  `samples` chain (SHIPPED) and the `instrument` chain ([TODO.md](TODO.md) item 1), needed for the sample
  browser anyway. Strudel's sample packs are URLs; `fetchToFile()` already downloads them.
- **synths** → `superdough`'s oscillators are not exotic: saw/square/tri/sine, an ADSR, a
  filter. A `[poly~]` voice patch covers the common cases exactly.

**Why this is the best answer, not the compromise:**
- **Sample-accurate.** Max places the note; nothing depends on the browser's timing.
- **It is real Live audio.** Track routing, fader, sends, freeze, resample, export - all of
  it, for free, because it is just MSP.
- **No external, no new platform surface, nothing to maintain per-OS.**
- It composes with everything else here: the rack (§1), `live.remote~`, the samples chain.

**The honest cost:** it is a *port*, and it will never be bit-identical to strudel.cc. Some
`superdough` features (its wavetables, its more exotic effects) would simply not exist, and
the device must **say so** rather than silently sound different - the same rule
`m4l-strudel` already applies to `.crush()`. Scope it as *"the common 80% of superdough,
sample-accurate, in Live"*, not as an emulator.

## Route B - Render offline, play from disk (the cheap escape hatch)

**This is the one that fits this architecture's existing law**: *bulk audio travels on
disk, and Max plays it.*

A Strudel pattern is **deterministic and cyclic**. So do not stream it - **render it**:

1. In `[jweb]`, render the next cycle with an **`OfflineAudioContext`** (faster than
   realtime, and it is the same `superdough` code, so it sounds *exactly* like
   strudel.cc).
2. Write the PCM to a `.wav` next to the device.
3. `[buffer~]` reads it; `[play~]` driven by `[phasor~]` locked to `current_song_time`
   plays it, **sample-accurately in sync with Live**.
4. **Double-buffer**: render cycle *N+1* while cycle *N* plays, and swap. Two `buffer~`s,
   one crossfade.

- **What it costs us:** one new primitive - **`saveToFile(path, bytes)`**, the mirror of
  `fetchToFile()`. `[jweb]` cannot write to disk, but `[js]` can, and we have *measured*
  `File.writebytes` at 1 MB in 4 KB slices with no truncation. Base64 over the bridge, in
  chunks, exactly like the UI payload extraction that already works. (One stereo 2-second
  cycle at 44.1 kHz/16-bit is ~350 KB - a fine chunk, once per cycle. This is *not* the
  realtime data plane the architecture forbids; it is a periodic file transfer.)
- **Where it breaks, and it must say so:** a pattern with randomness (`irand`, `degrade`),
  or one whose cycle depends on the previous one, cannot be pre-rendered a cycle ahead
  without changing what it *means*. Live-coding edits cost one cycle of latency to take
  effect. That is a real limit, and for a lot of music it is invisible.

**Value:** it is a **spike, not a project** - and it is the only route that gives *bit-exact
strudel.cc sound inside Live* without an external. Worth doing even if Route A wins, because
it answers "what does it actually sound like in a track" before we port a single oscillator.

## Route C - The loopback device (works today; document it, do not build it)

Install a virtual audio device (**BlackHole** on macOS, **VB-CABLE** on Windows), point the
OS default output at it, and add it as an audio *input* in Live.

- **This works right now, with zero code**, and users of browser-based tools already do it.
- It is also **bad**: it is a global OS setting (every browser sound goes with it), it has
  no per-device isolation, it adds latency, and it is a support nightmare on Windows.

**Recommendation: write it up in `m4l-strudel`'s docs as the way to hear Strudel's own
audio today, and never ship code that depends on it.** An honest workaround, clearly
labelled, beats a half-built bridge.

## Route D - The native external (last, not first)

A `jweb.audio~` external reading a shared-memory ring buffer that an `AudioWorklet` writes.

It is the *correct* answer in the abstract, and it is what a big team would build. It is
also: C++, two platforms, a signed binary, a realtime thread with no error reporting, an
`.mxo`/`.mxe64` to ship inside an `.amxd`, and a permanent maintenance burden on the one
part of the stack that can crash the user's DAW.

**It should be the answer only after A and B have failed for a reason we can name.** As of
today, nobody has demonstrated that they do.

## Recommended sequence

1. **Route B as a spike** (an afternoon, plus `saveToFile()`): render one cycle offline,
   play it from a `buffer~` in sync. It tells us what Strudel actually *sounds* like in a
   Live track, and it delivers a working, if latent, instrument.
2. **Route A as the product**: `samples` + `instrument` chains (already Priority 1), then
   `superdough`'s common voices as `[poly~]` patches. This is the device people will use.
3. **Route C in the docs**, today, for the curious.
4. **Route D only if a named requirement survives 1-3** - most likely "true zero-latency
   live-coding of aperiodic patterns", which is a real thing to want and a very expensive
   thing to have.

---

# What to spike first, and why

This is an afternoon of work and it collapses a branch of this document:

| # | Spike | Answers | Kills / unlocks |
|---|---|---|---|
| **1** | **`OfflineAudioContext` → `saveToFile()` → `buffer~`** | Can we play strudel.cc's *own* audio, in sync, from disk? | §1 route B, and it delivers `saveToFile()` either way |

**Gate every unknown behind a cheap spike that can fail in an afternoon rather than a
week.** Both features that stalled this project for weeks stalled on a name nobody
checked - and both would have been caught by ten minutes in Live.
