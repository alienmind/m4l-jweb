# M4L-JWEB: what is left to do

The backlog for the library itself - things any device built on M4L-JWEB could use, not
one device's business logic. **Only open work lives here.** Shipped work is recorded
elsewhere: **what the library does** in [README.md](../README.md), **how and why** in
[ARCHITECTURE.md](ARCHITECTURE.md), and **what was measured on hardware** in
[MAX-FACTS.md](MAX-FACTS.md).

Device designs are not here either. The pad use cases live in
[PUSH-USECASES.md](PUSH-USECASES.md), and this file links to them.

Two rules everything here follows:

- **`[js]` is a control plane, not a data plane.** Bulk data travels via disk, never
  through Max messages.
- **Gate every unknown behind a cheap spike** that can fail in an afternoon rather than a
  week.

A third rule, learned the expensive way in 0.9.9: **re-check a premise before designing
around it.** The biggest item this file ever carried was "a page cannot put audio on a
track, so we need a C++ external". It was false about the object we were already using.
Four routes were analysed and one was fully built before anyone checked. That postmortem
now lives in
[ARCHITECTURE.md](ARCHITECTURE.md#the-native-audio-bridge-four-routes-and-the-object-that-replaced-them),
because it is settled history rather than work.

---

## 1. A window page cannot write a file

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

**Built, and confirmed working on hardware.** `defineControls` ships, `push-snake` runs in
Live on a Push 3 - grid, HUD, sprint, music, state, the lot - and the checklist that could
only be run with the hardware in the room has been run. The jog wheel is answered too. How it fits together is in [ARCHITECTURE.md](ARCHITECTURE.md), "The pads: a control
surface you program". What was measured is in [MAX-FACTS.md](MAX-FACTS.md), "Grabbing a
Push control".

Three things are still open, and none of them blocks anything:

### 2a. The touch strip has no readable position

**J1 is answered and the jog wheel works.** Grabbed, `Jogwheel` streams continuously and
reports a DELTA of one detent as a signed 7-bit step - 1 clockwise, 127 anticlockwise, one
event per detent. A device integrates them itself. The DJ platter in
[PUSH-USECASES.md](PUSH-USECASES.md) is buildable.

**J2 is answered in the negative.** `Touch_Strip_Control` also streams, but its `value` is
a byte counting in steps of 64 and wrapping: four distinct values over 180 events. The
direction of travel is recoverable from the wrapped difference; the position is not. That
is a relative control, not the ~64-step fader the crossfader wanted.

Both are measured in [MAX-FACTS.md](MAX-FACTS.md).

What is left is one question, and it is not scheduled: **where the strip's real position
lives.** `get_control_names` lists `Nav_Select_Touch` and `Mpe_Pitch_Bend_Elements` and
nobody has read either. `probe_other <name> 1` in `push-probe` grabs any control by name,
dumps its atoms and says whether the trace looks like a delta or a position.

### 2b. Colour names are photographs

`PUSH_PALETTE` ships about 23 names, read off the two palette pages through a camera at one
white balance. Index 0 = off is measured. Nothing else is. No grey is named because none
was identified, which is why `push-snake`'s wall is `tan`.

Sampling the photographs properly - or finding a source inside Live that states the
palette - would turn a table that is good enough to pick a readable colour into one a
device can trust. Whether an index means the same colour on a Push 2 is wide open, and
decides whether the table is one table or three.

### 2c. `live.push` in `defineSurface` - separate, droppable

`live.push` configures Push's own note mode: `play_pad_map`, `play_note_colors`,
`play_usage`, and the expressive-pad geometry. It colours **notes, not pads**, so it cannot
address a step grid and shares nothing with the above. One box, a few attributes, no
protocol, no risk. Ship it separately, or not at all.

---

## 3. Rename the project to `m4l-patchboard`

**Nothing blocks this any more.** The headless target was the gate, and it shipped in
1.6.0: `target: "headless"` emits only the `[js]` wrapper and the patcher - no `[jweb]`, no
HTML payload, no Chromium - and `hello-headless` is the device that proves it. How the seam
works is in [ARCHITECTURE.md](ARCHITECTURE.md), "Targets: where a device's logic runs".

Everything else still open - the jog wheel spike, the colour names, `live.push`, and item 1
below - is work on the library, not on its name. Merge 1.6.0 first, then rename.

**The name is now wrong, and measurably so.** `m4l-jweb` says what the library was when it
was one thing: a bridge to `[jweb]`. The web half is now optional - a device declares its
interface in TypeScript and the build emits `[js]` and a patcher, with or without a
Chromium page. So the name describes a COMPONENT rather than the project, and names one
that `hello-headless` does not contain at all. `m4l-patchboard` says what it actually is:
a generic Max for Live development framework in TypeScript.

Do it in one commit, and now rather than later. A rename is cheap while the reason for it
is visible, and expensive to explain afterwards. What it touches, so nobody rediscovers it
in the middle:

- the four published packages (`@m4l-jweb/{bridge,surface,build,wrapper}`), which are on
  npm. This is a new SCOPE and a major version, not a rename of existing packages. The old
  scope stays up, deprecated, pointing at the new one.
- the `m4l-jweb` CLI binary, and `m4l-jweb init`'s scaffold, which writes the scope into
  every generated `package.json`.
- the payload and window filename prefixes the wrapper extracts next to the `.amxd`. They
  are per-device, but some device repos carry the library name in their path.
- the repo, its docs, and the two device repos that use it - `../m4l-gugelhupf` and
  `../m4l-qobuz-dj`.

The one thing NOT to rename with it: `doc/MAX-FACTS.md`'s contents. Those measurements are
about Max, not about this library, and they outlive both names.

---

# Next: a VST3 backend, so a device runs outside Live

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
