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

**Also check, and it is easy to forget: how far does the silence reach?** `set` is
supposed to silence the *outlet*, not the parameter change - and hello-audio
already showed the silence reaching further than expected (it cuts every cord the
object drives inside the patcher). So the counter not moving is necessary but not
sufficient. The remaining question is whether `set` writes the **parameter** at
all, or only the dial's on-screen appearance. Two ways to ask it, and they are
the same question:

- **1.1a, the automation lane.** Arm automation on the track, write the dial via
  `set_param`, and confirm Live records it.
- **1.1b, Push.** The dial is `parameter_enable`d, so Push banks it automatically
  with no extra work - which is itself the confirmation that a generated
  parameter gets Push, MIDI mapping and automation for free (**confirmed on
  hardware: the knob appears, named from `parameter_shortname`, travelling over
  `parameter_range`**). Now press `set_param` in the device UI and watch Push's
  value readout. It is the ten-second version of 1.1a.

If either says no - the lane stays empty, or Push's readout does not follow -
then `set` is not setting the parameter and the Surface's whole app -> parameter
path is writing to a picture of a knob. That would be worse than the feedback
loop, and Stage 2 needs rethinking before a line of codegen is written.

## Spike 1.2 - can `[js]` drive a `[buffer~]` to read a file off disk?

**Run this one first.** It is the cheapest experiment in the whole plan: no
network, no download chain, no new protocol. And it is the one that de-risks the
most, because it is the load-bearing claim under *"disk is the audio transport"*
- the rule that makes an instrument device possible at all. If `[js]` can point
a `buffer~` at a real file and see the frames arrive, then audio never has to
cross the Max message bridge as data, and Stage 3.2 is mostly wiring.

**The apparatus.** The spike chain puts a named `[buffer~ m4ljweb_spike]` in the
patcher; `wrapper/device.ts` addresses it as `new Buffer("m4ljweb_spike")` and
sends it `replace <path>`. The buffer is declared with **no size argument**, so
it starts empty and **`frames > 0` is the finding** - see the first run below for
why that matters more than it sounds.

The default path is `jongly.aif`, which ships with Max and lives on its search
path, so a bare filename with no directory resolves. Any `.wav` on disk works
too; type it in the field.

**The first run of this spike was a false pass, and the fix is instructive.** The
buffer was declared `buffer~ m4ljweb_spike 1000 1` and `replace` was pointed at
the wrapper's own extracted `spike.html` - chosen because that file certainly
exists, which seemed to remove "did the file exist" as a confounder. It reported
`frames=48000 channels=1 midsample=0`, which is 1000 ms at 48 kHz: the buffer's
**declared, empty size**, reported whether or not the read ever happened.
`buffer~` decodes *audio*; an HTML file leaves it untouched. Hence: no declared
size, a real audio file, a baseline `framecount()` posted before the `replace`,
and a control button that loads the `.html` on purpose and must report 0.

**Note the API surface is itself part of what is being tested.** `Buffer.send`,
`framecount`, `peek` are declared in `packages/wrapper/src/max.d.ts` from the
docs, and marked UNVERIFIED there. If one of them is not what Max's `[js]`
actually exposes, the exception in the Max console *is the result* - record it,
do not paper over it.

**Procedure.** Press `buffer_load`. The wrapper posts the baseline frame count,
sends `replace`, waits 500 ms on a `Task` (the read is asynchronous -
`framecount()` immediately after `replace` still reads the old size), then posts
and returns `buffer_result <frames> <channels> <midsample>`.

**What each outcome means:**

- **frames > 0 and midsample != 0** -> the seam works. Stage 3.2 proceeds: the
  file goes to disk, `buffer~` reads it, MSP plays it, `[js]` only ever sends
  control messages. (A midsample of exactly 0 is possible in real audio, but with
  the buffer starting empty, `frames > 0` alone already carries the finding.)
