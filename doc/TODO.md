# M4L-JWEB: TODO

Library-level feature proposals that don't belong in a device repo's own
backlog - things any device built on M4L-JWEB could use, not specific to one
device's business logic.

## Fetch-to-disk primitive: eliminate the need for `[node.script]`

**Origin:** m4l-strudel's Samples device needs to download real files
(sample packs from dirt-samples/dough-samples/shabda) to
`~/Music/StrudelSamples`. `[jweb]` is a sandboxed Chromium view - it can
`fetch()`, but cannot write arbitrary files to disk. The only current escape
hatch is `[node.script]`, a real Node process with `fs` access - but Node for
Max is unstable inside Live (see `CLAUDE.md`'s hard rules: silently ignoring
`script start`, at worst crashing the host). It's the single least reliable
piece of infrastructure this project has, and every device that needs to
write a real file to disk currently has to pay that cost.

**The idea:** `[js]` already does file I/O - it's what writes the
self-extracting UI payload to disk via `File.writebytes` on load (see
`packages/wrapper/src/core.ts`). `[js]` always runs, even in a frozen device,
and is far more stable than `[node.script]`. The proposal is to extend that
same capability from "one payload written once at build time" to "any file,
fetched from a URL and written to disk, on request, at runtime" - entirely
inside `[js]`/Max-native objects, no Node process at all.

**Mechanism, one call, not chunked.** The first draft of this idea proposed
streaming bytes from the browser (`fetch()` in React) back to `[js]` in
base64 chunks for `File.writebytes` to assemble - mirroring the existing
16 KB/4 KB payload-write pattern. That's the wrong shape: Max messages are a
text-parsed protocol, not designed for streaming potentially many MB per
request, and doing the fetch in the browser only to hand the bytes back to
`[js]` one message at a time adds a serialization round trip for no benefit.
The better shape: **`[js]` (or a Max-native object it drives) does the
network fetch itself, streamed directly to disk**, and the browser side just
requests "fetch this URL to this path" as a single message, with a single
completion/error reply - no chunking, no intermediate encoding.

Candidate Max-native object for the actual download: `[jit.uldl]` - a
long-standing Jitter object built for exactly this (asynchronous HTTP
download directly to a local file, callback on completion). Needs a spike to
confirm `[js]` can instantiate and drive it via
`this.patcher.newobject(...)` (or the `JitterObject` binding) the same way
other packaged Max objects are driven today - this hasn't been verified yet.

**Proposed protocol** (belongs in `@m4l-jweb/wrapper` + `@m4l-jweb/bridge`,
not a device's own `protocol.ts`, since any device could want this):

- UI -> `[js]`: `fetch_to_file <requestId> <url> <destPath>` - one message.
- `[js]` -> UI: `fetch_done <requestId> <bytes>` on success.
- `[js]` -> UI: `fetch_error <requestId> <message>` on failure.
- `@m4l-jweb/bridge` wraps the request id + round trip in a typed helper,
  e.g. `fetchToFile(url, destPath): Promise<{ bytes: number }>`, so consuming
  React code just awaits it.

**What this unlocks once it exists:** any device that needs to pull a real
file from the internet - sample packs, impulse responses, presets - can do
it without `[node.script]`, using the same lifecycle every other device
already trusts. m4l-strudel's Samples device is the first candidate to move
onto it (see that repo's `doc/TODO.md` for the device-specific follow-up:
using this to also power a redesigned Instrument device that plays real
samples instead of a placeholder oscillator synth).

**Status:** design only, not implemented. Needs the `[jit.uldl]`-from-`[js]`
spike before committing to a full rewrite of the Samples device's download
path.
