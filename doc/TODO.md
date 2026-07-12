# M4L-JWEB: TODO

Library-level feature proposals that don't belong in a device repo's own
backlog - things any device built on M4L-JWEB could use, not specific to one
device's business logic.

The theme running through all three: **the `[js]` layer is a control plane, not
a data plane.** Max messages are a text-parsed protocol. Anything bulk - file
bytes, audio samples - travels via *disk*, and `[js]` only ever says "load
this path". Every design below that tried to push bulk data through the message
bridge got worse the closer we looked at it.

## 1. Fetch-to-disk primitive: eliminate the need for `[node.script]`

**Origin:** m4l-strudel's Samples device needs to download real files (sample
packs from dirt-samples/dough-samples/shabda) to `~/Music/StrudelSamples`.
`[jweb]` is a sandboxed Chromium view - it can `fetch()`, but cannot write
arbitrary files to disk. The only current escape hatch is `[node.script]`, a
real Node process with `fs` access - but Node for Max is unstable inside Live
(see `CLAUDE.md`'s hard rules: silently ignoring `script start`, at worst
crashing the host). It's the single least reliable piece of infrastructure this
project has, and every device that needs to write a real file to disk currently
has to pay that cost.

**The idea:** `[js]` already does file I/O - it's what writes the
self-extracting UI payload to disk via `File.writebytes` on load (see
`packages/wrapper/src/core.ts`). `[js]` always runs, even in a frozen device,
and is far more stable than `[node.script]`. Extend that from "one payload
written once at load" to "any file, fetched from a URL and written to disk, on
request, at runtime" - entirely inside Max-native objects, no Node process.

**Mechanism: a generated chain, not runtime object creation.** Two dead ends
worth recording so nobody re-proposes them:

- *Chunking bytes back through the bridge.* An early draft had the browser
  `fetch()` and hand bytes to `[js]` in base64 chunks for `File.writebytes` to
  reassemble, mirroring the 16 KB/4 KB payload-write pattern. Wrong shape: it
  serializes many MB through a text protocol for no benefit. The download should
  happen on the Max side, streamed straight to disk, with the browser sending
  one request message and getting one completion reply.
- *`[js]` conjuring the downloader with `this.patcher.newobject(...)`.* Also
  wrong, and it cuts against the repo's whole thesis: patch cords are
  **generated and code-reviewed**, not created at runtime. Runtime object
  creation inside a frozen device in Live is precisely the class of thing that
  fails silently.

So: a **`download` chain** in `packages/build/src/chains.mjs` that generates the
downloader box and wires its completion outlet back into `[js]`/`route` as a real
patch cord. It builds with no Max installed, it shows up in a diff, and
`tests/protocol.test.mjs` covers the selectors.

**Candidate objects.** `[maxurl]` is the modern HTTP object and does not drag in
the Jitter runtime; `[jit.uldl]` is the long-standing alternative built for
async HTTP-to-file with a completion callback. Which one actually delivers
reliable async-download-to-file *inside Live* is unverified - that is the spike
this item is gated on.