- **frames = 0, no error** -> `replace` was accepted but read nothing. Try a
  `.wav` with an absolute path, and try `read` instead of `replace`.
- **an exception** -> the `Buffer` binding is not what the docs say. Record what
  it actually is. This is the finding, and it changes `max.d.ts`.

**Reading the control button correctly.** It fires the same `replace` at the
extracted `.html`, and what it proves is that a non-audio file **leaves the buffer
exactly as it was** - it does not clear it, and it does not error. So the control
only says something if you know the buffer's state going in: from empty it reads
0, and *after a successful load it still reads the loaded file's frame count*.
That is not a failure of the control; it is the whole reason the first run was a
false pass. Read the `before replace` line, always. It is the only number that
tells you what the reading you are about to see is being compared against.

## Spike 1.3 - which HTTP object downloads to disk inside Live?

**Why it matters.** Stage 3.1 replaces `[node.script]` - the least reliable
piece of infrastructure in the project - with a Max-native download. Picking the
wrong object means discovering it in Live, late, after a device's download path
has been rewritten around it.

**The candidates.** `[maxurl]` is the modern HTTP object and does not drag in the
Jitter runtime. `[jit.uldl]` is the long-standing alternative built for exactly
this: asynchronous HTTP download to a local file, with a completion callback.

**The raw-words apparatus was not enough, and that is already a finding.** The
first cut of this spike forwarded raw words from a text field to `[maxurl]`, on
the principle that guessing a vocabulary in code just bakes the guess in. Reading
the reference says a flat message cannot express the thing we want: `get <url>`
hands the **body** back through an outlet, and downloading to a **file** is a
`dictionary <name>` message carrying a dict with a `filename_out` key. So
something has to build a dict, and `[js]` is the only thing in the patcher that
can. The raw-words field is still there (the `1.3 raw` row) for exploring, but
the download itself is now `url_download` in `wrapper/device.ts`.

The dict keys, from the reference: `url`, `http_method`, `filename_out`,
`overwrite_output_file`, `response_dict`, `headers`, `timeout`.

**`Dict` is therefore part of what this spike tests**, exactly as `Buffer` was for
1.2. It is newly declared in `max.d.ts` and marked UNVERIFIED. If `new Dict()`,
`set` or `stringify` is not what Max's `[js]` exposes, the exception in the
console **is the result**.

**The apparatus reads all three `maxurl` outlets**, each tagged with its own index
(`url_reply 2 ...` means outlet 2 fired), because which outlet carries completion
is one of the questions and `CLAUDE.md` is explicit that outlet order is never to
be trusted from memory. If the reply names a dictionary, the wrapper dumps its
contents - that is where the status code lives, and it is what tells an HTTP error
apart from a filesystem one.

**Procedure.** Three buttons, in order:

1. **download** - builds the dict, sends `dictionary` to `[maxurl]`, and posts the
   request JSON and the destination (`spike_download.wav`, next to the `.amxd` -
   a folder known to be writable, because the wrapper writes the UI payload there
   on every load). The default URL is a real, live `.wav`, verified before it was
   put there: a dead link and a broken download look identical from inside the
   device, and only one of them is under test.
2. **on disk?** - `maxurl` saying "done" is not the finding. **The file is the
   finding.** This opens the path from `[js]` and reports the byte count, which is
   also the truncation check: the file is ~1.2 MB, and this project already knows
   `File.writebytes` gives up silently past ~16 KB.
3. **-> buffer~** - loads the downloaded file into the spike's `buffer~`. Spike 1.2
   already proved that seam, so a non-zero frame count here is the **entire**
   path - network, disk, decode, audio - end to end, with no `[node.script]`
   anywhere in it. That is the whole point of Stage 3.1.

### What 1.3 found - `[maxurl]` works, and here is its shape

Measured in Live. 1,210,892 bytes of `.wav` over HTTPS, straight to a file, no
`[node.script]` anywhere in it.

