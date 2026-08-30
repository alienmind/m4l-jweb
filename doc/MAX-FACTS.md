# What Max actually does: the measured facts

This file is the **evidence log**. Every claim below was measured in Live, on hardware,
by a spike device built for the purpose. None of it was read in a manual or guessed from
a name. This architecture stands on these facts, and the next thing built on top of them
needs them intact.

Three documents, one subject, deliberately layered:

- **[CLAUDE.md](../CLAUDE.md)** is the terse guardrail - the one-line rule an agent
  reads every session ("`set` on a `live.*` silences it for everyone").
- **This file** is the proof behind each rule - the spike, the numbers, what was
  written and what happened.
- **[ARCHITECTURE.md](ARCHITECTURE.md)** is how the system is built, and points here
  for the Max behaviour it relies on.

The method is worth as much as the results: **gate every unknown behind a cheap spike
that can fail early**. A wrong guess about `set` semantics would have cost a week if it
was found after the Surface codegen was written. Found in a spike, it cost an afternoon.
Run it in Live, one thing at a time, and look. Never predict an answer from an
attribute's name.

---

## Never invent a name Max will look up

This is the invariant the last two features were built in violation of, and both of
them cost weeks. It deserves to be stated once, on its own:

**Max does not check the names you give it. It ignores what it does not recognise.** So a
wrong name is not an error. It is a feature that does nothing, in a patcher that loads,
keeps every patch cord, and reports nothing anywhere.

There are three kinds, and this repo has hit all three:

| The name | What was written | What it is | What happened |
|---|---|---|---|
| A **`maxclass`** | `maxclass: "pcontrol"`, `maxclass: "dict"` | Both are *objects*: `maxclass: "newobj"`, with the name in `text`. A message box is `maxclass: "message"`. | The boxes never instantiated. The floating window's `[route]` matched perfectly and fired into **three boxes that were not there**. Parked for weeks as "Max refuses to route the message". |
| A **dictionary key** | `downloadfilename` for `[maxurl]` | The output-file key is **`filename_out`**. | An unrecognised key is ignored, so every request returned a healthy **HTTP 200** and wrote nothing. A perfect success and an empty folder. |
| An **attribute** | `pattr @save 1` | Not a pattr attribute. Persistence in Live is `parameter_enable`. | State that saved to nothing. (This one Max *did* complain about - the exception that shows how rare the courtesy is.) |

**Every one of these names is on disk, inside Live**, in the reference Max ships:

```
C:\ProgramData\Ableton\Resources\Max\resources\docs\refpages\   the reference pages
C:\ProgramData\Ableton\Resources\Max\resources\help\            worked examples, as patchers you can grep
```

`maxurl.maxref.xml` lists every request-dict key. `pcontrol.maxref.xml` says its
messages are `open` and `close` (`wclose` is `[thispatcher]`'s word - pcontrol rejects
it). `pattr.maxhelp` states the `parameter_enable` rule in one sentence, and
`Max DelayTaps.amxd` demonstrates it. **Read the refpage. Grep the factory patchers.**
It is five minutes against, twice now, several weeks.

That is why this is architecture and not advice: **the build is where the check
belongs.** `assertUniqueBoxIds()` and the protocol lint exist because Max will not tell
you. (`assertUniqueBoxIds()` now recurses into subpatchers, because the window codegen
hid a duplicate id inside one.) Every trap in this document that can be a test is one.

---

## Calling `outlet`/`messnamed` via `.apply` crashes Live

**Measured from a crash minidump: `(outlet as Function).apply(this, args)` faults the
`[js]` engine.** `outlet` and `messnamed` are Max HOST functions, and `.apply`-ing one
corrupts the interpreter: Live logs `jsliveapi: bad outlet index 0` and then dies with
an access violation (`0xc0000005`) whose faulting module is **`js.mxe64`** - Max's
JavaScript object. It reproduced on every load of a device whose LiveAPI observer
forwarded its value that way, and stopped the moment the `.apply` was removed.

The `reply()` note in `core.ts` had long warned that `.apply` on a host function *fails
silently across Max builds*. It is worse than silent: it takes the whole host down.

Two ways to send without it, and one is always available:

- **Fixed arity** - `outlet(0, selector, value)`. Every observer forwards a scalar (a
  tempo, a numerator, a name), so this is all a watch ever needs, and it is how the
  tempo observer always worked.
- **One array argument** - `outlet(0, ["notes", pitch, start, ...])`. Max outputs an
  array passed as the single argument as a **list**, first atom the selector. This is
  the variadic case (a note list) done safely - `read_notes` uses it.

`.apply` on your OWN functions (`sync_state`, `onWindowMessage`) is fine; the hazard is
the host functions alone.

## `set` on a `live.*` object

**It suppresses the outlet, and it still writes the parameter.** A bare value into the
inlet sets the object *and* makes it output - straight back to the app, which may set
it again. `set <value>` does not. Confirmed with an echo counter: `raw_param` raises
it, `set_param` does not.

And the write is real: a **Push** knob's readout follows a `set_param` while the echo
counter stays frozen. So the silence is scoped to the outlet, not to the parameter.
That is what makes the whole app -> parameter path possible.

**But the silence reaches further than the app.** It cuts every cord the object drives
*inside the patcher* - which is why a parameter's value is **fanned out** rather than
chained behind the object (see "Writing a parameter from the app" in ARCHITECTURE.md).
This was found the hard way, in a shipped device whose filter never moved.

A `parameter_enable`d dial also reaches Push with **no extra wiring at all**, in both
directions, named from `parameter_shortname`. "Generated parameters get Push and MIDI
mapping for free" is confirmed on hardware, not assumed.

## A native object's visibility and position at runtime

**Measured in Live, on a frozen M4L device: `obj.hidden` WORKS; `obj.presentation_rect`
does NOT.** Both reached from `[js]` as `this.patcher.getnamed("<varname>")` (Max's
global object IS the jsthis, so a plainly-called wrapper function sees `this.patcher`).

- Setting `.hidden = 1 / 0` hides and shows the object in the DEVICE (presentation)
  view - a `live.dial`, a `live.text`, the whole `[jweb]`, all of them. Confirmed: the
  dials a fx line names stay while the rest vanish; the entire `[jweb]` can be hidden to
  reveal native objects beneath it.
- Setting `.presentation_rect = [x, y, w, h]` is ACCEPTED - reading it back returns the
  new value - but is **never redrawn**. The object does not move or resize, even after
  toggling its visibility (the obvious thing to try: a presentation object might re-read
  its rect on a visibility change - it does not). A `[thispatcher]` `script hide`/`script
  move` attempt failed the same way, because `script` acts on the PATCHING canvas, not
  the presentation.

So a device view can HIDE and SHOW native objects at will, but their LAYOUT is fixed at
build time. That is the whole reason the fx device is TWO SCREENS layered and flipped
with hide/show, rather than one view that reflows its dials (see "Native layout" in
ARCHITECTURE.md). A reflow API (`useNativeLayout` / a `native_rect` wrapper handler) was
built, measured to not work, and removed rather than shipped.

## Renaming, re-uniting and RE-RANGING a dial at runtime (2026-07-22)

**Measured in Live, on a frozen M4L device: all three take on the DEVICE PANEL.** An
earlier spike recorded the opposite and was believed for months; it was wrong.

- `_parameter_shortname` renames the dial on the panel. It does NOT reach Live's
  parameter registry or a Rack macro picker, which keep the build-time short name. A
  frozen device cannot rename a parameter there, so any UI that wants the name visible
  must render it itself.
