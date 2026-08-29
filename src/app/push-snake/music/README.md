# push-snake music

Five files: four loop layers that play during a run, and one full track for a win.

Converted from the WAV renders with ffmpeg, at Vorbis quality 4:

```
ffmpeg -i "<source>.wav" -c:a libvorbis -q:a 4 <name>.ogg
```

## The four layers

| File | Arrangement | Heard while the snake is | Size |
|---|---|---|---|
| `level-1.ogg` | sparsest | 2-3 segments | 150 KB |
| `level-2.ogg` | more instruments | 4-5 | 166 KB |
| `level-3.ogg` | more again | 6-7 | 167 KB |
| `level-4.ogg` | densest | 8 or longer | 159 KB |

All four are **18.823537 s, stereo, 22050 Hz** - the same length to the sample. That
matters, and it is the one thing to preserve if you re-render them. All four are decoded
and started at the same moment and play in sync. Changing level crossfades their gains;
nothing restarts. That is what makes every transition exact. Loops of different lengths
drift apart, and the device writes a console warning if it sees that.

The game moves up one level every **two** segments and stays on `level-4` after that. A
crash puts the snake back to two segments, so the music drops back too. The music shows
how fast the game is right now.

## The win track

| File | | Size |
|---|---|---|
| `win.ogg` | the full track, played once when the gauge fills | 1.4 MB |

**88.235 s, stereo, 48000 Hz.** It is not a fifth layer and cannot be one: it is a
different length and a different piece, not a denser mix of the same one. So it does not
share the layers' clock. It plays once, on its own bus, when you win. Starting a new game
fades it out.

A loss gets silence instead. A loop still running under a dead snake reads as a device
that has not noticed.

## If you re-render

- Keep the four layers **the same length as each other**. Everything else is negotiable.
- **Trim the layers to an exact bar.** The device loops the buffer end to start with no
  crossfade, so whatever tail you leave is heard against the head.
- Ogg because it loops with no gap. MP3 adds encoder delay at the start and padding at the
  end, and `decodeAudioData` turns both into silence, so an MP3 loop gaps at every wrap.
- Sample rate does not have to match between layers and win track. `decodeAudioData`
  resamples to the AudioContext rate.

## Why size matters

The tracks are inlined into the device's bundle as `data:` URIs, so they travel inside the
`.amxd` and the page never touches the filesystem. That is on purpose: a `file://` page
cannot `fetch` a file next to it, so a path-based build would work on the dev server and be
silent in Live.

Base64 is 4 bytes for every 3, and **Live puts a copy of the device in every set that uses
it**. These five files are 2.0 MB of audio, about 2.7 MB of base64, and a 4.2 MB `.amxd`.
That is fine. Keep an eye on it if the win track grows.
