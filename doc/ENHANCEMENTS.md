# Two enhancements worth designing before they are built

Both questions come from `m4l-strudel`, and both are the same question underneath:
**how much of a device can be decided at RUNTIME rather than at build time?**

1. **Dynamic chains** - can a user compose an effects rack, the way they can in Live?
2. **Strudel's own audio** - can WebAudio in `[jweb]` reach the track?

This is a design document, not a backlog. What is *scheduled* lives in
[TODO.md](TODO.md); what is *decided* ends up in [ARCHITECTURE.md](ARCHITECTURE.md).
Everything below marked **UNVERIFIED** is a claim we have not run in Live, and this repo
has been burned twice this month by reasoning that felt airtight and was about a name
Max does not have. **Spike it before you build on it.**

---

# 1. Dynamic chains

## Where we are, and why

`chains: ["lowpass", "drive", "gain"]` is compiled into the patcher at **build** time.
The DSP graph is frozen when the `.amxd` is written, and the app only chooses *values*.

That is not an accident, and it buys three things worth keeping: the graph is reviewable
(it is JSON in git), the audio path does not depend on the browser being alive or keeping
up, and a parameter is a *real* Live parameter - automatable, MIDI-mappable, on Push -
because it existed when Live scanned the device.

The cost is exactly what `m4l-strudel` runs into: **`.lpf(800).room(0.5)` and
`.room(0.5).lpf(800)` cannot produce different signal paths**, because there is only one
path and it was decided months ago.

## How Live does it, and the part we cannot copy

An Audio Effect Rack looks dynamic because Live's engine is *allowed* to be:

- **Live instantiates DSP at runtime.** Dropping a Reverb into a chain builds new audio
  graph while the transport runs. Nothing in Max for Live can ask Live to do that.
- **A rack's "dry/wet" is a PARALLEL CHAIN, not a bypass.** The trick users perform -
  duplicate the chain, remove the effects from one copy, and a chain-mixer crossfade gives
  you a wet/dry knob - is *literally* a mix of two signal paths. It is not a component
  that got smarter; it is two components and a fader.
- **Macros are a FIXED pool of knobs** (8, or 16) mapped onto whatever is inside. The rack
  is dynamic; **the parameter surface is not.**

That last point is the one that matters most for us, and it is the constraint people
forget: **Live's parameter list must be stable.** An automation lane, a MIDI mapping and a
Push encoder all point at a parameter *by identity*. A device that invented a new
parameter when the user typed `.room()` would be a device whose automation silently
detaches. So whatever we build:

> **The DSP may become dynamic. The PARAMETER SURFACE must not.**
> A fixed pool of generic slots, mapped onto whatever currently occupies them - which is
> precisely what a Macro knob is.

## Three routes, in increasing order of ambition

### A. The frozen superset, with routing (works today, no unknowns)

Build every stage the rack will ever have, always, and let the *routing* be dynamic:
`[selector~]` or `[gate~]` chooses which stages the signal passes through, and a stage
that is switched out is bypassed rather than removed.

- **This is the rack in [TODO.md](TODO.md) item 2**, and the **neutrality contract** is
  what makes it honest: every stage must declare the setting at which it is bit-identical
  to a wire, because every stage is always there. `cverb~` is wet-only and has no such
  setting - so it needs a dry/wet, which, per Live above, means **a parallel dry path and
  a crossfade**. Not a bypass switch bolted on afterwards: the same shape Live uses.
- **CPU:** a stage that is switched out still runs unless you stop it. `[poly~]` can
  **mute** a subpatcher (its DSP genuinely stops), so a rack of `[poly~]`-wrapped stages
  costs what is *switched on*, not what exists. `mute~`/`pcontrol` are the cruder version.
- **Order is still frozen** (`filter → drive → delay → reverb → gain`), and the honest
  thing is for the UI to say so rather than let a user believe `.room().lpf()` reordered
  anything.

**Do this one first.** It needs no new Max capability, it is testable headlessly (the
patcher is JSON), and it is 90% of what a user actually wants: *"which effects are on, and
how much."*

### B. Dynamic patching from `[js]` (real, but spike it)

**Confirmed on disk:** `[thispatcher]` takes `script newobject`, `script newdefault`,
`script connect` and `script disconnect` (`max-ref/thispatcher.maxref.xml`), and Max's
`[js]` exposes the same through `this.patcher.newdefault()` / `.connect()` / `.remove()`.
So a device *can* build its own DSP graph at runtime. Devices in the wild do this.

What that would mean here is genuinely attractive: **the chain compiler we already have,
running in `[js]` instead of in Node.** `box()`/`line()` are already a pure description of
a graph; emitting them into a live patcher rather than into JSON is not a rewrite.

**But every one of these is unverified, and each could kill it:**

