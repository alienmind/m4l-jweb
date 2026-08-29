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

**Built and working on hardware.** `defineControls` ships, `push-snake` runs in Live on a
Push 3, and the checklist that could only be run with the hardware in the room has been
run. How it fits together is in [ARCHITECTURE.md](ARCHITECTURE.md), "The pads: a control
surface you program". What was measured is in [MAX-FACTS.md](MAX-FACTS.md), "Grabbing a
Push control".

Three things are still open, and none of them blocks anything:

### 2a. The jog wheel and the touch strip - a spike

Two questions. Each is one button press in `push-probe`, whose `probe_other` grabs any
control by name, dumps 60 events and then says whether the trace looks like a delta or an
absolute position:

| # | Question | If it fails |
|---|---|---|
| J1 | Does `Jogwheel` emit a continuous stream under a grab - a DELTA or an absolute position? | The DJ surface dies. There is no other continuous rotary on the hardware. |
| J2 | Does `Touch_Strip_Control` emit a continuous position, and at what resolution? | Its crossfader falls back to an encoder. Under ~64 steps it reads as stepped and is worse than the on-screen fader. |

Cheap, and it gates the most visible half of `../m4l-qobuz-dj`'s stage 5.

**It does not gate the rename, and it cannot change the API.** `padStream({ role:
"jogwheel" })` and `usePadStream()` already exist and hand over the raw atoms without
decoding them, because nothing is known about what they mean. The answer fills that in.

**How to run it:** install, drop `push-probe` on a track, press **scan**, then **jog?** and
turn the wheel steadily one way for about four seconds. Press **jog?** again to release.
Then **touch?** and run a finger slowly up the strip. The verdict is the last few lines in
the device's log and in the Max console.

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
