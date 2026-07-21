# @m4l-jweb/build

The CLI. It reads a device manifest and writes finished, installable `.amxd` files - generating the Max patcher, compiling the `[js]` wrapper, and freezing your UI bundle inside the device. No Max editor is opened at any point.

Part of **[m4l-jweb](https://github.com/alienmind/m4l-jweb)** - build Ableton Live devices (`.amxd`) from a TypeScript repo: React UI, LiveAPI glue, CI builds, no Max editor.

## Install

```bash
pnpm add @m4l-jweb/build
```

## Usage

```bash
# in a device repo
pnpm m4l-jweb build       # patchers + wrapper + .amxd, end to end
pnpm m4l-jweb patchers    # just regenerate the patcher JSON
pnpm m4l-jweb wrapper     # just recompile the [js] wrapper
pnpm m4l-jweb install     # copy the built devices into your User Library
pnpm m4l-jweb init        # scaffold a new device repo
```

## Notes

- Devices are declared as data in `patcher/devices.mjs` - a name, a `type` (`midi` / `audio` / `instrument`), and a list of **chains**. Patch cords become code review.
- Chains are small functions that each claim a stage of the signal or message path: `webaudio` (the page's own audio, via `[jweb~]`), `midiin`, `midiout`, `lowpass`, `gain`, `download`, `remote`, and your own in `patcher/chains.mjs`.
- The generated patcher is checked before it is written - duplicate box ids and unrouted selectors fail the build rather than producing a device that loads and silently does nothing.

## Requirements

Ableton Live 12 with Max 9. Devices are built on `[jweb~]`, the browser view with signal outlets; older hosts are unverified.

## Links

- [Repository and full README](https://github.com/alienmind/m4l-jweb)
- [Architecture](https://github.com/alienmind/m4l-jweb/blob/main/doc/ARCHITECTURE.md)
- [What Max actually does: the measured facts](https://github.com/alienmind/m4l-jweb/blob/main/doc/MAX-FACTS.md)

## License

MIT
