# Stage 1: the spikes

Three questions about Max's real behaviour gate the rest of [TODO.md](TODO.md).
Each is a few hours to answer and each can be answered *independently*, before
anything is built on top of it. That is the whole point: a wrong guess about
`set` semantics, discovered after the Surface codegen is written, costs a week.
Discovered here, it costs an afternoon and a fallback.

**None of these have been run yet.** Everything below is the apparatus and the
procedure. The results table is empty on purpose - fill it in, do not predict it.

## How to run them

```bash
pnpm build
pnpm install:device
```

Then in Live: **User Library > Max For Live > m4l-jweb**, drag **`spike`** onto
a MIDI track, and open the Max console (in the device's title bar: the **Edit**
button opens Max; `Window > Max Console`).

The spike device is not a device. It is an instrument for answering these three
questions and it should be **deleted once they are answered** - along with
`patcher/chains.mjs`, `wrapper/device.ts`, the `spike` entry in
`patcher/devices.mjs`, and `src/app/spike/`.

You can drive the UI in the browser too (`pnpm dev:spike`) - but the *answers*
only exist in Live. The browser tells you the buttons work; it cannot tell you
what Max does.

---

## Spike 1.1 - does `set` on a `live.*` object suppress its output?

**Why it matters.** The Surface wires parameters in BOTH directions, and that is
new. Parameter -> app already exists and is easy. App -> parameter is the
problem: feeding a value into a `live.dial`'s inlet normally **sets it and makes
it output**, which sends it straight back to the app, which may set it again. A
feedback loop that, with floats, can oscillate rather than settle.

`set <value>` is documented to update the value *without* producing output. The
entire no-feedback design rests on that being true in the **M4L build of Max**,
not just in the docs.

**The apparatus** (`patcher/chains.mjs`) wires both paths into the same dial,
side by side, so the difference is directly visible:

```
set_param <v> -> [prepend set] -> [live.dial]     should NOT echo
raw_param <v> ->                  [live.dial]     SHOULD echo (the control)

                 [live.dial] -> [prepend dial_out] -> [jweb]
```

**Procedure.** Press `raw_param` a few times - the echo counter must climb, or
the apparatus itself is broken and nothing else it says can be trusted. Then
press `set_param`. Watch the counter.

**What each outcome means:**

- **Counter does not move on `set_param`** -> the design holds. Build Stage 2.1
  as specified.
- **Counter moves on `set_param`** -> `set` does not suppress output here. Fall
  back to a `[gate]` around the app-bound path that the wrapper closes for one
  scheduler tick after a `set_param`. Uglier, but workable.

**Also check, and it is easy to forget:** that the value still reaches **Live's
automation lane**. `set` is supposed to silence the *outlet*, not the parameter
change. Arm automation on the track, move the dial via `set_param`, and confirm
Live records it. A `set` that also hides the change from automation would be
worse than the feedback loop.

## Spike 1.2 - can `[js]` drive a `[buffer~]` to read a file off disk?

**Run this one first.** It is the cheapest experiment in the whole plan: no
network, no download chain, no new protocol. And it is the one that de-risks the
most, because it is the load-bearing claim under *"disk is the audio transport"*
- the rule that makes an instrument device possible at all. If `[js]` can point
a `buffer~` at a real file and see the frames arrive, then audio never has to
cross the Max message bridge as data, and Stage 3.2 is mostly wiring.

**The apparatus.** The spike chain puts a named `[buffer~ m4ljweb_spike]` in the
patcher; `wrapper/device.ts` addresses it as `new Buffer("m4ljweb_spike")` and
sends it `replace <path>`. The path it uses is the wrapper's **own extracted UI
payload** (`spike.html`) - a real file that certainly exists on disk next to the
`.amxd`, which sidesteps "did the file exist" as a confounder entirely.

It is not audio, so it will not sound like anything. **`frames > 0` is the
finding**, not the sound.

**Note the API surface is itself part of what is being tested.** `Buffer.send`,
`framecount`, `peek` are declared in `packages/wrapper/src/max.d.ts` from the
docs, and marked UNVERIFIED there. If one of them is not what Max's `[js]`
actually exposes, the exception in the Max console *is the result* - record it,
do not paper over it.

