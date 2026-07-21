# @m4l-jweb/wrapper

The Max-side glue: the ES5 `[js]` script that owns a device's lifecycle, its LiveAPI work, transport polling, clip I/O and file writes. You do not usually import this - `@m4l-jweb/build` compiles it into every device it produces.

Part of **[m4l-jweb](https://github.com/alienmind/m4l-jweb)** - build Ableton Live devices (`.amxd`) from a TypeScript repo: React UI, LiveAPI glue, CI builds, no Max editor.

## Install

```bash
pnpm add @m4l-jweb/wrapper
```

## Usage

```ts
// Only a device repo extending the wrapper needs this: wrapper/device.ts is
// compiled together with the packaged sources into one ES5 script.
//
// Everything here must be ES5 - Max's [js] is not a modern JavaScript engine, and the
// build proves it with acorn before packaging.
```

## Notes

- `[js]` runs even inside a frozen device, and it is the only place LiveAPI exists - which is why the lifecycle lives here rather than in the browser.
- This package exists mainly so the build can find the wrapper sources (`@m4l-jweb/wrapper/sources`). It has no browser-facing API of its own.
- **`[node.script]` is never used.** It proved unstable in the field - silent non-start, then a full Live crash.

## Requirements

Ableton Live 12 with Max 9. Devices are built on `[jweb~]`, the browser view with signal outlets; older hosts are unverified.

## Links

- [Repository and full README](https://github.com/alienmind/m4l-jweb)
- [Architecture](https://github.com/alienmind/m4l-jweb/blob/main/doc/ARCHITECTURE.md)
- [What Max actually does: the measured facts](https://github.com/alienmind/m4l-jweb/blob/main/doc/MAX-FACTS.md)

## License

MIT
