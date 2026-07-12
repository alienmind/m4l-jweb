# CLAUDE.md - guardrails for agents working in this repo

This repo builds Ableton Live `.amxd` devices from TypeScript, with no Max
editor in the loop. Read `README.md`, then `doc/ARCHITECTURE.md`, which explains
how the layers fit together. This file is the short list of things that will
silently break if you get them wrong.

## Where to make changes

This is a pnpm workspace: a device repo at the root, and the reusable
infrastructure carved into `packages/`.

- **`src/app/<device>/`** - ONE FOLDER PER DEVICE (`App.tsx`, `protocol.ts`,
  `surface.ts`). Most work belongs here. Each device builds into its own `.amxd`
  with its own UI bundle, so do not reintroduce a shared `App.tsx` that branches
  on `mode` - a device ships what it is, not what its siblings are.
- **`src/app/shared/`** - what every device has: `useDevice()` (mode, build,
  tempo, transport, the `ui_ready` handshake), the `Frame` chrome, the worker.
- **`patcher/devices.mjs`** - the device manifest (name, type, chains,
  parameters). Adding a device here means adding `src/app/<name>/` too; a test
  enforces it.
- **`wrapper/device.ts`** - optional. Extra `[js]` message handlers for this
  device, concatenated after the packaged wrapper sources.
- **`packages/*`** - `@m4l-jweb/bridge` (the browser bridge), `@m4l-jweb/surface`
  (`defineSurface` + the dev harness), `@m4l-jweb/wrapper` (the `[js]` sources),
  `@m4l-jweb/build` (the CLI, `.amxd` writer and chain vocabulary). This is
  library code shared by every device. Change it deliberately, not incidentally,
  and never to work around something that belongs in `src/app/`.
- **`packages/build/templates/starter/`** - the `m4l-jweb init` scaffold. Most of
  it is this repo's own infrastructure, copied verbatim: `scripts/`,
  `vite.config.ts`, the tsconfigs, `src/main.tsx`, `src/index.css`,
  `src/app/shared/`. `tests/starter.test.mjs` compares those byte-for-byte, so if
  you change one at the root, **copy it into the template** - that is the intended
  fix when the test fails, not an edit to the assertion. Keep device names out of
  those shared files; the template inherits them.

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
- **`set` on a `live.*` object silences it for EVERYONE.** `set <value>` updates
  the parameter without producing outlet output - which is what stops an app
  writing a parameter from feeding itself back. But it also cuts every cord that
  object drives *inside the patcher*. Never chain a parameter's consumers behind
  the parameter object: fan the value out (to the object AND to what it controls)
  or the app's writes reach the dial and nothing else. See `writableParams()`.
- **A `live.*` object with no `default` loads at the BOTTOM of its range**, and
  for many parameters that is a broken device (a cutoff of 0 eats the signal).
  Set `default` in the manifest. Note `parameter_initial` is inert without
  `parameter_initial_enable`.

## The contract between the two sides

`src/app/<device>/protocol.ts` is the single source of truth for every selector
crossing that device's bridge. If you add a message:

1. Add the selector to `IN` or `OUT` in that device's `protocol.ts`. If the name
   belongs to the library (the wrapper, or a chain), spread it in from
   `@m4l-jweb/bridge` (`DEVICE_IN`, `CHAIN_IN`, `CHAIN_OUT`) rather than retyping
   it.
2. Bind or emit it in the app, via `@m4l-jweb/bridge`.
3. Handle it on the Max side: a `function <selector>()` in the wrapper
   (`packages/wrapper/src/`, or this device's `wrapper/device.ts`), or a `route`
   in a chain (`packages/build/src/chains.mjs`, or `patcher/chains.mjs`).

`tests/protocol.test.mjs` fails if you skip step 3, and it lints each device
against its own Max side. That is deliberate: an unrouted selector is a message
falling on the floor, and it produces no error at runtime.

## Verifying your work

```bash
pnpm build             # must emit every .amxd with no Max installed
pnpm test              # container round-trip, ES5 gate, protocol lint, bundle separation
pnpm dev:hello-midi    # one device in a browser, with a mocked Live beside it
```

`pnpm dev:<device>` gives you a mock transport and a log of every message
crossing the bridge, so a sequencer is debuggable without Live.
`window.maxSimulate(sel, ...args)` still fakes an inbound message from the
console.

You can verify almost everything without Live: the build proves the container is
well-formed, the tests prove the bytes round-trip, and the harness drives the UI
through its real message handlers. Reserve "load it in Live" for what genuinely
needs Live: timing, audio, and LiveAPI behavior.

Do not claim a device works in Live unless you have actually seen it there. Say
what you verified and how.