- `_parameter_unitstyle` takes (`Hz` = 3, `dB` = 4, ... per Max's own list), so the
  readout prints "600 Hz" instead of "600". Anything outside the list is style 9,
  Custom, with the string in `_parameter_units` - and it still prints.
- `_parameter_range` takes, **and the parameter then REPORTS IN THE NEW DOMAIN.** That
  is the whole trap, and what made the first attempt look like a Max limitation: the
  page went on normalizing 0..1, so it scaled an already-scaled value and the control
  sat at its minimum. The attribute was never the problem - the double scaling was.

The shipping shape is therefore a HANDSHAKE, not a blind write: the wrapper applies the
range, reads it back, and answers `param_range_ok` / `param_range_failed`; the caller
normalizes only while the answer is no. Exactly one scaling, wherever it lives. See
`describeParam()` / `onParamRange()` in @m4l-jweb/bridge and `useControls()` in
@m4l-jweb/surface/react.

## ...and a re-ranged dial LOSES its automation lane and its macro (2026-07-27)

Measured in Live, on the device the section above was written for. A widened dial
stops following **its own automation lane in Arrangement** and **any Rack macro mapped
to it**. Moving the automation breakpoint by hand is still audible, but the dial does
not move under a playing transport, and a macro turns with nothing happening at the
other end.

What isolates it to the widening rather than to the renaming that travels with it: in
the same device, at the same moment, `s1` had been renamed AND widened to 200..2000 and
was dead, while `s2` had been renamed and left at 0..1 and worked normally. Rename is
not the differentiator; range is.

The reading that fits: Live's automation and macro layers bind against the parameter as
the FROZEN DEVICE declares it, and `_parameter_range` moves the domain underneath them.
A macro at 0.5 goes on writing 0.5 into a parameter now spanning 200..2000, which is its
minimum - so the dial sits at the bottom and never visibly moves. No error, nothing in
the console, and the attribute write itself still reports success.

**So the range is not worth its price**, and `describeParam` no longer widens unless
asked (`widenRange: true`). A dial left at 0..1 automates, MIDI-maps and reaches Push;
the page does the scaling and renders the real value itself. What is lost is the dial's
own readout - `0.44` instead of `600 Hz` - which is a label, against a control the
musician cannot automate.

Confirmed in both directions on the same device: widened, the macro and the automation
lane were dead; rebuilt with the dial left at 0..1, both work.

**And then check what READS the value.** Removing the widening broke the consumer that
had quietly come to depend on it: m4l-strudel's REPL shim wrote the dial's value
straight into the pattern's slider widget, which was only ever correct while the dial
carried real units. With the dial back at 0..1 an lpf received 0.22 - i.e. 0.22 Hz - so
the sound cut out in one step and no dial position brought it back, the whole travel
being inaudible. Widening and scaling are one decision with two ends, and moving one
end silently moves the other.

## `[jweb~]` has audio OUT and no audio IN (Max 9 reference, 2026-07-22)

`[jweb~]` is "Web browser with audio output": ONE control inlet, and outlets L, R and
messages. There is no signal inlet, so **a page can never be handed audio**. Anything a
page wants to know about sound it did not make has to arrive as messages - a
`[peakamp~]` or `[snapshot~]` tap, at message rate - and a page cannot compute a
waveform of another page's output at all.

Two consequences worth stating: a device view cannot scope the sound of an audio WINDOW
it hosts, and pixels cannot cross between two Chromium contexts either (no shared
memory, no server, no frame grab), so mirroring one page's canvas into another means
shipping encoded frames as messages - which costs a synchronous GPU read inside
whichever page is making the sound.

## A window shown in PRESENTATION cannot be resized at runtime (2026-07-22)

Same root as the `presentation_rect` fact above, met again in a floating window: writing
the page box's rect while the subpatcher window opens in presentation is accepted and
never redrawn, so the page keeps its build-time size in a window the user just dragged
bigger. On the PATCHING canvas it does redraw.

So a resizable window is built the other way round: `openinpresentation` off, the page
at the canvas origin, everything else (inlet, receive, tag, outlets) parked at negative
coordinates where the window does not show it, and the wrapper polling the window size
and fitting the page to it - Max has no resize NOTIFICATION, only the `window getsize`
query.

## `[pattr]`: what actually saves into the Live SET

**Confirmed in Live: a value written into a bound `[dict]` came back, byte for byte,
after saving the set, closing it and reopening it** - `{"testValue":0.163769725878819}`
in, the same out. What makes that work is **`parameter_enable`**, and nothing else: a
pattr persists in a *patcher*, and Live never saves the patcher, it saves the SET. So
the pattr has to be a Live parameter (`parameter_type: 3` - a blob;
`parameter_invisible: 1`, since a blob cannot be automated and should not pretend to
be). It is the recipe `Max DelayTaps.amxd` uses to persist its tap times, and it is in
Max's pattr help in one sentence.

`@save` is not a pattr attribute at all - Max says so and carries on without it - and
`@autorestore` restores from the patcher, which is the wrong place. A device carrying
both of those saved nothing, and looked perfect until the set was reopened.

## `[buffer~]`, driven from `[js]`: disk *is* the audio transport

An empty `buffer~` went to **124439 frames** after `[js]` sent it `replace
jongly.aif`. Audio never has to cross the Max message bridge as data: the file lands
on disk, `buffer~` reads it, MSP plays it, and `[js]` sends only control messages.
`Buffer`'s `send`, `framecount`, `channelcount` and `peek` are all real.

**Two traps, both silent:**

- **`replace` on a file `buffer~` cannot decode is a no-op.** No error, and the buffer
  keeps whatever it held. **A frame count means nothing on its own** - only next to
  what the count was *before*. (The first run of this spike was a false pass for
  exactly this reason: a `buffer~` declared *with* a size reports that size whether or
  not the read ever happened. Declare no size.)
- **The channel count comes from the FILE, not the declaration.** `replace` adopted a
  stereo file's layout on its own. Anything reading a buffer asks `channelcount()`.

**...and a third: `[buffer~]` DOES NOT RESOLVE A RELATIVE PATH THE WAY THE DEVICE
DOES.** A bare name is looked up in **Max's search path**, which does not contain the
device's own folder - so `preview.wav`, downloaded by `fetchToFile()` into exactly that
folder a second earlier, came back `buffer~: preview.wav: can't open`. Two resolutions
of one path, and the device wrote the file correctly and then looked for it somewhere
else. The rule that follows applies to **any** path handed from the app to a Max object:
resolve it ONCE, in the wrapper (`resolveFetchPath()`), and pass the resolved path as a
single symbol - a real install's path (`.../Ableton Library/.../Max For Live/...`) has
spaces and would otherwise split into atoms in the patcher.

**And the format list is `[buffer~]`'s, not Max's: WAV, AIFF, Next/Sun - no MP3.** MP3,
OGG, FLAC and M4A belong to `[sfplay~]`, which streams from disk instead of filling a
buffer. A format `buffer~` will not decode produces a line in the Max console and *no
bang*, so there is nothing for an app to await.

**VERIFIED IN LIVE** (by `hello-sampler` as it was then, an `instrument`): fetch to disk
-> `replace` -> `[groove~]` -> the track.

> **Superseded as an ARCHITECTURE, still true as a FACT.** The `samples` and
> `instrument` chains that this drove were removed in 0.9.9: `[jweb~]` lets the page
> decode and play audio itself, so a sampler needs no `[buffer~]` at all. Everything
> measured above remains true of Max, and applies the moment a device drives `[buffer~]`
> from `[js]` again.

## `[maxurl]`: a URL, streamed straight to disk, with no `[node.script]`

**1,210,892 bytes of `.wav` over HTTPS, to a file, no truncation, no Jitter runtime**
- and `[js]` then opened that file and counted the same 1,210,892 bytes. (`[maxurl]`
reporting its own success is not evidence; the file on disk is. They agreed.) Then the
two spikes met: that file loaded into the `buffer~` gave **302712 frames, 2 channels**,
from empty. Network -> disk -> decode -> audio, in one device, in Live.

The request is a **dict**, so `[js]` builds it (`new Dict()`, `set`, `clear`,
`stringify` all confirmed):

```json
{ "url": "https://...", "http_method": "get",
  "filename_out": "C:/.../sample.wav",
  "overwrite_output_file": 1, "response_dict": "m4ljweb_res", "timeout": 30 }
```

| Outlet | Carries | Shape |
|---|---|---|
| **1** | **progress**, continuously, while the transfer runs | `<tag> <total> <sofar> 0 0` |
| **0** | **completion**, once - success *or* failure | `dictionary <responseDictName>` |

Outlet 1 gives a real download a progress bar for free. The completion dict carries
`status`, `header`, `content_type`, `size_download`, `content_length_download`,
`total_time`, `url` and `filename_out` (`body` is empty when `filename_out` is set).
Outlet 2 has never fired.

### ...and both of `[maxurl]`'s failure modes defeat the obvious check

| Outcome | `status` | `error` key | The file |
|---|---|---|---|
| **Success** | 2xx | absent | complete |
| **HTTP failure** (404) | 404 | absent | **the error page, written over whatever was there** |
| **Filesystem failure** | **200** | **present** | none |

**A 404 does not decline to write.** `[maxurl]` wrote the 355-byte Apache error page
to `filename_out` and **destroyed the good 1.2 MB `.wav` already cached there** -
`overwrite_output_file` does not care what the status was. **And an unwritable path
comes back as `status 200`**, because the *server* was perfectly happy; the only sign
is an `error` key that is simply absent on success.

Chain that with `replace` being a silent no-op on an undecodable file and the naive
implementation is a device that plays nothing, reports nothing, and has an HTML page
sitting where its sample should be. So anything built on this **checks `status` AND
the `error` key**, and **downloads to a temp path, moving it into place only on
success**, so a failure cannot destroy a good cached file.

(Do not add `size_download` vs `content_length_download` as a third check: it flags
the truncation, but a chunked response reports `content_length_download: -1`.)

### ...and how `fetchToFile()` survives them: MAXURL MOVES THE FILE

A download lands on `<dest>.part`, is validated (`status` **and** the `error` key
**and** the bytes on disk - each catches a failure the other two call success), and is
copied over the destination only then. **A 404 therefore cannot touch a good cached
file**, which is the hazard measured above.

The copy needs a mover, and `[js]` is not one: its `File` object has open, close and
the read/write family, and **no rename and no delete** - confirmed in Cycling '74's
reference, and again by asking the live object for its members. Copying the bytes
through `[js]` would put the payload back where it must never be.

**So libcurl does it.** `[maxurl]` speaks `file://`, so a GET of `file:///<part>` with
`filename_out` set to the destination is a native streaming copy, on maxurl's own
thread, with nothing crossing the message bridge. **Measured in Live: 1 MB in 6 ms.**

### A RELATIVE path handed to `File` lands in MAX's folder - and poisons that name forever

The single worst trap found in this repo, and it hid for months behind a plausible
wrong answer.

`new File("name.part", "write")` does not create the file in the device folder, or in
any current directory. It creates it in **Max's own folder** (`.../Ableton/Resources/Max`
on Windows). That alone would be a small bug. What makes it permanent is the second
half: **`File` in write mode resolves a NAME that already exists on Max's search path to
that existing file**, so from then on