**Proposed protocol** (belongs in `@m4l-jweb/wrapper` + `@m4l-jweb/bridge`, not
a device's own `protocol.ts`, since any device could want this):

- UI -> device: `fetch_to_file <requestId> <url> <destPath>` - one message.
- device -> UI: `fetch_done <requestId> <bytes>` on success.
- device -> UI: `fetch_error <requestId> <message>` on failure.
- `@m4l-jweb/bridge` wraps the request id + round trip in a typed helper,
  e.g. `fetchToFile(url, destPath): Promise<{ bytes: number }>`, so consuming
  React code just awaits it.

**What this unlocks:** any device that needs a real file from the internet -
sample packs, impulse responses, presets - gets it without `[node.script]`. It
is also the foundation item 2 depends on.

**Status:** design only. Needs the `[maxurl]`-vs-`[jit.uldl]`-from-a-chain spike
before committing to rewriting the Samples device's download path.

## 2. Instrument devices: `buffer~` playback, NOT audio streamed through `[js]`

**The tempting idea, and why it is impossible.** It looks like the `[js]` layer
could grow an "audio out" utility - the app generates sound, hands it to `[js]`,
`[js]` streams it to Ableton - which would make writing an instrument trivial.
It cannot be built. Two independent hard walls:

- **`[js]` is not on the audio thread.** It is an ES5 interpreter on the
  scheduler/main thread. No callback hands it a sample block, and it has no way
  to feed `plugout~` sample by sample. Anything it "streamed" would glitch.
- **`[jweb]`'s WebAudio goes to the system output device, not into Live's
  chain.** Chromium's audio graph and MSP's DSP graph do not touch. Audio
  generated in the React app is *already outside* Ableton and cannot be pulled
  back in.

**The shape that works: disk is the audio transport.** The app requests a
fetch-to-disk (item 1). The file lands next to the `.amxd`. `[js]` sends a
`[buffer~]` a `read`/`replace` message with that path - native, fast, zero bytes
crossing the message bridge. MSP plays it inside the DSP graph, where audio
belongs. `[js]` only ever sends *control* messages: load this file, play this
slice at this pitch, at this time.

Concretely, a new chain vocabulary:

- **`instrument`** - `[poly~]` voices around `groove~`/`play~` -> `plugout~`,
  driven by the same `midinote`-style selectors the `midiout` chain already
  understands. Polyphony and voice stealing are Max's problem, not the app's.
- **`samples`** - a named `[buffer~]` per slot plus the control selectors to
  load into it: `buffer_load <slot> <path>`, replying `buffer_ready <slot>
  <frames> <ms>` so the UI can show what is actually loaded.

For audio the app genuinely computes itself (a waveform rendered in the Web
Worker), the escape hatch is the same one: write a WAV to disk, then
`buffer~ read` it. Do not round-trip PCM through Max messages.

For synthesis from scratch rather than sample playback the same rule holds: the
sound is made by MSP objects driven by parameters. `[js]` and the app move
parameters; they never move samples.

**What this unlocks:** m4l-strudel's Instrument device playing real samples
instead of a placeholder oscillator synth - and, generally, the first M4L-JWEB
device that makes sound.

**Status:** design only, blocked on item 1 for the download half. The
`buffer~`-from-`[js]` half (the `Buffer` binding in Max's `[js]`, and `buffer~
read` on an extracted payload) is independently spikeable *today*, with a file
already on disk and no network involved. That is the cheapest next experiment in
this document, and it de-risks the rest.

## 3. Promote the MIDI contract into the library

**Not a new capability - an existing one that is only half-exposed.** The wiring
is real and it works: `packages/build/src/chains.mjs` has a `midiout` chain
(`midinote <pitch> <vel> <durMs> <chan> <delayMs>` and `flush` -> `pipe` ->
`makenote` -> `midiformat` -> `midiout`, so the app computes *when* and Max
places the note precisely) and a `midiin` chain (`notein <pitch> <velocity>`).

But the *contract* for talking to those chains lives only in
`examples/transposer/protocol.ts`. Every device that wants MIDI re-declares
`midinote` and `notein` by hand, and `@m4l-jweb/bridge` offers no typed helper.
The chain is library code; the way to address it is copy-paste.

**The work:**

- Export the chain-owned selectors from `@m4l-jweb/bridge` (a `CHAIN_IN` /
  `CHAIN_OUT` a device can spread into its own `protocol.ts`), so the selector
  a device sends and the selector the generated `route` matches come from one
  definition.
- Add typed helpers over them: `sendNote({ pitch, velocity, durationMs,
  channel, delayMs })`, `flushNotes()`, `onNote(cb)`. Named arguments beat a
  five-positional-int `outlet()` call that is easy to get subtly wrong.
- Keep `tests/protocol.test.mjs` honest: a library-exported selector still has
  to land in a route or handler.

Small, unblocked, and it pays off immediately - item 2's `instrument` chain will
consume exactly this contract.

**Status:** ready to implement, no spike needed.
