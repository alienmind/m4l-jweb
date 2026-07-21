# @m4l-jweb/surface

Declare a device's Live parameters once, as code, and get the real thing: native `live.dial` / `live.text` objects in the patcher, automatable lanes, MIDI mapping, and Push. Plus React hooks to read and write them, and a mocked-Live harness so the UI runs in an ordinary browser.

Part of **[m4l-jweb](https://github.com/alienmind/m4l-jweb)** - build Ableton Live devices (`.amxd`) from a TypeScript repo: React UI, LiveAPI glue, CI builds, no Max editor.

## Install

```bash
pnpm add @m4l-jweb/surface
```

## Usage

```ts
// surface.ts - the declaration
import { defineSurface } from "@m4l-jweb/surface";

export default defineSurface({
  params: {
    cutoff: { type: "float", min: 20, max: 18000, unit: "Hz", default: 18000, exponent: 3 },
    play:   { type: "bool", default: 0 },
  },
});

// App.tsx - the same parameter, from React
import { useParam, useStateSync } from "@m4l-jweb/surface/react";

const [cutoff, setCutoff] = useParam(surface, "cutoff");   // a real Live parameter
const [notes, setNotes]   = useStateSync(surface, "notes"); // arbitrary JSON, saved in the Set
```

## Notes

- A parameter declared here is generated into the patcher AND into the wrapper - one declaration, both sides, so they cannot disagree.
- `useStateSync()` persists arbitrary JSON into the Ableton Live Set itself, per device instance, restored on load.
- `@m4l-jweb/surface/dev` renders the device against a mocked Live, so the UI is developed with hot reload in a browser rather than by reopening Live.

## Requirements

Ableton Live 12 with Max 9. Devices are built on `[jweb~]`, the browser view with signal outlets; older hosts are unverified.

## Links

- [Repository and full README](https://github.com/alienmind/m4l-jweb)
- [Architecture](https://github.com/alienmind/m4l-jweb/blob/main/doc/ARCHITECTURE.md)
- [What Max actually does: the measured facts](https://github.com/alienmind/m4l-jweb/blob/main/doc/MAX-FACTS.md)

## License

MIT
