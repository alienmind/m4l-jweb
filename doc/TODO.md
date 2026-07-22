# M4L-JWEB: what is left to do

The backlog for the library itself - things any device built on M4L-JWEB could use,
not one device's business logic. **Only open work lives here**, ordered from smallest
effort to biggest. What has shipped is recorded where it belongs: **what the library
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

## 1. `defineFiles()` - the third declaration, and the one reality asked for

**Why this and not `defineSamples()`.** This slot used to read "`defineSamples()` - the
`buffer~` slots as a declaration". That item is dead: 0.9.9 deleted the `samples`,
`instrument` and `renderplay` chains and their `buffer_load` / `voice_play` APIs,
because a `[jweb~]` page decodes and plays its own audio. There are no `buffer~` slots
left in the library to declare. (One orphan remains to clean up: `deviceBufName` /
`voiceBufName` in `packages/build/src/chains.mjs` now have zero callers. **Salvage the
finding before deleting the code**: a leading `---` in a name is Max for Live's
per-DEVICE-instance substitution, scoped across subpatchers and `[poly~]` voices, and
`#0` is NOT - it stays literal in an `.amxd`, which is how two copies of one device
silently shared one buffer. That belongs in [MAX-FACTS.md](MAX-FACTS.md); it is true of
Max whether or not this library uses it.)

**What replaced it, on evidence.** Writing files turned out to be a real contract with
three parts that MUST travel together, and m4l-strudel shipped a device missing one of
them for a day:

- the **`download` chain**, because it owns `[maxurl]`, and phase three of `saveToFile`
  is a `file://` place through it - even for a device that never downloads anything;
- the wrapper's **device-folder flag**, which is how the page learns where its files
  went;
- the **selectors** - `fetch_to_file`, the `save_*` exchange, `device_folder`.

Get the first one wrong and the failure is *silent*: the bytes are written correctly,
the place request leaves on an aux outlet with nothing on the other end, no reply ever
comes, the promise never settles. The UI sits on "Rendering..." forever next to a
scratch file that looks almost right. Nothing in the build or the tests can see it.

**The shape.** `defineFiles()` in `src/app/<device>/files.ts`, the third sibling of
`defineSurface()` and `defineWatch()`: the device declares that it writes to disk (and
optionally into which subfolder), and the build derives the chain entry, the folder
plumbing and the selectors. A device that declares nothing gets no `[maxurl]`, and a
device that declares files cannot be built without it.

**Then, and only then, lift the shared codegen.** Declaration -> boxes -> wiring ->
selectors is one pipeline across Surface, Watch and Files; three instances is enough to
extract from, two was not. Leave the user-facing APIs bespoke. End state is
`defineDevice()` - folding in the manifest, so you never write `[js]`.

Do NOT build the generic compiler first and express the Surface in terms of it. An
abstraction from one example is a guess.

## 2. A folder-path helper, because revealing a folder is impossible

Every device that writes files hits the same wall: the user asks "where did it go", and
neither the page nor Max can open a file manager. `; max launchbrowser <folder>` is the
only door Max offers and it does not work - measured in Live on Windows 11 across three
rounds, in both forms. A percent-encoded `file:///C:/...` URL DOES reach the shell (a
wrong path raised a real "cannot find the file" dialog naming it) but a correct one
opened nothing and reported nothing; a native backslash path behaved identically.
`[js]` has no shell call, and there is no second Max object that reveals a path.

The workaround - put the path on the clipboard for the user to paste - is currently
duplicated in m4l-strudel, and it is nastier than it sounds:
`document.execCommand("copy")` **returns `true` in a jweb page and copies nothing**, and
the page cannot detect it, because `navigator.clipboard.readText()` needs the secure
context a `file://` page does not have. A copy can be claimed but never confirmed. The
shipping answer shows a focused, pre-selected field and waits for the browser's own
`copy` event, which fires only when a copy really happens.

That is library business by the same logic as item 2: three devices needed it, the
failure mode is a lie in the UI, and no device should have to rediscover it. Ship it as
a small bridge/surface helper with the honest three-way result (copied / user copied /
not copied) rather than a boolean.

## 3. (for next generation) A VST3 backend, so a device runs outside Live

Assessed in [FEAT-PATCHBOARD-VST3.md](FEAT-PATCHBOARD-VST3.md): the app, the bridge, the surface
and the harness port; the LiveAPI wrapper does not. **One repo, not a fork** - the
shared traps *are* the product. Its first step is a `Target` seam extracted from
`packages/build` while there is still only one target, which is worth doing on its
own merits.