**Procedure.** Press `buffer_load`. The wrapper sends `replace`, waits 500 ms on
a `Task` (the read is asynchronous - `framecount()` immediately after `replace`
still reads the old size), then posts and returns `buffer_result <frames>
<channels> <midsample>`.

**What each outcome means:**

- **frames > 0** -> the seam works. Stage 3.2 proceeds: the file goes to disk,
  `buffer~` reads it, MSP plays it, `[js]` only ever sends control messages.
- **frames = 0, no error** -> `replace` was accepted but read nothing. Try a real
  `.wav`, and try `read` instead of `replace`.
- **an exception** -> the `Buffer` binding is not what the docs say. Record what
  it actually is. This is the finding, and it changes `max.d.ts`.

## Spike 1.3 - which HTTP object downloads to disk inside Live?

**Why it matters.** Stage 3.1 replaces `[node.script]` - the least reliable
piece of infrastructure in the project - with a Max-native download. Picking the
wrong object means discovering it in Live, late, after a device's download path
has been rewritten around it.

**The candidates.** `[maxurl]` is the modern HTTP object and does not drag in the
Jitter runtime. `[jit.uldl]` is the long-standing alternative built for exactly
this: asynchronous HTTP download to a local file, with a completion callback.

**The apparatus is deliberately not a guess.** Nobody here has confirmed
`maxurl`'s message vocabulary inside Live, so the wrapper does not encode one:
`url_send` forwards **raw words** from a text field straight to `[maxurl]`, and
`url_reply` sends whatever comes back to the UI and the console, verbatim. It is
an instrument for exploring, not an implementation of a guess.

**Procedure.** Type a message into the field and press send. Start from the Max
reference page for `maxurl` (not from memory - see `CLAUDE.md`: *never trust an
object's outlet order from memory*), and try the download-to-file form. Watch
what the outlets say. Then check whether the file actually appeared on disk,
which is the only thing that really counts.

**What to record:** the exact message that works, which outlet the completion
arrives on, what an HTTP error looks like versus a filesystem error, and whether
the write is genuinely streamed (try something large enough to notice - and
remember `File.writebytes` truncating past ~16 KB is *this project's* scar
tissue, not necessarily `maxurl`'s).

**If `[maxurl]` cannot do it**, swap the box for `[jit.uldl]` in
`patcher/chains.mjs` (one line) and repeat. If neither can, that is a genuine
finding and `[node.script]` may have to stay - in which case say so in TODO.md
rather than letting Stage 3.1 sit there looking achievable.

---

## Results

Fill this in as they are run. An unrun spike is not a "probably fine".

| Spike | Question | Status | Finding |
|---|---|---|---|
| 1.2 | `[js]` -> `[buffer~]` reads a file from disk | **not run** | - |
| 1.1 | `set` on `live.*` suppresses outlet output | **field evidence: YES** | See below. Still worth running the spike properly - this was observed, not measured. |
| 1.1a | ...and the change still reaches automation | **not run** | - |
| 1.3 | `[maxurl]` / `[jit.uldl]` downloads to disk in Live | **not run** | - |

### Field evidence for 1.1, from hello-audio

The `lowpass` chain shipped with its filter fed from the `live.dial`'s **outlet**,
and the app writing that dial with `prepend set`. In Live the slider appeared
completely dead: the dial moved, and the filter never heard about it.

That is `set` doing exactly what the documentation says - suppressing the outlet -
and it is a sharper lesson than the spike was designed to teach:

> **`set` silences the object for EVERYONE, not just for the app.** The
> feedback-suppression you wanted at the app's inlet also cuts every cord the
> object drives *inside the patcher*.

So a parameter's consumers must not be chained *behind* the parameter object.
`writableParams()` now fans the value out - to the dial (so automation, MIDI
mapping and Push stay right) and, in parallel, straight to whatever the parameter
actually controls. The dial's own outlet still feeds the same destination, for
the knob-turn / automation / Push path.

**This matters for the Surface (Stage 2), which was designed around exactly this
`set` trick.** Its wiring must fan out the same way, or every generated parameter
will have the bug hello-audio just had. Confirm it with the real spike before
building on it.

When a row is answered, update it here, update the gate note on the matching
stage in [TODO.md](TODO.md), and - if the answer changes the design - update
[SURFACE.md](SURFACE.md) or `max.d.ts` in the same commit. A spike whose result
lives only in someone's memory was not worth running.
