# M4L-JWEB: what is left to do

The backlog for the library itself - things any device built on M4L-JWEB could use,
not one device's business logic. **Only open work lives here.** What has shipped is
recorded where it belongs: **what the library does** in [README.md](../README.md),
**how and why (including everything measured in Live)** in
[ARCHITECTURE.md](ARCHITECTURE.md), and **what was measured on hardware** in
[MAX-FACTS.md](MAX-FACTS.md).

Detailed device designs are NOT here. The pad use cases live in
[PUSH-USECASES.md](PUSH-USECASES.md), and this file references them rather than
repeating them.

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

## 1. A WINDOW page cannot write a file, and the reply routing is why

`saveToFile()` and `fetchToFile()` work from the device view only. A window's page is an
ordinary bridge client - its messages arrive tagged `window <id> <selector> ...` - but
`window()` in the wrapper passes through a whitelist (`ui_ready`, `get_state`,
`sync_state`, `param_*`) and hands everything else to `onWindowMessage`. Widening that
list is the small half.

**The real obstacle is that `replyWindow` is a DISPATCH-SCOPED variable.** It is set for
the duration of one inbound message and restored in `finally`, while a save's last phase
is asynchronous: `[maxurl]` places the verified `.part` and answers later, by which time
`replyWindow` is null again and `save_ok` goes to the DEVICE view - a window would sit
waiting on a promise that has already been resolved somewhere else.

So the fix is to record the origin on the PENDING REQUEST (`activeSave`, and the fetch
table) rather than lean on the transient, and have the reply path address whoever asked.
`fetchToFile()` has the same shape and the same bug; fix both at once, since a window
that can save but not fetch is a distinction nobody can remember.

**Who needs it:** m4l-gugelhupf's Studio window (its TODO item 6d) - it will be able to
render its own pattern to a WAV once that lands upstream in strudel, and a 17 MB buffer
cannot travel back to the device view through Max messages to be saved there.

---

## 2. The pads as a surface you program

Sixty-four RGB pads, the scene column, the transport - a device can neither read nor
light any of it. Closing that is `grid.draw()` and `grid.onPad()` in TypeScript.

**The mechanism is measured and the gate is met.** Six unknowns were spiked on a Push 3
with the `push-probe` device; the findings - addressing, the payload shape, the y
direction, what a grab costs, the repaint budget, teardown safety - are in
[MAX-FACTS.md](MAX-FACTS.md), "Grabbing a Push control". Read it before writing any of
the below: it contradicts the obvious guess in five places.

**The designs are in [PUSH-USECASES.md](PUSH-USECASES.md)** - the proposed API and three
devices written against it. Only the first is being built.

### 2a. The jog wheel and the touch strip - A SPIKE, and it gates use case 2

Two questions, each one button press in `push-probe` (`probe_other` grabs any control by
name and dumps the atoms its `value` carries):

| # | Question | If it fails |
|---|---|---|
| J1 | Does `Jogwheel` emit a continuous stream under a grab - a DELTA or an absolute position? | The DJ surface dies. There is no other continuous rotary on the hardware. |
| J2 | Does `Touch_Strip_Control` emit a continuous position, and at what resolution? | Its crossfader falls back to an encoder. Under ~64 steps it reads as stepped and is worse than the on-screen fader. |

Cheap, and it gates the most visible half of `../m4l-qobuz-dj`'s stage 5. Answer it
before anyone designs around either.

### 2b. The mock 8x8 grid in the harness

`@m4l-jweb/surface/dev` renders a mocked Live beside the app. Add a grid of divs that
paints from the outbound paint messages and sends pad events on click.

**Before the first real device, not after.** Without it every iteration is a rebuild, a
reinstall, a re-drag (Live embeds a copy of the device in the set, so instances already
on tracks do not update) and a squint at sixty-four LEDs. Its honest limit is the usual
one: the message-level contract, not pad latency.

### 2c. `defineControls` + the takeover chain + the wrapper's frame diff

The fourth sibling of `defineSurface`, `defineWatch` and `defineFiles`. The userland
shape is in [PUSH-USECASES.md](PUSH-USECASES.md); what the measurements force on it:

- **Grab and release BY NAME.** A bare LOM id is rejected; the two-atom `id <n>` works
  and buys nothing over the name. The id is needed only to build the observer.
- **A rejected call reports nothing** - not to `[js]`, not to `[live.object]`. There is
  no success to branch on, so the chain cannot verify its own grab.
- **Flip y in ONE place.** The hardware counts rows from the top and the API from the
  bottom; get it wrong and every device on the grid is mirrored, silently.
- **Defer the first frame.** Live repaints the matrix as it hands it over, so a paint
  issued in the grab's own message turn is lost.
- **Resolve roles at runtime** against `get_control_names`. A Push 3 returns 176 names
  and they are not the Push 2 set, so the role table cannot be one table.