**The request.** A `dictionary <name>` message to `[maxurl]`, with the dict built
in `[js]`:

```json
{ "url": "https://...", "http_method": "get",
  "filename_out": "C:/.../spike_download.wav",
  "overwrite_output_file": 1, "response_dict": "m4ljweb_spike_res", "timeout": 30 }
```

**The outlets** - read, not assumed, and worth having:

| Outlet | Carries | Shape |
|---|---|---|
| **1** | **progress**, continuously, while the transfer runs | `<tag> <total> <sofar> 0 0` |
| **0** | **completion**, once | `dictionary <responseDictName>` |

The progress tag is the **response dict name** for a `dictionary` request, and the
literal word `progress` for a raw `get`. Either way outlet 1 gives a real download
a progress bar for free - `sofar/total` - which the app can have without any extra
plumbing.

**The completion dict** carries everything worth knowing:

```
status 200, header "HTTP/1.1 200 OK\r\n...", content_type "audio/x-wav",
size_download 1210892, content_length_download 1210892, total_time 5.81,
url, filename_out, body ""   <- body is EMPTY when filename_out is set
```

**It streams, and it does not truncate.** The progress ticks climb 8 KB, 16 KB,
24 KB ... 1,210,892 - and the file lands whole. `File.writebytes` giving up
silently past ~16 KB is *this project's* scar, not `maxurl`'s: nothing here has to
be sliced.

**And the file is really there.** `url_check` opens the path from `[js]` and reads
**1,210,892 bytes** - the same number, from something other than the object that
did the downloading. `maxurl` reporting its own success is not evidence; the file
on disk is. They agree.

### And then the two spikes meet: the whole path, end to end

Pressing `-> buffer~` on the freshly downloaded file, from an empty buffer:

```
buffer before replace frames=0
buffer frames=302712 channels=2 midsample=-0.033477783203125
```

**Network -> disk -> decode -> audio, in one device, in Live, with no
`[node.script]` in it.** That is the entire premise of Stage 3 demonstrated in a
single click, and it is why 1.2 and 1.3 were worth running before anything was
built on them.

**Note `channels=2`.** The `buffer~` is declared with no size *and no channel
count*, and `replace` adopted the file's stereo layout on its own. Convenient - but
it means a device's channel count is decided at runtime by whatever file it loads.
The `samples` chain in Stage 3.2 must not assume mono, and anything reading the
buffer should ask `channelcount()` rather than remember an answer.

**`Dict` is confirmed** along with it - `new Dict()`, `set`, `clear`, `stringify`
are all real. `max.d.ts` updated; `get`, `parse` and `freepeer` remain unexercised.

### The 404, and it is nastier than it looks - READ THIS BEFORE BUILDING 3.1

The guess was "a 404 arrives as `status 404`, with no file". Half right, and the
wrong half is dangerous. Pointing the same request at a dead URL on a live host:

```
status 404, content_type "text/html; charset=iso-8859-1", size_download 355
url_check -> 355 bytes at .../spike_download.wav      <- THE FILE IS THERE
buffer frames=0 channels=0 midsample=0                <- and it is not audio
```

**`[maxurl]` wrote the 404 error page to `filename_out`.** It did not refuse, it
did not warn - and with `overwrite_output_file: 1` it **destroyed the good 1.2 MB
`.wav` that was already at that path**. A failed download does not leave the old
file alone; it replaces it with an Apache error page wearing a `.wav` extension.

Chain that with the other two findings and you get a device that fails silently,
late, far from the cause:

1. `fetchToFile` asks "did a file appear?" - yes, 355 bytes. Reports success.
2. The sample is "cached". Nothing re-downloads it.
3. `buffer~` `replace`s it: **silent no-op**, `frames=0`, no error (spike 1.2).
4. The device plays nothing, and there is not one line in the console about it.

**So Stage 3.1's `fetchToFile` MUST:**