```js
new File("C:/.../Max For Live/m4l-jweb/m4l-jweb-save.part", "write")
```

writes to the stray in Max's folder and ignores the absolute path it was given. And
`File` in READ mode searches the same path, so the wrapper's own verify finds the stray
at exactly the right size and passes. Every layer agrees the file is fine. Only
`[maxurl]`, which takes the literal path, tells the truth:

```
js:     save wrote 65536 bytes, 65536 on disk, expected 65536
js:     save place file:///C:/.../m4l-jweb/m4l-jweb-save.part -> .../test_save.bin
maxurl: Couldn't open file C:/.../m4l-jweb/m4l-jweb-save.part
js:     error Couldn't read a file:// file        (CURLE_FILE_COULDNT_READ_FILE)
```

**One save from an unsaved patcher poisons that filename for every device on the
machine, forever** - `[js]` cannot delete, so the stray cannot be removed from inside
Max. The proof was a directory listing: no `.part` beside the .amxd, and
`m4l-jweb-save.part` (65536 bytes) plus `rndA.wav.part` and `rndB.wav.part` (176444
each, weeks old - real Strudel exports) sitting in `Ableton/Resources/Max`. Moving those
three aside made the next save succeed with **no code change at all**.

So: `resolveFetchPath()` returns null rather than a relative path, and both the save and
the fetch refuse to write when the patcher is unsaved. A relative path is never handed
to `File`.

**What it was not** - each ruled out by measurement, and each a plausible day's work:

| Suspected | Ruled out by |
|---|---|
| a subdirectory in the destination | the destination was flat throughout |
| spaces in the device folder | the conformance check places from `.../Ableton Library/...` |
| percent-encoding the source URL | encoded passes; RAW is worse - `URL using bad/illegal format` |
| the closed File still being referenced | nulling it changed nothing |
| the `.part` extension | a `[js]`-written `.part` places fine |
| writing across message turns | one written across 8 `Task` turns places fine |
| `[maxurl]` being unwell at that moment | a 4 KB file written in the FAILING TURN placed, `error null` |

Every one of those was a real experiment that narrowed the space, and every one of them
was also a wrong answer confidently reasoned to. The thing that actually solved it was
**listing the directory** - the one step that asks the filesystem instead of the
program. The `.bin`/`.part`/turns assertions those experiments left behind live in
`wrapper/device.ts` and still earn their place; what they were missing was never a
cleverer hypothesis, it was `ls`.

**No unit test can see this.** The fake maxurl reads the real filesystem, which has no
Max search path, so a mis-located file is exactly as readable as a correct one. It is
in-Live-only, by construction.

Two things about the place reply are traps, and both look like success:

- **It has no HTTP status** - it comes back `status 0`, because no HTTP happened. The
  2xx check that guards the *download* would reject a perfectly good *copy*. The place
  step is therefore validated on **bytes**, which is the honest check for both schemes.
- **The `.part` file cannot be deleted** (no unlink), so it is **truncated to zero** -
  assigning `eof = 0` is the closest thing to a delete that `[js]` has.

All of it is pinned twice: `tests/wrapper-max.test.mjs` runs the shipped wrapper
against a fake Max that reproduces these failure modes, and `wrapper/device.ts` asserts
the Max behaviours themselves, in Live, at the press of a button (6/6 passing as of
this writing). See "What the tests cannot catch" under CI invariants in ARCHITECTURE.md
for why it takes both.

**A note on how this one was found**, because it is the whole argument for spiking:
every fact in this section was measured *before* the feature was written - and the
feature was then written with a dictionary key (`downloadfilename`) that appears
nowhere in it. The spike was right, the notes were right, and the implementation did
not read them. Measuring a thing and then not consulting what you measured costs
exactly as much as never measuring it.

## `[plugsync~]` outlet 6 (song position) reads STUCK AT 0 in Live (2026-07-19)

Measured while the transport was **playing**, in a device built to time a loop off it:
`[plugsync~]`'s outlet 6 - documented as song position in beats, and the obvious way to
get transport phase into the signal domain - never left 0. A loop clocked off it never
fired a boundary, and the device sat silent.

**The transport source that DOES work is the LiveAPI poll**, which the packaged wrapper
already runs: `is_playing` + `current_song_time` at 20 Hz, emitted as
`tick <playing> <beats>`. Every device in both repos follows that tick, and it is
correct at any tempo and across loop jumps. Do not reach for `[plugsync~]` beats
because it sounds lower-latency; it did not work here, and the control-rate tick did.

Two smaller `[groove~]` facts from the same spike, if a loop player is ever built again:
its **last outlet is a 0..1 loop-position ramp**, so `[<~ 0.5]` -> `[edge~]` turns the
wrap into a per-loop boundary bang and the groove becomes its own clock with no
transport at all; and its **loop point interpolates**, leaving a faint click at the seam
- worst on a pure sine, near-inaudible on real material.

## `ClipSlot.create_audio_clip` works from `[js]`, and it REFERENCES the file (2026-07-30)

Measured in Live 12.4.3, by a spike device built for it, against the four questions that
could each have killed the feature.

**1. A path with spaces survives as ONE symbol.** `slot.call("create_audio_clip", path)`
with `C:/Music/AlienMindLibrary/Ableton Library/User Library/Max For Live/m4l-gugelhupf/
gugelhupf-export-<n>.wav` - three spaces - created the clip. LiveAPI's `call` does NOT
split a JS string argument into atoms the way a Max message would. This was the spike
that had to pass first, because a User Library path always contains "Ableton Library",
and this repo had already been bitten twice by the message-level splitting.