| Question | Why it could be fatal |
|---|---|
| Does scripting work inside a **frozen** `.amxd`? | The device is read-only in the user's set. If the patcher refuses to be modified, this route ends here. |
| What does rebuilding the graph **sound** like mid-playback? | Adding a `~` object re-plans the DSP chain. A click, a dropout, or a stall while the transport runs is not acceptable in a mixing session. |
| Do scripted objects **survive a save**? | Almost certainly not - they are not in the file. That is *fine*, and it is a pattern we already run: rebuild from the persisted `state` slot on `live.thisdevice`'s bang, exactly as observers are rebuilt (hard rule 4). |
| Can scripted `live.*` objects be real parameters? | **Assume not.** See the stability rule above. Parameters stay in `surface.ts`; the pool is fixed; scripting only rewires DSP. |

**The spike is an afternoon** and it answers all four: one device, one button, `[js]`
creates an `[overdrive~]`, wires it between two existing objects while audio plays, and we
listen. Do that before designing anything on top of it.

### C. Don't build a rack. POPULATE one. (the route to actually take)

The most powerful version of "dynamic chains" is the one where **we write no DSP at all.**

`.lpf(800).gain(1.2)` does not have to mean *"our filter chain, frozen last March"*. It can
mean:

> **Put Live's own Auto Filter on this chain, set its Frequency to 800 Hz. Then put a
> Utility after it, set its Gain to +1.6 dB.**

Real Ableton devices, in the user's rack, next to the control device that made them. The
device stops being an effects processor and becomes **a compiler from a Strudel expression
to a Live device chain** - a *macro*, in the original sense of the word.

```
[ strudel-fx  ".lpf(800).gain(1.2)" ] → [ Auto Filter ] → [ Utility ]
        the control device                    ...devices it populated
```

**Why this is not a lateral move but a strict improvement:**

| | Ported chains (A/B) | Populated Live devices (C) |
|---|---|---|
| DSP quality | ours, forever | **Ableton's** |
| Order | frozen at build time | **whatever the expression says** |
| Effects available | the ones we ported | **everything the user owns, incl. third-party VSTs** |
| Automation lanes, presets, undo, freeze | we reimplement each one | **already there, for free** |
| The neutrality contract, dry/wet, `selector~` routing, CPU muting | all necessary | **all unnecessary. A device that is not wanted is not there.** |
| Our maintenance burden | one DSP graph per effect, forever | **a name-to-device table** |

Notice what falls away. Every hard problem in routes A and B - the frozen order, the
wet-only reverb with no neutral setting, the always-running stages, the parameter-identity
rule - is an artifact of *us* owning the graph. **Hand the graph to Live and they are not
solved, they are gone.** That is the sign of a right answer.

And the user's own instinct is already this: they group devices, they duplicate a chain to
get a dry/wet, they map macros. We would be *driving the thing they already use* instead of
building a parallel universe beside it.

#### What it actually requires

1. **Instantiate a device.** Live's Object Model exposes a browser (`live_app` → `browser`,
   with `load_item`) - **and it is nowhere in the documentation that ships on disk.** The
   Live API guide bundled with Live does not mention it; the limitations page is about
   licensing. So this is an *online-docs claim*, and it is the **single gating fact of the
   whole design**: if a Max device cannot create a Live device, route C dies on the spot
   and routes A/B are all we have. **SPIKE THIS FIRST. Nothing else here is worth an hour
   until it answers.**
2. **Put it in the right place.** Insertion appears to follow Live's *selection*, so the
   sequence is probably: find ourselves (`this_device` → `canonical_parent`), select
   ourselves, `load_item`, and the device lands next to us. `Track.delete_device(index)`
   removes one. Both UNVERIFIED, both part of the same spike.
3. **Set its parameters - and NEVER GUESS THEIR NAMES.** This is the hard rule this repo
   learned the expensive way. `LiveAPI` can *enumerate* a device's parameters, so the
   mapping is discovered at runtime and matched, never hardcoded from memory. A parameter
   we cannot find is an effect we **refuse out loud**, exactly as `m4l-strudel` already
   refuses `.crush()`.
4. **A name-to-device table**, which is the entire "port":

   | Strudel | Live device | Parameter |
   |---|---|---|
   | `.lpf()` / `.hpf()` | Auto Filter | Frequency (+ Filter Type) |
   | `.gain()` | Utility | Gain |
   | `.room()` | Reverb | Dry/Wet |
   | `.delay()` | Delay | Feedback, Time |
   | `.crush()` | Redux | Bit Depth / Downsample |
   | `.distort()` | Saturator / Overdrive | Drive |

   **Editions differ** - not every Live edition ships every device - so the table is a
   *capability check*, not an assumption. An effect the user does not own is refused, not
   silently dropped.

#### The two things that make it a real design rather than a nice idea

**(a) Ownership. It must be a RECONCILER, not a fire-and-forget.** Re-evaluating an
expression cannot mean "append three more devices". So: mark the devices we created (a name
prefix, plus the list persisted in a `state` slot - which now survives the set, as of
0.6.0), and on every re-evaluation **diff**: keep what still matches, delete what left the
expression, insert what is new. It is a virtual DOM for a device chain, and we have written
one of those before.

