# @m4l-jweb/bridge

The browser half of a device. Your React UI runs inside `[jweb~]`, Max's embedded Chromium; this is how it talks to the Max patcher around it - messages out, messages in, MIDI, clip I/O, and files.

Part of **[m4l-jweb](https://github.com/alienmind/m4l-jweb)** - build Ableton Live devices (`.amxd`) from a TypeScript repo: React UI, LiveAPI glue, CI builds, no Max editor.

## Install

```bash
pnpm add @m4l-jweb/bridge
```

## Usage

```ts
import { bindInlet, outlet, onNote, onNoteOff, sendNote, uiReady } from "@m4l-jweb/bridge";

// Tell the wrapper the page is up, and ask for current state.
uiReady();

// Incoming MIDI (needs the `midiin` chain). Both binders share one subscription.
onNote((pitch, velocity) => voiceOn(pitch, velocity));
onNoteOff((pitch) => voiceOff(pitch));

// Outgoing MIDI (needs the `midiout` chain). Max applies the delay, not the browser,
// so note timing does not depend on a Chromium timer.
sendNote({ pitch: 60, velocity: 100, durationMs: 250, delayMs: 80 });

// Anything else you route yourself.
bindInlet("tick", (playing, beats) => setTransport(Boolean(playing), Number(beats)));
outlet("my_selector", 1, "two");
```

## Notes

- **Audio does not go through here.** Under `[jweb~]` the page's Web Audio output is carried on the object's signal outlets, straight into the track. The bridge is a control plane; sound never crosses it as messages.
- `fetchToFile()` and `saveToFile()` move bytes between the page and disk via Max's `[maxurl]`, so large files never travel through the message bridge either.
- `tapMessages()` observes every message in both directions - the whole contract of a device, live.

## Requirements

Ableton Live 12 with Max 9. Devices are built on `[jweb~]`, the browser view with signal outlets; older hosts are unverified.

## Links

- [Repository and full README](https://github.com/alienmind/m4l-jweb)
- [Architecture](https://github.com/alienmind/m4l-jweb/blob/main/doc/ARCHITECTURE.md)
- [What Max actually does: the measured facts](https://github.com/alienmind/m4l-jweb/blob/main/doc/MAX-FACTS.md)

## License

MIT