- **Refuse the encoder roles**, for the stated reason: they are grabbable, and grabbing
  one costs automation, MIDI mapping and its automation lane.
- **Allow claiming non-matrix controls WITHOUT claiming the grid** - the scene column,
  the jog wheel and the touch strip cost nothing on the note path; the grid costs all of
  it.
- **A control is not always a grid or a button.** A jog wheel is a STREAM; the API needs
  a third shape, or it grows one badly later.

Split: discovery, grab, release and the value observer in a generated **chain** (no
`[js]` in the input path - a grabbed pad must not stop responding because a React render
is slow); the frame diff and `send_value` in `packages/wrapper`, because sixty-four cells
is a frame buffer and the patcher cannot diff without sixty-four `[change]` objects.

Selectors go in `CONTROLS_IN` / `CONTROLS_OUT` in `@m4l-jweb/bridge`, and an id travels
as an ARGUMENT, never baked into a selector.

### 2d. `push-snake` - the device that proves it

Full design in [PUSH-USECASES.md](PUSH-USECASES.md), use case 1. A device rather than a
demo because its bugs are visible from across the room. Two checklist items people
forget: **two instances in one set**, and **takeover switched off** - it must load and
behave with no hardware attached.

### 2e. `live.push` in `defineSurface` - independent, droppable

`live.push` configures Push's own note mode: `play_pad_map`, `play_note_colors`,
`play_usage`, and the expressive-pad geometry. It colours **notes, not pads**, so it
cannot address a step grid and shares nothing with the above. One box, a few attributes,
no protocol, no risk. Ship it separately, or not at all.

---

## 3. A HEADLESS target: TypeScript in, `[js]` out, no browser

A device declares its interface in TypeScript exactly as it does today -
`defineSurface`, `defineControls`, its protocol - and the build emits **only** the `[js]`
wrapper and the patcher. No `[jweb]`, no `[jweb~]`, no Chromium.

**Why it is suddenly worth having.** None of these is speculation:

- **The pad takeover needs no browser at all.** The grab, the paint and the value
  observer are `live.object` / `live.observer` in the patcher, and the surveyed
  third-party device does the whole thing with no `[js]` in its input path
  ([MAX-FACTS.md](MAX-FACTS.md)). A grid device's logic is a control plane, and `[js]`
  plus `Task` is a *better* clock than a Chromium page nobody is looking at - the Worker
  in use case 1 exists to dodge throttling only a hidden page suffers.
- **Audio without `[jweb~]` is a path this repo has already walked.** The `renderplay`
  and `samples` chains wrote bytes to disk and played them through `[buffer~]` /
  `[groove~]`; "disk IS the audio transport" is in [MAX-FACTS.md](MAX-FACTS.md). They
  were retired in 0.9.9 for ergonomics once `[jweb~]` could sound directly - not because
  they failed. For `../m4l-qobuz-dj` the trade may invert: a decoded 10-minute FLAC is
  ~210 MB in an AudioContext, two decks plus a preload is over half a gigabyte inside
  Chromium inside Live, and `[buffer~]` reading from disk has no such problem while MSP
  does EQ, filter and pitch natively.
- **Push 3 Standalone runs a subset of Max for Live.** Which subset is unknown here and
  untestable on a controller Push, but an embedded Chromium is a far less likely member
  of that subset than `[js]` is. **Unverified - do not design around it.** It is a reason
  the seam is worth having, not a requirement it must satisfy.

**The shape is a `Target` seam in `packages/build`** - the same seam
[FEAT-PATCHBOARD-VST3.md](FEAT-PATCHBOARD-VST3.md) wants for a VST3 backend, viewed from
the other side. Extract it while there is still only one target.

What a headless target gives up is real, and belongs in the API rather than in a
surprise: no React device view (native `live.*` objects only, which `defineSurface`
already generates), no Web Audio, no Workers, and ES5 in the emitted output.

**Not started, and not urgent.** The argument is strong and the evidence is in; what is
missing is a device that needs it badly enough to pay for the seam. `../m4l-qobuz-dj`
may be that device - it now intends its web half to be OPTIONAL.

---

# The way forward: a VST3 backend, so a device runs outside Live

**Not a backlog item.** It is what this library could become NEXT, and it is written down
here so the shape is not re-derived from scratch by whoever picks it up - possibly as a
separate project rather than as work on this one.

Assessed in [FEAT-PATCHBOARD-VST3.md](FEAT-PATCHBOARD-VST3.md): the app, the bridge, the surface
and the harness port; the LiveAPI wrapper does not. **One repo, not a fork** - the
shared traps *are* the product, and a fork would have to re-learn every one of them
recorded in [MAX-FACTS.md](MAX-FACTS.md).

Its first step is a `Target` seam extracted from `packages/build` while there is still
only one target, which is worth doing on its own merits and is the only part of it that
belongs in this repo today.
