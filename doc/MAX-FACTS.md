# What Max actually does: the measured facts

This file is the **evidence log**. Every claim below was *measured in Live*, on
hardware, by a spike device built for the purpose - not read in a manual and not
inferred from a name. They are the ground this architecture stands on, and the next
thing built on top of them needs them intact.

Three documents, one subject, deliberately layered:

- **[CLAUDE.md](../CLAUDE.md)** is the terse guardrail - the one-line rule an agent
  reads every session ("`set` on a `live.*` silences it for everyone").
- **This file** is the proof behind each rule - the spike, the numbers, what was
  written and what happened.
- **[ARCHITECTURE.md](ARCHITECTURE.md)** is how the system is built, and points here
  for the Max behaviour it relies on.

The method is worth as much as the results: **gate every unknown behind a cheap spike
that can fail early**. A wrong guess about `set` semantics, discovered after the
Surface codegen was written, would have cost a week; discovered in a spike, it cost an
afternoon and would have cost a fallback design. Run it in Live, one thing at a time,
and *look* - never predict an answer from an attribute's name.

---

## Never invent a name Max is going to look up

This is the invariant the last two features were built in violation of, and both of
them cost weeks. It deserves to be stated once, on its own:

**Max does not validate the names you give it. It ignores what it does not
recognise.** So a wrong name is not an error - it is a feature that does nothing, in a
patcher that loads, keeps every patch cord, and reports nothing anywhere. There are
three flavours, and this repo has now hit all three:

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

The corollary, and the reason this is architecture rather than advice: **the build is
where the check belongs.** `assertUniqueBoxIds()` (which now recurses into
subpatchers, because the window codegen hid a duplicate id inside one) and the protocol
lint exist precisely because Max will not tell you. Every trap in this document that
*can* be a test now is one.

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

The consequence is the clipboard, and the clipboard inside `[jweb~]` lies:
`document.execCommand("copy")` RETURNS TRUE while copying nothing, and the page cannot
detect it, because `navigator.clipboard.readText()` needs a secure context a `file://`
page does not have. A copy can be claimed and never confirmed. `copyPath()` in
`@m4l-jweb/bridge` therefore attempts the copy, then shows a focused, pre-selected
field and waits for the browser's own `copy` event - the only honest confirmation
available - and reports `copied` / `manual` / `cancelled` rather than a boolean.
