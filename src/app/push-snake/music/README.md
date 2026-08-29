# push-snake music - four mixes of ONE track

These four files are **placeholders (0 bytes)**. The device still loads, plays and wins
without them. A layer that does not decode is silent, and the console says which one.
Drop your files over these and rebuild.

## What each file is

| File | Arrangement | Heard while the snake is |
|---|---|---|
| `level-1.ogg` | sparsest - fewest instruments | 2-3 segments |
| `level-2.ogg` | more instruments | 4-5 |
| `level-3.ogg` | more again | 6-7 |
| `level-4.ogg` | **the full track** | 8 or longer |

The game moves up one level every **two** segments. It stays on `level-4` after that. A
crash puts the snake back to two segments, so the music drops back too. The music shows
how fast the game is right now.

**These are cumulative mixes, not stems.** Each file is the whole track at that density.
Level 3 already has everything level 2 has. So one file plays at a time, and the device
crossfades between them. Additive stems (drums alone, bass alone) would need to be
summed instead. That is a different four lines in `../music.ts`.

## The one hard requirement

**All four must be the same length, tempo and sample rate.** Splits of one render give
you this for free. It matters because all four are decoded and started **at the same
moment**, and they play in sync. Changing level crossfades their gains. Nothing
restarts. That is what makes every transition sample-accurate.

Loops of different lengths drift apart. The device writes a console warning if it sees
that.

## Format

| | |
|---|---|
| container | **OGG Vorbis** (`.ogg`) - or Opus, same workflow |
| channels | stereo |
| sample rate | 44100 Hz |
| bitrate | 128-160 kbps is plenty for a game loop |
| length | 60-90 s, and **the same for all four** |
| size | keep each **under ~1.5 MB** - see below |

**Ogg because it loops with no gap.** MP3 adds encoder delay at the start and padding at
the end. `decodeAudioData` turns both into silence, so an MP3 loop has a short gap every
time it wraps. Nothing else about the format matters. The decode call is the same either
way.

**Make the loop seamless in the render, not in the device.** The device loops the buffer
end to start with no crossfade. Whatever tail you leave is what you hear against the
head. Trim to an exact bar.

## Why size matters

The tracks are inlined into the device's bundle as `data:` URIs. They travel inside the
`.amxd`, and the page never touches the filesystem. That is on purpose: a `file://` page
cannot `fetch` a file next to it, so a path-based build would work on the dev server and
be silent in Live.

The cost is that base64 is 4 bytes for every 3, and **Live puts a copy of the device in
every set that uses it**. Four 1.5 MB tracks is 6 MB of audio, about 8 MB of base64, and
an `.amxd` around 9 MB. That works. Four 5 MB tracks does not.
