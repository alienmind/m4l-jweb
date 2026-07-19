> **Introduction:** This document describes the in-Live spikes (S2, S3) that prove the
> SUPERDOUGH Rendering pipe - writing a rendered WAV to disk and looping it, crossfading
> between two slots at loop boundaries. Everything up to Live is already checked (build,
> tests, tsc); the disk hop and the loop playback are the parts only Live can confirm.

# The renderplay spikes

*The `renderplay` chain plays a rendered WAV pair from disk, self-clocked off the groove's
own loop, crossfading between the two at loop boundaries. The `saveToFile` pipe puts the WAV
there. Neither can be proven without Live: a filesystem and real audio output are what CI
does not
have.*

What IS already proven, and needs no Live:

- `tsc` and 227 unit tests pass (`pnpm test`).
- `hello-render.json` generates: the chain wires without duplicate box ids, and the two
  `[groove~ ---buf-hello-render-rndA/B]` reach `[plugout~]` through the crossfade.
- The WAV encoder and the byte path are covered upstream (m4l-strudel `wav.test.ts`, and
  this repo's `extractPayload` discipline that `saveToFile` reuses).

The device is **hello-render** (`patcher/devices.mjs`): an instrument, chains
`["renderplay", "download"]`, `renderSlots: ["rndA", "rndB"]`.

## Setup

```bash
pnpm build            # tsc + UI bundles + .amxd
pnpm install:device   # copy into the User Library
```

New Live Set, a **MIDI track** (hello-render is an instrument). Drag `hello-render` onto
it. Open the Max Console (View -> Max Console) - the wrapper posts the byte counts and
paths there.

## S2 - saveToFile: bytes to disk

1. Click **Generate + save + load** under Slot A.
2. The status line should read `Saved <N> bytes to render/rndA.wav`, and the Max Console
   should print `m4l-jweb: saved <N> bytes to <...>/render/rndA.wav`.
3. **Confirm on disk.** Find the device's folder (next to the `.amxd` in the User
   Library, or wherever Live unpacked it) and check `render/rndA.wav` exists and is that
   many bytes. Open it in any audio editor: it is a 2 s, 440 Hz sine, stereo, 16-bit.

**Passes if** the file is there, the byte count matches, and it is a playable WAV.
**Fails if** the status shows `Save failed` / `size mismatch`, or the file is absent
(the `.part` step never placed) - that is a `saveToFile` bug, not a renderplay one.

## S3 - renderplay: the loop and the swap

Confirmed working in Live 2026-07-19. Note the loop is **self-clocked**, not transport-
locked (see the design note below) - so it plays with the transport stopped.

1. Do S2 for **both** slots (Generate A at 440 Hz, Generate B at 660 Hz). Each status
   should end `... loaded and looping-ready`.
2. **You should already hear the 440 Hz loop** - slot A fades up on load, no transport
   needed.
3. **Arm B.** At the next loop boundary the sound crossfades (~400 ms) to 660 Hz - the
   switch lands ON the loop boundary, not the instant you click.
4. **Stop (fade out)** ramps to silence over ~500 ms and STAYS silent - a later boundary
   does not re-raise it. Re-arm a slot to resume.
5. **Two instances.** Put hello-render on a second track, generate there too. The buffers
   are instance-scoped (`---buf-...`), so the two must not steal each other's audio.

**Passes if** the loop plays, the arm-swap lands on the loop boundary, stop holds, and two
instances are independent.

## How the loop is clocked (and what is deferred)

The design (m4l-strudel `doc/IDEA-STRUDEL-INSTRUMENT.md`, D.3) named the transport lock as
the one genuinely unverified Max claim, and the spike KILLED the first two ideas:

- `[phasor~ @lock]` - never tried; the fallback below was reached first.
- **Host transport beats** (`[plugsync~]` outlet 6) - measured **stuck at 0** in Live while
  the transport played. Timing the loop off it left the device silent. Abandoned.

What ships instead: the loop is **self-clocked off `[groove~]`'s own sync outlet** (its
last outlet is a 0..1 loop-position ramp). `[<~ 0.5]` -> `[edge~]` turns the wrap into a
per-loop boundary bang. It needs no transport - the groove is the clock. Control flow:

- Grooves start when their WAV loads (buffer read-complete bang) and free-run via `@loop 1`.
- An arm only STORES the target slot index; a `[gate 1 1]` "pending" gate lets the boundary
  apply the gains once (open on load so slot 0 fades up, passes one bang then closes, an arm
  reopens it, a stop closes it). This is why: the swap quantizes to the boundary, held
  selections are not re-ramped every loop (that was an audible tick), and stop stays stopped.
- Crossfade 400 ms, stop fade 500 ms (`[line~]`, linear).

**Deferred (S3 open items):**

- **Transport-BAR alignment.** The loop is pinned to the groove's own period, not Live's
  bar. Revisit once a host beat source that actually advances is found (`[plugsync~]`
  outlet 6 is not it here).
- **Loop-wrap tick.** A faint click at the loop seam from `[groove~]`'s loop-point
  interpolation. Worst on a pure sine, ~inaudible on real rendered content. If it ever
  matters on real material: drive playback from `[phasor~]` into `[play~]`/`[wave~]`, or
  bake a few-ms equal-power loop crossfade into the render.
