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

**...and a third, which the `samples` chain shipped with: `[buffer~]` DOES NOT RESOLVE
A RELATIVE PATH THE WAY THE DEVICE DOES.** A bare name is looked up in **Max's search
path**, which does not contain the device's own folder - so `preview.wav`, downloaded
by `fetchToFile()` into exactly that folder a second earlier, came back
`buffer~: preview.wav: can't open`. Two resolutions of one path, and the device wrote
the file correctly and then looked for it somewhere else. **A path from the app is
resolved ONCE, in the wrapper** (`resolveFetchPath()`), and the resolved path is handed
to the buffer - which also keeps it a single symbol, since a real install's path
(`.../Ableton Library/.../Max For Live/...`) has spaces in it and would otherwise split
into atoms in the patcher.

**And the format list is `[buffer~]`'s, not Max's: WAV, AIFF, Next/Sun - no MP3.** MP3,
OGG, FLAC and M4A belong to `[sfplay~]`, which streams from disk instead of filling a
buffer. A format `buffer~` will not decode produces a line in the Max console and *no
bang*, so there is nothing for an app to await - which is why `loadSample()` carries a
timeout and the wrapper pre-checks the file it can see.

**VERIFIED IN LIVE** (`hello-sampler`, an `instrument`): fetch to disk -> `replace` ->
`[groove~]` -> the track. The first device in this repo that originates a sound.

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
Two things about that reply are traps, and both look like success:

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
shared-name behavior instead of breaking. `deviceBufName`/`voiceBufName` in
`chains.mjs` emit it.

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
