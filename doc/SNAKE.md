# Snake for Push

Snake, on the 64 pads of an Ableton Push. It is a Max for Live device, so it runs inside
Live on a MIDI track, and it plays on the hardware - you do not have to look at the
screen.

Music by **AlienMind**:
[Next Wave / Nextpoint OST](https://soundcloud.com/alienmindzzz/next-wave-nextpoint-ost).

> **What this file is.** It ships inside `push-snake-<version>.zip` as the README - what somebody
> reads *before* they have installed the game, or after, on GitHub. It is also the one
> written description of the game: the design notes that used to be in
> [PUSH-USECASES.md](PUSH-USECASES.md) were merged into it, because a game described in
> two places is a game described differently in two places.
>
> **It is not the in-app help.** That is the `?` button in the device, and it is a
> different thing on purpose: a summary of how to PLAY, drawn as diagrams, that has to
> fit in a device view about 169 px tall. It says nothing about installing, because by
> then you have. `src/app/push-snake/Help.tsx`.
>
> If you are here for how the pad API works, that is
> [ARCHITECTURE.md](ARCHITECTURE.md), "The pads: a control surface you program". For what
> the API could carry next, [PUSH-USECASES.md](PUSH-USECASES.md).

## Install

Drag `push-snake.amxd` onto a **MIDI track** in Live. That is all - the device carries
everything it needs, including the soundtrack.

To keep it, drop it in your User Library under `Max For Live`.

Needs Live 11 or newer with Max for Live, and a Push for the pads. It also plays without
one: the device view has the same grid, and you can click it or use the arrow keys.

## Play

Turn **Takeovr** on and the pads are yours. Until you start a game the pads scroll the
word SNAKE, and the main tune plays once as a welcome.

```
 y
 7  G G G G G G G G      G  length gauge - 20 cells. Fill it to win.
 6  G . . . . . . G
 5  G . . . . . . G      .  the arena, 6x6
 4  G . . . o . . G      o  fruit
 3  G . . @ * . . G      @  head    * body
 2  G . . * * . . G
 1  G . . . . . . G
 0  < ^ > # # V V V      <  turn left    ^  hold to sprint    > turn right
     x=0 1 2 3 4 5 6 7   V  three lives, spent right to left
```

- **Any of the three bottom-left pads starts a game.** They are all green while stopped.
- Left and right **turn** the snake. They rotate it; they are not compass directions.
- The middle pad **sprints** while you hold it, and only while you hold it. It goes white
  so you can see it working.
- Eat fruit to grow. Every segment makes the snake 10% faster.
- The border is a **wall** and it kills.
- A crash costs a **life**, not the run. You get three. The snake restarts at two
  segments and the gauge empties with it, which is what makes twenty hard.
- Fill all twenty gauge cells and a green smiley blinks three times and stays. Lose all
  three lives and it is a red frown. Either one holds until you press a pad for the next
  game.

Without a Push: click the pads in the device view, or use the arrow keys and hold **Up**
to sprint. The **?** button in the device has all of this too.

## The border is the scoreboard

There is a reason the arena is only 6x6. You cannot see the device view while you are
looking at the Push, so every number the game has is on the grid:

| Where | What |
|---|---|
| left column, top row, right column | the length gauge - 20 cells, filled from the bottom-left upwards, then along the top, then down the right |
| bottom right, three pads | lives, green until spent, then red, rightmost first |
| bottom left, three pads | the controls |

A lit border is worth the six cells it costs. On a grid with no visible edge, "I hit a
wall" and "the device stopped responding" look the same.

## The music

Four mixes of one loop, sparsest to densest. The game moves up one level every three
segments and stays on the densest after that. A crash puts the snake back to two
segments, so the music drops back with it - it is a readout of how fast the game is right
now.

All four are the same length to the sample and play in sync, so a level change only
crossfades their volumes. **A change waits for the next bar**: a fruit is eaten mid-bar,
and swapping the arrangement there sounds like a mistake rather than a cue.

The main tune plays as a welcome when the device loads, and again when you win.

## Controls in Live

| | |
|---|---|
| **Run** | start and stop, automatable like any parameter |
| **Diff** | Easy, Normal or Hard - the starting speed |
| **Volume** | the game sounds |
| **Music** | the soundtrack |
| **Sound** | mute both |
| **Takeovr** | whether the device holds the pads. Off by default |
| **Focus** | when it holds them: on this Device, this Track, or Always |

Two copies in one set take turns rather than fighting. If the pads stay dark, the line
under the grid in the device view says why - the Push may not be connected, or the other
copy may have the grid.

## Built with

[m4l-jweb](https://github.com/alienmind/m4l-jweb) - build Max for Live devices from
TypeScript. The game is about 300 lines: a worker holding the rules and the clock, and a
page that moves frames out and presses in.

| | |
|---|---|
| the rules and the clock | [`src/app/push-snake/worker.ts`](../src/app/push-snake/worker.ts) |
| frames out, presses in, the sound | [`src/app/push-snake/App.tsx`](../src/app/push-snake/App.tsx) |
| what it claims on the hardware | [`src/app/push-snake/controls.ts`](../src/app/push-snake/controls.ts) |
| its Live parameters | [`src/app/push-snake/surface.ts`](../src/app/push-snake/surface.ts) |
| the soundtrack | [`src/app/push-snake/music.ts`](../src/app/push-snake/music.ts) |

The clock is in a Worker rather than on the page, because the device view is usually not
visible - you are looking at the Push - and Chromium throttles timers on a hidden page.