**That says nothing about the MESSAGE that carries the path to `[js]`**, which does split
- so `createAudioClip()` sends its whole request as ONE base64 atom. A path and a clip
name are both variadic and both routinely contain spaces; two of them in one flat message
cannot be told apart again.

**2. Live REFERENCES the file in place. It does not copy it into the project.** The proof
is a directory listing rather than an argument: `gugelhupf-export-<n>.wav.asd` - Live's
analysis file - appeared **next to the .wav in the device folder**, at the second the clip
was created, and no copy appeared under the project. So a set that moves without Collect
All and Save loses its audio, exactly as a hand-dragged file would. A device bouncing
into its own folder is choosing that trade; `defineFiles()` would have to write into the
project folder to change it, and nothing here does yet.

**3. An instrument can never provide an audio target.** Not a Live limitation this time
but a UI one, and it invalidates the obvious design: pressing a
button in a device's view requires that device's track to be SELECTED, so
`live_set view highlighted_clip_slot` is always a slot on the device's own track. An
instrument sits on a MIDI track, so its highlighted slot is a MIDI slot, always. There is
no reachable moment at which a device's own button and another track's slot are both
live. Hence two answers, neither of them a fallback: a device that means to bounce ships
as an AUDIO EFFECT (its own track takes audio clips), and `create_audio_track(-1)` is
offered explicitly where it does not.

WHAT A MIDI TARGET ACTUALLY DOES - a printed Live error, a catchable exception, or a
silent no-op - is STILL not measured, and now cannot be from here: the `has_audio_input`
pre-check fires first and the call is never made. Confirmed in Live from the instrument
flavour, which reported `create_audio_clip not_audio_track` and left the file on disk;
pressing the offered escape then created the clip in `live_set tracks 5 clip_slots 0`, a
track that did not exist a moment earlier. The wrapper depends on none of the three
behaviours - it re-reads `has_clip` afterwards, which catches all of them alike.

**4. The version is read, not inferred from a thrown exception.** `create_audio_clip` is
documented well before 12.0.5 and does nothing there, so the failure mode to design
around is a call that raises nothing and leaves the slot empty - indistinguishable from a
slot that was already empty. `hasAudioClipApi()` asks `live_app` and refuses below 12.0.5
with `needs_live_1205`. **The getter is `get_major_version`** - measured on 12.4.3, which
answered that spelling and not `get_version_major`; the wrapper tries both and posts
which one replied, because a name Max does not recognise is not an error here either. Unknown version means ATTEMPT: the slot is then inspected
afterwards, which is the check that cannot be fooled. The gate itself is UNMEASURED
against an old Live - there is no 12.0.4 on this machine to run it on - so what is
proven is which getter answers on 12.4.3, not that the refusal reads well on 12.0.4.

**The slot is the evidence, never the call.** `has_clip` is read back after
`create_audio_clip` returns, for the same reason `[buffer~]`'s frame count is read after
`replace`: a LOM method that declines prints to the Max window and returns nothing.

## Live's Browser is unreachable from `[js]` (spike, 2026-07-17)

`new LiveAPI("live_app browser")` resolves to id 0 -
`jsliveapi: component 'browser' is not an object`. The Browser (`load_item`,
`audio_effects`, hotswap) is exposed to CONTROL SURFACE Python scripts only, not to
the LOM that `[js]`/`live.object` see. A device therefore can never INSTANTIATE
another device; anything shaped like "create an Auto Filter next to me" is
adopt-only - bind to what the user placed by hand. What IS documented and safe:
`Chain.delete_device` / `Track.delete_device`, `Song.move_device` (Live 11+), and
`live.remote~` for modulation.

## `#0` does NOT expand in an `.amxd`; `---` does, per device (verified 2026-07-17)

Buffer names are global to Max, so instance-scoped names need a load-time
substitution. `#0` is documented for abstractions, and a Max for Live device patcher
**does not count as one**: the token stays literal in every instance, writer and
reader agree on one global name, and two device copies silently steal each other's
buffers - the exact failure it was meant to fix, with no error anywhere. The `---`
prefix is the mechanism built for this: Live expands a leading `---` to an id unique
to the DEVICE instance, and the scope is the whole device including subpatchers and
`[poly~]` voices - so device and voice spell the SAME name and nothing travels
through `poly~`'s arguments. Verified with two sampler copies on two tracks, each
keeping its own sound. Outside Live `---` stays literal, degrading to the old
shared-name behavior instead of breaking.

The library no longer emits such a name: 0.9.9 deleted the `samples`, `instrument` and
`renderplay` chains, because a `[jweb~]` page decodes and plays its own audio, and the
helpers that built the name (`deviceBufName` / `voiceBufName`) went with them in 1.2.1.
The fact is kept because it is true of Max, not of this library - any device that ever
puts a `[buffer~]`, a `[coll]` or any other globally named object in an `.amxd` needs
the `---` prefix and cannot use `#0`.

## Live names a DeviceParameter after its SHORTNAME, and nothing overrides it

The build stores the surface id as `parameter_longname`, and the box KEEPS it at
runtime (`getattr("_parameter_longname")` reads it back) - but the `DeviceParameter`
Live registers answers to the SHORTNAME (`name` and `original_name` both), and no
patcher data changed that: not the per-box attrs, not the patcher-level `parameters`
registry, proven against filenames Live had never cached. So `get_param_id` does not
bet on either policy: it asks the box for BOTH its names
(`_parameter_longname`/`_parameter_shortname`) and matches the enumerated parameters
against whichever one Live used. The surface id stays the only key an app passes to
`resolveParamId()`; display names never leave the wrapper. Two parameters answering
to one accepted name is refused loudly - a `live.remote~` bound to the wrong
parameter is modulation on someone else's control.

The patcher-level `parameters` registry is emitted anyway (`parameterRegistry()`),
because it is what Max itself writes and it is where **Push banks** live: box id ->
`[longname, shortname, type]`, plus `parameterbanks` as `{ index, name, parameters }`
with eight `"-"`-padded entries per bank - the shape read off devices Max saved.

## `live.remote~` takes knob TRAVEL, not the parameter's units

