# CLAUDE.md - guardrails for agents working in this repo

This repo builds Ableton Live `.amxd` devices from TypeScript, with no Max
editor in the loop. Read `README.md`, then `doc/ARCHITECTURE.md`, which explains
how the layers fit together. This file is the short list of things that will
silently break if you get them wrong.

## Where to make changes

This is a pnpm workspace: a device repo at the root, and the reusable
infrastructure carved into `packages/`.

- **`src/app/`** - the web app (UI, optional worker, `protocol.ts`). Most work
  belongs here.
- **`patcher/devices.mjs`** - the device manifest (name, type, chains,
  parameters).
- **`wrapper/device.ts`** - optional. Extra `[js]` message handlers for this
  device, concatenated after the packaged wrapper sources.
- **`packages/*`** - `@m4l-jweb/bridge` (the browser bridge),
  `@m4l-jweb/wrapper` (the `[js]` sources), `@m4l-jweb/build` (the CLI, `.amxd`
  writer and chain vocabulary). This is library code shared by every device.
  Change it deliberately, not incidentally, and never to work around something
  that belongs in `src/app/`.

## Hard rules

1. **The wrapper must compile to ES5.** Max's `[js]` is an ES5-era
   interpreter. No `let`/`const`, no arrow functions, no template literals, no
   promises, no modules, in the EMITTED output. The build parses it with acorn at
   `ecmaVersion: 5` and refuses to package on failure, so you cannot ship this
   bug - but you can waste time on it. Use `var` and `function`.
2. **No `console`, no `setTimeout` in the wrapper.** Use `post()` and Max's
   `Task`.
3. **No `[node.script]`.** Its failure modes in Live range from silently ignoring
   `script start` to crashing the host. Pure computation goes in a Web Worker
   inside jweb. A test enforces this.
4. **LiveAPI objects created during `loadbang` are DEAD.** They construct without
   error and observe nothing, forever. Create every observer from
   `live.thisdevice`'s `bang()`. Recreate them unconditionally - a guard like
   `if (obs) return` makes the bug permanent. `loadbang()` does file work only.
5. **Never hand-edit `dist/`.** It is generated.

## Facts that look like bugs

- **`jsarguments[0]` is the script name**, not the first argument. The device
  mode is at index 1.
- **`route` strips the selector.** A bare selector arrives as a `bang`. If the
  consumer needs the word, re-materialize it with a message box.
- **`File.writebytes` truncates silently** around 16 KB. Write in 4 KB slices and
  verify the byte count.
- **The device view is a fixed ~169 px tall.** Overgrown UI clips silently; it
  does not scroll.
- **Live embeds a copy of the device in the set.** Reinstalling does not update
  instances already on tracks. If behavior does not match the code, check the
  build stamp in the UI footer and the Max console, then delete and re-drag the
  device.
- **Use LiveAPI, not MSP, for transport.** A `plugsync~` -> `snapshot~` chain
  reads zero in a MIDI-effect device: those devices do not reliably run a DSP
  graph. Poll `live_set is_playing` + `current_song_time` instead. It works in
  every device type. Likewise, tempo comes from a LiveAPI observer - the
  signal-domain alternative reports samples-per-beat, not BPM.
- **Never trust an object's outlet order from memory.** Check the reference page
  and log the raw values before you wire anything to them.
- **`unpack` fires right-to-left.** That is why the MIDI chain unpacks
  explicitly: the delay must reach `pipe`'s cold inlet before the pitch hits the
  hot one.

## The contract between the two sides

`src/app/protocol.ts` is the single source of truth for every selector crossing
the bridge. If you add a message:

1. Add the selector to `IN` or `OUT` in `protocol.ts`.
2. Bind or emit it in the app, via `@m4l-jweb/bridge`.
3. Handle it on the Max side: a `function <selector>()` in the wrapper
   (`packages/wrapper/src/`, or this device's `wrapper/device.ts`), or a `route`
   in a chain in `packages/build/src/chains.mjs`.

`tests/protocol.test.mjs` fails if you skip step 3. That is deliberate: an
unrouted selector is a message falling on the floor, and it produces no error at
runtime.

## Verifying your work

```bash
pnpm build   # must emit every .amxd with no Max installed
pnpm test    # container round-trip, ES5 gate, protocol lint
pnpm dev     # browser dev; window.maxSimulate(sel, ...args) fakes the bridge
```

You can verify almost everything without Live: the build proves the container is
well-formed, the tests prove the bytes round-trip, and `maxSimulate` drives the
UI through its real message handlers. Reserve "load it in Live" for what
genuinely needs Live: timing, audio, and LiveAPI behavior.

Do not claim a device works in Live unless you have actually seen it there. Say
what you verified and how.
