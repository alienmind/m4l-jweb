# Example: one-knob MIDI transposer

The smallest device that is still a real device. It reads incoming MIDI, shifts
every note by a number of semitones, and sends it back out. The shift amount is
a **live.dial**, so it is automatable, MIDI-mappable, and visible on Push.

It exists to show the whole loop in about fifty lines: a parameter arrives from
Live as a Max message, the web app reacts, the app emits notes, and the
generated patcher carries them to `midiout`.

## Wire it up

Copy the two files over the scaffold's app and point the manifest at them:

```bash
cp examples/transposer/App.tsx      src/app/App.tsx
cp examples/transposer/protocol.ts  src/app/protocol.ts
```

Then in `patcher/devices.mjs`:

```js
export default [
	{
		name: "transposer",
		type: "midi",
		chains: ["midiin", "midiout"],
		parameters: [{ id: "semitones", object: "live.dial", range: [-24, 24] }],
		unmatchedTo: "js",
	},
];
```

```bash
pnpm build                     # -> dist/m4l-jweb/transposer.amxd
scripts/install-windows.ps1    # or install-mac.sh / install-linux.sh
```

Drop it on a MIDI track **before** an instrument, play, and turn the knob.

## What to notice

- **The app never touches MIDI hardware.** It emits
  `midinote <pitch> <vel> <durMs> <chan> <delayMs>` and the `midiout` chain in
  the generated patcher does the rest. You compute *what* and *when*; Max
  places the note precisely.
- **The parameter is not UI.** `semitones` is a real Live parameter. The dial
  reaches the app as an ordinary inlet message (`semitones 7`), exactly like any
  other Max message - there is no special parameter API to learn.
- **`ui_ready` is not optional.** The page loads asynchronously; without the
  handshake the app would miss the state the wrapper already sent.