- **check `status` in the completion dict** - the presence of a file proves nothing,
- **download to a TEMP path and move it into place only on 2xx**, so a failure
  cannot destroy a good cached file,
- and treat a non-2xx as an error the app can *see*, with the status in it.

### The filesystem error: `status 200`, and no file

The same good URL, aimed at an unwritable `filename_out` (`C:/Windows/System32/`):

```
status 200                    <- the SERVER was perfectly happy
size_download 8000            <- gave up here...
content_length_download 1210892   <- ...of this
error "Failed writing received data to disk/application"
url_check -> NO FILE
```

**HTTP status cannot tell you the file was written.** A disk failure comes back as
a 200. The discriminator is an **`error` key that is simply absent on success** -
`[maxurl]` adds it exactly when the transfer fails locally.

### The three outcomes, and how to tell them apart

This is the table Stage 3.1 is built against:

| Outcome | `status` | `error` key | The file |
|---|---|---|---|
| **Success** | 2xx | absent | complete |
| **HTTP failure** (404) | 404 | absent | **the error page, written over whatever was there** |
| **Filesystem failure** | **200** | **present** | none |

**Both checks are needed. Neither alone is sufficient.** `status` catches the
server saying no; `error` catches the disk saying no; and a 404 is the one that
*also* destroys your cached file, so the temp-path-then-move rule stands.

Do **not** be tempted by `size_download` vs `content_length_download` as a third
check: it does flag the truncation here (8000 of 1,210,892), but a chunked response
reports `content_length_download: -1` (seen on example.com), so the comparison is
not meaningful in general.

Completion always arrives on **outlet 0**, success or failure. Outlet 2 has never
fired.

**`[jit.uldl]` is not needed.** `[maxurl]` does the job, and it does not drag in
the Jitter runtime.

---

## Results

Fill this in as they are run. An unrun spike is not a "probably fine".

| Spike | Question | Status | Finding |
|---|---|---|---|
| 1.2 | `[js]` -> `[buffer~]` reads a file from disk | **YES, measured in Live** | `frames=0` -> `replace jongly.aif` -> **124439 frames, 1 ch, midsample -0.0319**. Bytes arrive. The `Buffer` binding is what the docs say: `send`, `framecount`, `channelcount`, `peek` all exist and work. "Disk is the audio transport" holds. |
| 1.1 | `set` on `live.*` suppresses outlet output | **YES, measured in Live** | `raw_param` raises the echo counter; `set_param` does not. `set` suppresses the outlet. The Surface's no-feedback design holds - **provided** it also fans the value out to the parameter's consumers, per the field evidence below. |
| 1.1a | ...and a `set` write still reaches automation | **not run** | Arm the track, write the dial with `set_param`, confirm Live records it. |
| 1.1b | ...and a `set` write still reaches Push | **YES, on hardware** | `set_param` moves the Push knob's value **while the echo counter stays frozen**. So `set` writes the parameter itself, and the suppression is scoped to the outlet (and the cords it drives). This is the result Stage 2 was gated on. |
| 1.1c | a `parameter_enable`d dial reaches Push at all | **YES, on hardware** | Push banked it automatically - no extra wiring, named from `parameter_shortname`, over `parameter_range`. Turning the Push knob moves the on-screen value. That is the parameter -> app direction; 1.1b is the untested one. |
| 1.3 | `[maxurl]` / `[jit.uldl]` downloads to disk in Live | **YES, measured in Live** | `[maxurl]` streamed 1,210,892 bytes of `.wav` over HTTPS to a file - and `[js]` then opened that file and counted the same 1,210,892 bytes. `status 200`, no truncation, progress on outlet 1, completion dict on outlet 0. `[jit.uldl]` not needed. `[node.script]` can go. |
| 1.3a | ...and what its failures look like | **BOTH measured** | A 404 **overwrites your file with the error page**. An unwritable path returns **`status 200`** plus an `error` key. Check both; trust neither alone. See the table below - it is what Stage 3.1 is built against. |

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
