# M4L-JWEB: what is left to do

The backlog for the library itself - things any device built on M4L-JWEB could use,
not one device's business logic. **Only open work lives here**, and as of 1.3.0 that is
ONE item - the library does what the devices built on it need. What has shipped is recorded where it belongs: **what the library
does** in [README.md](../README.md), **how and why (including everything measured in
Live)** in [ARCHITECTURE.md](ARCHITECTURE.md).

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