The UX rule that follows: **we own only what we made.** A device the user has touched -
moved, renamed, tweaked - is *theirs*. Adopt it or leave it alone; never silently overwrite
it. A compiler that rewrites a user's rack behind their back is a hostile tool, and the
fastest way to lose their trust is to eat a setting they spent ten minutes on.

**(b) What this gives up - and it is the real cost.** A Live device chain is **static**.
Strudel effects are **per-event**: `.lpf("<400 800>")` means *this note is filtered at 400,
the next at 800*. A populated Auto Filter has exactly one Frequency at a time, so
per-hap variation is **not** expressible as a device chain.

That is not fatal, and the escape is already in this document: **`live.remote~` drives a
Live parameter at SIGNAL rate, without writing automation** (it ships inside Live -
confirmed). So the split is clean and, I think, correct:

> **The expression's SHAPE becomes a device chain** (which effects, in what order).
> **The expression's per-event VALUES become `live.remote~` modulation** of the parameters
> of the devices we just created.

Static values are simply the degenerate case of that - a constant signal. Which means route
C and the modulation work below are not two features; **they are one feature**, and each is
half of the other.

#### Honest risks

- **The gating call may not exist.** See (1). Everything above is conditional on it.
- **Populating a chain while the transport runs** will not be sample-accurate and may click.
  This is a *compile* action, not a per-cycle one: the user types, then asks for it. Do not
  even consider driving it from the pattern clock.
- **Undo.** Live's undo history is the user's. Creating five devices as five undo steps is
  obnoxious; whether it can be a single step is unknown, and worth asking early.
- **It only works in Live.** The dev harness cannot mock a device chain honestly, so this is
  the first feature in the project whose core cannot be verified in the browser. The
  conformance-check pattern (`wrapper/device.ts`) is how it gets tested at all.

#### Verdict

**Take route C, and treat A/B as the fallback the spike may force on us.** Keep a *small*
internal DSP vocabulary for the two cases route C genuinely cannot serve - an effect Live
has no device for, and anything that must change *per hap* faster than a device parameter
can be set - and let Ableton do the rest. It is less code, better sound, and it stops us
competing with Ableton at the one thing Ableton is unambiguously better at than we will
ever be.

This is the one to think hardest about, because it inverts the whole problem - and it is
the only route where "the user can add anything" is true without us implementing anything.

## Modulation - and a Live object we had missed

`.lpf(sine.range(200, 2000))` is a **signal**, not a parameter: sent as 20 Hz of parameter
writes it steps audibly and fights the automation lane.

- **Inside our own DSP:** trivial. `[cycle~]`/`[phasor~]` into the target object's inlet -
  the signal domain is what it is for. The open design question is only the *seam*: how a
  chain declares "this inlet is modulatable" so an LFO can be patched onto it without every
  chain hand-rolling a summing junction. (TODO item 4.)
- **Into LIVE's parameters:** **`live.remote~` ships inside Live**
  (`resources/externals/m4l/`), and its own reference says it *"allows you to remotely
  control parameters in Ableton Live and Max for Live in realtime."* **Signal rate, and it
  does not write automation.** That is exactly the object route C needs to modulate the
  Reverb it just created - and it means pattern-driven modulation of *real Ableton devices*
  is on the table, which is a far more interesting feature than modulating our own filter.

---

# 2. Getting Strudel's audio into Live

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

Each of these is an afternoon and each one collapses a branch of this document:

| # | Spike | Answers | Kills / unlocks |
|---|---|---|---|
| **1** | **`live_app.browser` → `load_item`**, then `delete_device` | Can a device create and remove a real Ableton device, next to itself? | **§1 route C - do this one FIRST.** It is the single gating fact of the most valuable idea in this document, and it is undocumented on disk. If it fails, the rack (TODO item 3) is back on. |
| **2** | **`live.remote~` driven by a `[phasor~]`** | Can a pattern modulate a *Live* parameter at signal rate, without touching automation? | modulation - and the other half of route C, which needs it for per-hap values |
| **3** | **`OfflineAudioContext` → `saveToFile()` → `buffer~`** | Can we play strudel.cc's *own* audio, in sync, from disk? | §2 route B, and it delivers `saveToFile()` either way |
| **4** | **`[js]` scripts a `~` object into a running patcher** | Is dynamic patching possible in a *frozen* device, and what does it sound like? | §1 route B - only worth running if spike 1 fails |

Spikes 1 and 2 together are the whole of route C, and between them they are perhaps two
days. **They should be run before another line of DSP is written in this repo**, because
if they pass, a good deal of the DSP planned in [TODO.md](TODO.md) should never be written
at all.

**Gate every unknown behind a cheap spike that can fail in an afternoon rather than a
week.** Both features that stalled this project for weeks stalled on a name nobody
checked - and both would have been caught by ten minutes in Live.