Measured: the incoming value is treated as a linear position across the parameter's
range, and the knob's `exponent` curve is applied ON TOP - send 2000 into a cutoff
declared `[40, 18000]` with `exponent: 4` and the parameter lands at
`40 + 17960 * ((2000-40)/17960)^4 = 42.5 Hz`. For an exponent-1 parameter the two
notions coincide, which is why raw units ever appeared to work. An app driving a
curved parameter must pre-warp: aim the travel at `norm(v)^(1/e)` so Live's `^e`
lands on `v` (see m4l-strudel's `useModulation.toRemote`). The rest of the `remote`
chain behaves as designed and is verified in Live: bind by LOM id, `[line~]` ramps
each value into a signal, no automation is written, `id 0` releases the parameter
back to the dial.

## Seeding a `[dict]` from the patcher: `@embed 1` + box-level `data`

The shape Max itself saves (read off `dict.maxhelp`): the box text carries
`@embed 1`, `saved_object_attributes` carries `{ embed: 1 }`, and the dict's contents
sit at box level under `"data"`. `applyPersistence()` uses it to seed every state
slot's dict with the declared default, in the same `{"__value": ...}` envelope every
runtime write uses - so a fresh instance reads its declared default instead of `{}`.
A restored `[pattr]` value overwrites the seed at load: restore beats seed, seed
beats nothing.

## `window flags` REPLACES the flag list

`window({ alwaysOnTop: true })` compiles a `loadbang` -> message -> `[thispatcher]`
into the window's subpatcher, and the message must name `grow close title` alongside
`float`: `window flags` replaces the whole list rather than adding to it, so `float`
alone produces a window with no close box - a reference card the user cannot get rid
of. Pinned by a test.

## `; max launchbrowser` does not reveal a folder (Windows 11, three rounds)

There is no way to show the user where a device wrote a file. `[js]` has no shell
call, and `launchbrowser` is the only door Max offers - it does not open. Measured in
Live in both forms:

- a percent-encoded `file:///C:/...` URL with a WRONG path DOES reach the shell: it
  raised a real "cannot find the file" dialog naming the path, so the message is
  travelling and being handled;
- the same URL with a CORRECT path opened nothing and reported nothing;
- a native backslash path behaved identically.

So the mechanism works and the intent does not, which is why no amount of quoting or
encoding fixes it. Nor is there a second object that reveals a path.

**Opening an `http(s)` URL is a different intent, and it is the one `launchbrowser` is
for.** `openUrl()` in `@m4l-jweb/bridge` and `open_url` in the wrapper use it that way -
`push-snake` credits its soundtrack with a link. It refuses anything that is not `http` or
`https`, because a `file://` path is the case measured above to do nothing. **Unverified in
Live**: the folder case is measured, this one is inferred from the same message reaching
the shell. A page cannot open a link itself - it is a `file://` document, and an ordinary
`<a target="_blank">` either does nothing or navigates the device view, replacing the whole
UI with a web page in a 169 px box with no way back.

The consequence is the clipboard, and the clipboard inside `[jweb~]` lies:
`document.execCommand("copy")` RETURNS TRUE while copying nothing, and the page cannot
detect it, because `navigator.clipboard.readText()` needs a secure context a `file://`
page does not have. A copy can be claimed and never confirmed. `copyPath()` in
`@m4l-jweb/bridge` therefore attempts the copy, then shows a focused, pre-selected
field and waits for the browser's own `copy` event - the only honest confirmation
available - and reports `copied` / `manual` / `cancelled` rather than a boolean.

## Grabbing a Push control (Push 3, Live 12, 2026-08-28)

Measured with `push-probe` (`doc/TODO.md` item 2) on a **Push 3**, over six
rounds. No Push 2 was reachable, so every number here is Push 3 and the plan's claim
that the generations share this behaviour is still unmeasured.

The spike exists because §3 of that plan was read off a shipping third-party device's
patcher instead of being run. Four of its statements are wrong on this hardware, and each
one fails the way this file exists to catch: silently.

### An id must be spelled `id <n>`, and a rejected call is only a console line

`get_control <name>` on the surface returns the control's LOM id - **negative** on a
Push 3, because it is proxied through `RemoteControlSurfaceWrapper` rather than a
Python remote script. Handing that number back as a bare int does not work:

```
surface.call("grab_control", "Button_Matrix")   ->  works
surface.call("grab_control", "id", -3)          ->  works   (TWO atoms)
surface.call("grab_control", -3)                ->  jsliveapi: 'int' (-3) is not a control of 'RemoteControlSurfaceWrapper'
surface.call("grab_control", 144)               ->  the same, for the ControlProxy's own `id` property
```

So the LOM's object-argument convention is the two-atom `id <n>`, and the proxy's
`id` property (144 here) is **not** an address - it is a different number that looks
like one. Grab and release **by name**: it is the only form that needs no id at all,
and the id is then wanted for one thing only, constructing the observer.

**`LiveAPI.call` does not throw when Live rejects the call.** It posts to the Max
console and returns normally, so a `try/catch` around it catches nothing. The probe
reported "grabbed Button_Matrix", attached an observer and painted, all against a
control it never held - and did it again two rounds later on the encoders, printing
"was ACCEPTED" directly above the rejection. Nothing in `[js]` can read the result.
**A grab is verified by looking at the hardware, or it is not verified.** The
patcher-level design in §3.5 inherits this exactly: `[live.object]` has no error
outlet either.

### The value observer: five atoms, and y counts from the top

§3.1 says three atoms, `<x> <y> <value>`. Both halves are wrong:

```
value cb: 2 atoms [0]=value [1]=bang               <- ON ATTACH. Not an event.
value cb: 5 atoms [0]=value [1]=54 [2]=0 [3]=0 [4]=1   <- press, TOP-left
value cb: 5 atoms [0]=value [1]=0  [2]=0 [3]=0 [4]=1   <- release
value cb: 5 atoms [0]=value [1]=66 [2]=0 [3]=7 [4]=1   <- press, BOTTOM-left
```

Pressing the four corners in a known order gives `y = 7` on the **bottom** row and
`y = 0` on the top. §2.3's API promises y bottom-to-top and §5's Snake layout is
written that way, so **the library must flip it** (`y = 7 - hardware_y`) in exactly
one place. Get it wrong and every device on the grid is mirrored vertically, with
nothing to report it - the reading that cost two rounds here, because a wrong
interpretation of the same payload collapsed four corners onto two cells and looked
like a hardware fault.

Atom `[4]` is `1` on every event observed, press and release alike. Unexplained.

Observing `value` fires **once immediately with `value bang`** - two atoms, no
coordinates. Forwarded blindly it is a press at `(undefined, undefined)`.

### Press and release only - velocity yes, aftertouch and slide no

Velocities are real and vary with the strike (32, 35, 42, 45, 48, 52, 54, 57, 66, 67,
73, 127 across the runs). But **nothing arrives between the press and the release**:
a pad held still for seconds emits its press and then nothing until it is lifted, a
hard sustained press adds no further events, and sliding a finger - within a pad or
across pads - produces nothing at all.

So the grabbed control is a **gate with a velocity**, not a continuous surface. U1 is
answered in the negative, and §7.2's "the slide within the pad gives the fine
position" crossfader cannot be built on this path. Whatever carries Push 3's
aftertouch and MPE, it is not the grabbed `Button_Matrix`'s `value`.

### The grab gates output too, and Live repaints your first frame

`send_value` on the proxy with no grab held lights nothing: painting is not an
independent capability. And the first paint *immediately* after a successful grab
does not appear either, while the same paint 400 ms later does - measured directly,
by painting the four corners twice from one handler:

```
probe: corners painted IMMEDIATELY after the grab      -> dark
probe: corners repainted 400 ms LATER                  -> lit
```

The reading is that Live's own surface script redraws the matrix just after handing
it over. **The takeover must defer its first frame**, which is the same shape as
§3.3's `[deferlow]` before the grab, one step later - and a device that paints once
on grab and then only on change would come up blank and stay blank.

### The repaint budget is not a constraint

64 `send_value` calls, timed in `[js]` across three burst sizes:

```
 1 frame  =   64 calls in   3 ms   (3.00 ms/frame)
10 frames =  640 calls in  27 ms   (2.70 ms/frame)
50 frames = 3200 calls in 130 ms   (2.60 ms/frame)
```

~41 us per call, flat - no queue effect at fifty consecutive full-grid frames. A
full 8x8 repaint is ~2.6 ms, so Snake at 8 fps spends 2% of its budget painting and
30 fps of *full* repaints would still be under 8% of one thread. The frame diff in
§2.2 stays worth having for the bridge traffic it removes, but it is not what makes
the grid usable.

### What is on a Push 3

`get_control_names` returns **176 controls**, as a Max-formatted reply - the selector,
the count, then `control <name>` pairs, then `done` - so a parser has to skip the
first two atoms. Push 3 carries names no Push 2 remote script has (`Jogwheel`,
`Jogwheel_Tap`, `Sets_Button`, `Capture_Button`, `Single_Track_Mode_Button`,
`Session_Screen_button`, `Nav_Select_Touch`, `Mpe_Pitch_Bend_Elements`), a
per-cell `<track>_Clip_<scene>_Button` for all 64 cells alongside `Button_Matrix`,
and `Double_Press_Matrix` / `Single_Press_Event_Matrix` / `Double_Press_Event_Matrix`
next to it. `Button_Matrix` itself resolves, which is what §3.2 could only infer.

**So the role table cannot be one table.** Ask `get_control_names` and resolve
against the answer, per §2.1 - a name from the Push 2 script is a guess on this
hardware.

### The palette: 0 is off, and every index is locatable

Painting `y*8 + x` and then `64 + y*8 + x` across the grid photographs the whole
128-index palette in two frames, with every index at a known pad (y from the top, as
above). Index **0 is off** - the top-left pad is the only dark one on page 0.

That is how the palette WAS read, and it is not how it is read now: Live holds the whole
table on disk, two sections below. The photographs survive only as the check that the
paint path is intact. §2.2's names stay library data resolved per generation rather than a
number a device writes, because an index does not mean the same colour on a Push 2.

### The Push 2 colour scheme does not describe a Push 3 (2026-08-30)

A published Push 2 scheme states the palette as a structure rather than a list: four
greys at 0-3, then fourteen hues every four indices from 5, so 14 hues x 4 brightnesses.
If it held, the name table would be a formula instead of a list. It does not hold.

Seventeen indices were painted on a Push 3 in one frame and photographed. The frame
carries an L-shaped marker of three pads in the top-left corner, because an L is unique
under all eight symmetries of a square: a photograph of it cannot be read a row or a
corner out, which is the one error that would fake this result.

| pads | indices | Push 2 says | the Push 3 showed |
|---|---|---|---|
| the marker | 3 | white | orange |
| row 3 | 1, 2, 3 | dark grey, grey, white | pink, red, orange |
| row 5 | 5, 9, 13, 17, 21, 25, 29 | red, amber, yellow, lime, green, spring, turquoise | salmon, yellow, mint, cyan, blue, magenta, amber |
| row 7 | 33, 37, 41, 45, 49, 53, 57 | cyan, sky, ocean, blue, orchid, magenta, pink | all pale, and hard to tell apart |

Two things fail separately. There is **no block of greys at 0-3**: index 2 is a red and
index 3 is an orange. And there is **no hue every four indices**: row 5 does sweep through
hues, but not that sweep, and row 7 is one pale pastel region rather than the second half
of a ladder.

What the frame settled, and what it did not. It killed the structure, and it showed
that **33 to 57 is one pale region** rather than more hues. It also showed the painted L
arriving as an L in the top-left corner, so `probe_paint`'s coordinates are right from the
page to the hardware with nothing mirrored on the way - which is the check worth keeping
the frame for.

It did NOT name indices. Reading a hue off a photographed LED is unreliable at the level
of a name, and the section below - Live's own table - is what the names now come from. Two
readings here are simply wrong against it: index 1 read as pink and is `#FF4032`, a red;
index 17 read as cyan and is `#3663FC`, a blue. An LED at full brightness blows out its
core in a photograph.

What follows: the two Push 2 sources ([Ableton/push-interface](https://github.com/Ableton/push-interface)
and the [push2_display crate](https://crates.io/crates/push2_display/0.2.0/code/)) describe
different hardware, so they cannot name a Push 3 index. And an index does NOT mean the
same colour across generations, so it is one table per generation, not one table.

### Live holds the pad palette, and the photographs were a page upside down (2026-08-30)

The palette does not have to be photographed at all. Live 12 drives Push from a Python
package on disk - `C:\ProgramData\Ableton\Program\Push\python\Push2\` - and
`colors.pyc` there defines `COLOR_TABLE`, 128 entries, which `push_color_index_to_pad_rgb(i)`
indexes directly and splits into bytes. That is the palette: index in, `0xRRGGBB` out.
It now ships as `PUSH_PAD_RGB` in `@m4l-jweb/surface`, and `PALETTE_CSS` is derived from
it rather than typed by hand.

The file is compiled for Python 3.11 (pyc magic 3495), so reading it needs a marshal
reader for that version, not the interpreter that happens to be installed.

**It agrees with the hardware, and it explains both errors the photographs had made.**

The first: `white: 69` was **`#5D1700`, a dark brown**. Page 1 of the old photographs was
read 180 degrees out. Map each old reading through `191 - n` and all four land exactly:

| the photographs said | true index | Live's value |
|---|---|---|
| red 64 | 127 | `#FF0000` |
| green 65 | 126 | `#00FF00` |
| blue 66 | 125 | `#0000FF` |
| white 69 | 122 | `#CCCCCC` |

Four readings, one rotation, no residue. Page 0 was the right way up - index 0 is off and
was the only dark pad - which is why one page was right and the other silently was not.

The second: **the greys were never missing, they were at the far end.** 118 `#595959`,
119 `#1A1A1A`, 120 `#FFFFFF`, 122 `#CCCCCC`, 123 `#404040`, and the pure primaries at
125, 126, 127. Ableton's own Push 2 manual tabulates exactly that tail, 122-127, which is
the independent check. Indices 65 to 117 are dim and shaded variants, which is why that
range photographs as mud and why the structure test's row 7 read as one pale region.

**Shading is Live's, and it is not a stride through the table.** `colors.pyc` also carries
`determine_shaded_color_index`, `shade_levels`, `translate_color_index` and its inverse,
`WHITE_MIDI_VALUE`, `TRANSLATED_WHITE_INDEX`, `UNCOLORED_INDEX` and
`DISPLAY_BUTTON_SHADE_LEVEL`, plus `COLOR_INDEX_TO_PUSH_INDEX` imported from
`ableton.v2.control_surface.screen_colors`. So a `.shade()` API is expressible, but its
arithmetic is Live's and has not been read - do not assume a shade is `index + 1`.

**Each entry's second field is unexplained.** `COLOR_TABLE[i]` is a PAIR: the `0xRRGGBB`
above, and a second number that runs `2 * i` exactly for i under 41, then compresses -
80, 80, 81, 81, 82, 82 - and ends at 127, non-decreasing throughout, 88 distinct values
over 128 entries. It is a mapping into some other 128-wide index space. Nothing here reads
it, and a guess about it would become a fact by repetition.

**The palette is remappable.** The Push 2 interface manual documents
`Set LED Color Palette Entry` (sysex `F0 00 21 1D 01 01 03 <i> <r> <g> <b> <w> F7`), `Get`
(`04`) and `Reapply Color Palette` (`05`). So the named Push 2 scheme in the section above
is a DEFAULT MAP, not a property of the hardware, and Live is free to load another - which
is exactly what the failed structure test was seeing.

Also worth not confusing with it: Push's clip-colour picker (shift + clip) shows **Live's
clip palette**, 70 colours in the track and clip context menu, which the LOM exposes as
`Clip.color` / `Track.color` (`0x00rrggbb`) and `color_index`. Push maps one onto a pad by
nearest match, the same job `nearestIndex` does. It is not the LED palette.

### Giving it back is safe, three ways

The question that decides whether any of this is shippable - does a device leave Push
broken? - answers cleanly. All three observed on the hardware:

- `grab_control` then `release_control` leaves Push completely usable.
- **Deleting the device without releasing** leaves Push completely usable. This is
  `MxDCore`'s `GRABBED_CONTROLS_KEY` being walked in `release_device_context`, seen
  from the outside: the grab belongs to the device context, not to the code.
- **Reinstalling the `.amxd` while an instance is loaded** forces a release and
  reload - Push blinks and comes back.

So a device cannot strand the hardware by crashing, by being deleted, or by being
replaced mid-session. That is what makes the takeover safe to ship at all, and it
means a device does not have to be trusted to release: only to release when it stops
wanting the grid.

### The encoders are grabbable, which is why the library refuses them

`grab_control "Track_Controls"` is accepted, and so is the matching release - no
console rejection either way. (The run before it passed the bare id `-4` and was
rejected for that reason alone, measuring the addressing rule a third time and the
encoders not at all.)

And it does not merely return quietly - it **takes them**. With two dials declared so
Push has something to map, the encoders move `ProbeA`/`ProbeB` normally, and from the
moment `grab_control "Track_Controls"` is sent they stop responding entirely.

So U6's answer is the one wanted: **yes, and never.** Grabbing an encoder costs it
automation, MIDI mapping and its automation lane - everything the parameter path
exists for - so `defineControls` refuses the role, and now refuses it for a measured
reason rather than an assumption.

Note the trap that made this hard to observe: grabbing and releasing in one message
turn leaves no held state to look at, so the only readable outcome is "the call was
accepted", which is exactly what this API will not tell you. And a device with no
parameters shows "No parameters mapped" on Push whether or not its encoders are
grabbed - the two are indistinguishable until the device declares a dial.

### The grab can be made on the control, with no arguments

`grab_control "Button_Matrix"` on the SURFACE is measured to work and is what the
spike uses. It is not the only shape, and not the one a shipping device uses.

The donor device's takeover is a subpatcher instantiated once per control, and its
graph is:

```
[get_control $1] -> [prepend call] -> [live.object A]      A = the SURFACE
                       -> [route get_control] -> [t l l]
                                                   |
                        the id, into the RIGHT inlet of [live.object B]
                        and into [live.observer value]
                                                   |
   [grab_control] / [release_control]  ->  [prepend call] -> [live.object B]
   [prepend send_value] --------------->
```

So `live.object` B is pointed AT THE CONTROL by id, and `grab_control`,
`release_control` and `send_value` are then called **on the control, with no
arguments**. That is the same thing as `[js]`'s `control.call("grab_control")` -
which the spike listed as its strategy 3 and never ran, on the suspicion that it was
what hung Live. A shipping device uses it in production, so that suspicion was
wrong, and the MIDI-port explanation for the hang stands unchallenged.

Two addressings, then, both real: by name on the surface (simplest, no id needed
before the grab) and no-argument on the control (what the id is needed for anyway,
since the observer wants it). A bare id as an argument remains rejected either way.

The rest of that subpatcher is the contention handling section 3.3 describes, and it
is worth reading as written: `[routepass 1]` -> `[deferlow]` before the grab, beside
the comment *"Wait with grabbing to give another instance time to release."*, a
`[route id]` -> `[!= 0]` -> `[change]` guard so a control that did not resolve never
reaches the grab, and `[route none]` -> `release_control` so a "none" target releases.

### The donor's control names span generations

The takeover addresses: `Button_Matrix`, `Pads`, `Display`, `Scene_Launch_Buttons`,
`Track_State_Buttons`, `Step_Buttons`, `Shift_Button`, `Select_Button`,
`Delete_Button`, `Duplicate_Button`, `New_Button`, `Undo_Button`, `Capture_Button`,
`Record_Button`, `Loop_Button`, `Convert`, `Back_Button`, `Left_Button`,
`Right_Button`, `Plus_Button`, `Minus_Button`, `Octave_Up_Button`,
`Octave_Down_Button` - plus `Layout_Button`, `Session_Mode_Button` and
`Note_Mode_Button` reached through **`get_control_by_name`**, a second resolver
beside `get_control`.

Several of those do not exist on a Push 3, which has `Left_Arrow` / `Right_Arrow`
and `Layout`, and no `Pads`, `Back_Button`, `Plus_Button` or `Step_Buttons`. A
device covering several generations therefore carries a superset and resolves what
is actually there - which is the same conclusion the 176-name dump forced, arrived
at from the other direction.

### MPE is a separate path

Devices that advertise MPE in Live (the badge top right of the device title bar) set a
**patcher** attribute, `is_mpe` - read off Max's own reference on disk,
`refpages/max-ref/patcher.maxref.xml`: *"Patch supports MPE (Max for Live). If enabled,
a Max for Live device will receive MPE data from Live."* (`external_mpe_tuning_enabled`
sits beside it and *"only has an effect if the is_mpe attribute is set to 1"*.)
`packages/build/templates/base.json` already emits `"is_mpe": 0`, so every device this
repo builds declares it explicitly off.

**It would not change the measurement above.** MPE in Max is a MIDI-domain feature -
`mpeparse`, `mpeformat`, `polymidiin`, per-note pitch bend on separate channels,
arriving through `[midiin]`. The grabbed `Button_Matrix` is a control-surface object
and its `value` property is a different channel entirely; enabling `is_mpe` adds no
atoms to that callback.

What it plausibly does is put Push 3's aftertouch and slide on the NOTE path, for a
device that receives notes. That relocates §7.2's continuous crossfader rather than
reviving it - the fine position would come from MPE notes, not from the grab. Untested
here: no device in this repo has set `is_mpe 1`.

**The donor sets it, and reads it with nothing special.** Its patcher carries
`is_mpe: 1` and `external_mpe_tuning_enabled: 0` at the top level - siblings of
`latency` and `devicewidth`, exactly where `base.json` writes `is_mpe: 0` - which is
what puts the MPE badge in the device title bar. And its entire MIDI vocabulary is
`midiin`, `midiparse`, `notein`, `noteout`, `makenote`: **no `mpeparse`, no
`mpeformat`, no `polymidiin`.** The flag is a declaration to Live, not machinery.

So a device that wants both does what the donor does: `is_mpe 1` to be sent the
expression as per-channel MIDI, and a `SurfaceTakeover` to own the pads' identity and
colour. The two paths do not meet - which is why no amount of flag-setting was ever
going to add atoms to the `value` callback.

**...and they are MUTUALLY EXCLUSIVE on the same pads.** Measured, with `is_mpe: 1`
on `push-probe` and `[midiin] -> [mpeparse]` reading outlet 9:

- MPE badge present in the device title bar, so Live accepted the declaration.
- **Not grabbed**: playing the pads produces a stream of `mpeevent` messages.
- **Grabbed**: the `mpeevent` stream stops completely.

Grabbing `Button_Matrix` takes the pads off the note path entirely. They stop being
an instrument and become a control surface, and the grabbed control's own `value` is
then the ONLY thing they emit - press and release, with a velocity.

That is the end of section 7.2's continuous crossfader, not a relocation of it. There
is no arrangement in which one pad reports both a grid coordinate and a pressure: a
device chooses, per moment, whether the pads are a grid or a keyboard. Which is
presumably how the donor's mode subpatchers work - grabbing the matrix for its step
view and releasing it to play.

**It is the PADS, not the grab.** Grabbing `Scene_Launch_Buttons` - the scene column,
not part of the 8x8 - leaves the `mpeevent` stream flowing untouched, and releasing it
changes nothing either way. So a takeover is not all-or-nothing: a device can own part
of the surface and keep expressive notes on the rest. Only claiming `Button_Matrix`
costs the note path, and it costs exactly that.

**And the stream depends on Push's own mode, with no grab involved.** All of the above
was measured in NOTE mode. In Session mode the pads are clip launchers and send no MPE
at all - Push's design, nothing to do with this API. So `mpeevent` arriving is never
evidence that a grab succeeded or failed, and a device cannot assume expression is
there: the user may simply be looking at a different page of their instrument.

### What `defineControls` takes from the reference, not from hardware

Everything above came off the hardware through `[js]`. The shipped takeover moves the
INPUT PATH into the patcher: `[live.observer value]` -> `[prepend pad_<key>]` ->
`[jweb]`, so a press reaches the page without going through `[js]`. That one step rests
on the reference, not on a Push:

- **`live.observer`'s left outlet carries the VALUE and nothing else.**
  `refpages/m4l-ref/live.observer.maxref.xml`: *"The left outlet is reserved for value
  messages, all other output is sent to the right outlet."* So the page is written
  against `<velocity> <x> <y> <1>`, not the `["value", ...]` a `[js]` callback gets. The
  two shapes are five and four atoms of the same numbers in the same order, so a wrong
  reading here is off by one atom: the page would see a velocity where it expects an x.
- **It fires once when it is pointed at an object**, with the property's current value:
  *"In response to the id message, the current value of the property, if a property was
  already selected, is sent out the left outlet"*. That is the patcher twin of the
  `value bang` the `[js]` observer sends on attach, and it is not a press. `padStore`
  drops anything shorter than three atoms.
- **The id goes in the RIGHT inlet as `id <n>`** - the same convention `[live.object]`
  uses, and the one the donor device's takeover subpatcher uses.

All three are unverified on hardware. If the payload is off by an atom, `push-snake`
reports presses at the wrong pad and nothing says why. That is what the device-view
readout and the mocked grid in the harness are for.

### An observer callback splits an object-valued property into two atoms

A `[js]` property observer is handed `[<property>, ...value]`. For a scalar that is two
atoms, and `a[1]` is the value. For an OBJECT-valued property - `selected_track`,
`selected_device`, anything the LOM answers with an id - the value is the two atoms
`id <n>`. So the callback is:

```
["selected_track", "id", 5]
```

`a[1]` is the SYMBOL `id`, not a number. Reading it gives `Number("id")` = **NaN**. NaN
is not equal to anything, including itself, so a focus test written as
`myTrackId === selectedTrackId` is false forever.

The takeover shipped that way. The `Takeovr` toggle went on, the wrapper decided not to
hold, and nothing said so, because comparing two numbers is not an error. Take the LAST
atom, which is the id in both shapes.

It is the same trap as `get_control`'s reply, for the same reason: the LOM's
object-argument convention is `id <n>`, everywhere, in both directions.

### `this_device canonical_parent` is the Chain inside a Rack

Not the Track. A device on a bare track resolves to the track in one hop. A device in an
Instrument or Audio Effect Rack resolves to the Chain it sits in, and that Chain's id
equals no `selected_track` Live will ever report. So a focus policy comparing the two
holds the grid on a bare track and never on a racked one, silently.

`ownTrack()` in `liveapi.ts` already climbed the chain for clip I/O, where the same
mistake produced "invalid property name" once a second. The takeover reuses it instead
of working it out again. That is the point of it being one function.

### The jog wheel is a DELTA of one detent, and it has no position at all

Measured with `push-probe`'s `probe_other Jogwheel 1` on a Push 3, 2026-08-29. Grabbed,
it streams continuously while the wheel turns, and its `value` is **two atoms** - the
property name and one number - not the five the matrix sends:

```
Jogwheel cb: 2 atoms [0]=value [1]=bang     <- ON ATTACH. Not an event.
Jogwheel cb: 2 atoms [0]=value [1]=1        <- one detent clockwise
Jogwheel cb: 2 atoms [0]=value [1]=127      <- one detent anticlockwise
```

Across 31 events of turning one way and then the other, the only values were **1 and
127**. That is a signed 7-bit step: 127 is -1. One event per detent, and turning faster
sends them faster rather than sending a bigger number - there is no acceleration in the
value.

**So J1 is answered, and the DJ platter in PUSH-USECASES.md is buildable.** A device
integrates the steps itself and owns the result; the hardware has no notion of where the
wheel is, because a continuous rotary has no position to have.

### The touch strip reports a WRAPPING BYTE, not a position

Same run, `Touch_Strip_Control`. It streams continuously under a grab, in the same
two-atom shape - and over 180 events across three passes it reported exactly **four**
distinct values:

```
-128, -64, 0, 64          as unsigned bytes: 0, 64, 128, 192
```

Four values, 64 apart, arriving in cycles like `0, 64, -128, -64, 0, 64` - a byte
counting in steps of 64 and wrapping. The direction of travel is recoverable from the
wrapped difference between consecutive events. **The absolute position is not.** It
repeats every four events, so where the finger is cannot be read from `value`.

**J2 is answered in the negative, for the crossfader that wanted it.** Whatever carries
the strip's real resolution, `value` on the grabbed control is not it: 64-unit steps of a
wrapping byte is not the ~64 clean steps a crossfader needs, it is four values in a loop.
A device can use it as a relative control - integrate the wrapped differences - and cannot
use it as a fader.

Not chased further, because the DJ surface is not scheduled work. What would answer it is
`Nav_Select_Touch` or `Mpe_Pitch_Bend_Elements`, both of which `get_control_names` lists
and neither of which anyone has read.

### `probe_other`'s first verdict was wrong, and the bug is worth keeping

It printed `range NaN..NaN, 5 distinct values` for a control that has four. Observing a
property fires once immediately with `value bang`, and `Number("bang")` is **NaN** - which
is not equal to itself, so it counted as a distinct value of its own AND made every
min/max comparison false.

The same attach notification is already recorded above as "not an event". It is worth
recording again as this: it is not enough to drop it from the OUTPUT, because anything
that then does arithmetic on the stream has to drop it too.

### Push must be in NOTE mode for a grabbed control to emit (Push 3, 2026-08-30)

A grabbed control in Session (clip) view reports NOTHING. Same device, same grab, same
finger on the strip: in clip view the observer fires once with the attach notification and
never again; switch Push to note mode and the events arrive.

This is worth more than it looks, because the failure is indistinguishable from the
control not existing. `Nav_Select_Touch` and `Mpe_Pitch_Bend_Elements` both RESOLVE to ids
and both went silent in clip view, which reads exactly like "this control carries nothing"
- and that reading would have been written down as a fact. Check the mode before
concluding a control is dead.

### `release_control` does not stop the observer (Push 3, 2026-08-30)

Handing a control back leaves its `value` observer attached and firing. The wrapper's
first version got away with this by accident: the observer lived in ONE variable, and
`probeOtherObs = null` dropped the last reference, so the collector took the object and
the events stopped as a side effect of garbage collection.

Keyed by control name, that stops being true - the callback closure is still a live
reference, so `delete` on the map entry frees nothing. A release that also tore down the
per-control state produced hundreds of `TypeError: probeOtherValues[control] is undefined`,
one per event, while the hardware carried on.

Two rules follow. **Stop an observer by making its callback bail, not by dropping a
reference to it** - a budget set to zero, or a flag it reads. And **a callback must survive
its own state having been torn down**: note that `undefined <= 0` is `false`, so a guard
written that way keeps running exactly when the entry it needs has gone. `!(n > 0)` is the
one that stops.

### A probe that shares state across controls invents readings (2026-08-30)

`probe_other` held its observer, its captured values and its event budget in three single
variables. Grabbing more than one control at a time pooled everything: the second grab
overwrote the observer reference, every callback pushed into the same array, and each
release printed that array under its own name.

What that produced, on a Push 3, is the reason it is written down. Three controls held
together - `Touch_Strip_Control`, `Nav_Select_Touch`, `Mpe_Pitch_Bend_Elements` - gave
three verdicts identical to the atom: `59 events, range -128..64, 4 distinct values`. Only
the strip had emitted anything. The other two produced nothing but the attach notification,
and both looked measured. A probe that reports silence as somebody else's data is worse
than one that reports nothing.

The budget was shared with the MATRIX observer too, so pressing `grab` mid-run silently
ate the other control's remaining events.

Now keyed by control name, and a control that emitted nothing says so.

### Still open

- Whether `Mpe_Pitch_Bend_Elements` - listed by `get_control_names` next to
  `Button_Matrix`, along with `Double_Press_Matrix`, `Single_Press_Event_Matrix` and
  `Double_Press_Event_Matrix` - carries the per-pad expression the matrix does not.
  `probe_other <name> 1` in the spike grabs any of them and dumps the atoms. The same
  question now stands for the touch strip's real position, which `value` does not carry.
- **`jweb~` warns that its source sample rate differs from the audio one**: `source
  sample rate (44100) differs from audio sample rate, stop and restart audio stream to
  correct`. Seen with `push-snake` playing its soundtrack in a set running at 48 kHz. A
  page's `AudioContext` takes the system default rate and cannot be told Live's, so the
  two can disagree. What it costs was not measured - the music sounded right - and the
  obvious guess (a resample, or a pitch error) is a guess.
- Whether atom `[4]` of a pad event ever differs from `1`.
- What `COLOR_TABLE`'s second field is. It runs `2 * i` up to i = 40 and then compresses
  to 127, so it maps into some other 128-wide index space, and nothing here reads it.
- How Live shades a colour. `determine_shaded_color_index` and `shade_levels` are in
  `colors.pyc` and have not been read, so a `.shade()` API is expressible but its
  arithmetic is not known.
- Everything about Push 2 and Push 1 apart from the palette, which is answered: an index
  does not mean the same colour on a Push 2 as on a Push 3, so the name table is one
  table per generation.
- Two unattributed console lines appear on a reload of a device that is already
  loaded: `get: no valid object set` and `The Max function "SendMessage" returned
  with error 2: Bad parameter value`. They arrive between the payload extraction and
  `bang`, before any probe code runs, and nothing observable follows from them.
- What a NON-MATRIX control's `value` carries, and what its `send_value` wants.
  `Scene_Launch_Buttons` was grabbed and released during the spike - that is how the
  note path was shown to survive it - but nothing read its payload. `defineControls`
  lets you declare one and reports whether the role resolved. It does not claim to know
  the shape.
- Whether `Play_Button`, `Up_Arrow` and `Down_Arrow` exist on a Push 3. They are in
  `defineControls`' candidate table, and they were NOT in the 176-name dump that was
  read. A candidate the hardware does not list is never called, so a wrong guess costs a
  `controls_role <key> 0` rather than a silent no-op. The table is still a guess until
  the dump is read against it.

Live's UI did **not** stutter during the 50-frame repaint burst.
