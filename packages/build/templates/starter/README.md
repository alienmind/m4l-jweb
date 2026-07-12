# {{name}}

A Max for Live device, built with [M4L-JWEB](https://github.com/alienmind/m4l-jweb).

```bash
pnpm install
pnpm dev              # the device in a browser, with a mocked Live beside it
pnpm build            # {{name}}.amxd - no Max installed
pnpm install:device   # into Ableton's User Library
```

Then in Live: **User Library > Max For Live > {{name}}**, and drop it on a MIDI
track.

## What you edit

| File | What it is |
|---|---|
| `src/app/{{name}}/App.tsx` | The UI, and the device's logic. A React app. |
| `src/app/{{name}}/protocol.ts` | Every selector crossing the bridge. Both sides read it. |
| `src/app/{{name}}/surface.ts` | The Live parameters (automatable, MIDI-mappable, visible to Push). |
| `patcher/devices.mjs` | The manifest: name, type, chains, parameters. The patcher is generated from it. |

`src/app/shared/` and `scripts/` are infrastructure. You should rarely need to
touch them.

## Adding a second device

Add an entry to `patcher/devices.mjs` and a folder at `src/app/<name>/`. Each
device builds into its own `.amxd` carrying its own UI bundle, and
`pnpm dev:<name>` runs it on its own.

## Developing without Live

`pnpm dev` renders a mocked Live next to your device: a transport (play/stop,
BPM) driving real `tick` and `tempo` messages, and a log of every message
crossing the bridge. A sequencer is developable, and debuggable, in a browser.

A mock is a mock. It gives you the message-level contract without a DAW, but it
cannot tell you about MIDI jitter, real DSP, or LiveAPI on a loaded set. Load it
in Live for those.

## Notes

Live embeds a **copy** of a device into the set, so reinstalling does not update
instances already on a track - delete them and re-drag from the browser. The
device prints a build stamp in its footer, so a stale one is visible.
