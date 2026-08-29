# Snake for Push

Snake, on the 64 pads of an Ableton Push. It is a Max for Live device, so it runs inside
Live on a MIDI track, and it plays on the hardware - you do not have to look at the
screen.

Music by **AlienMind**:
[Next Wave / Nextpoint OST](https://soundcloud.com/alienmindzzz/next-wave-nextpoint-ost).

## Install

Drag `push-snake.amxd` onto a **MIDI track** in Live. That is all - the device carries
everything it needs, including the soundtrack.

To keep it, drop it in your User Library under `Max For Live`.

Needs Live 11 or newer with Max for Live, and a Push for the pads. It also plays without
one: the device view has the same grid, and you can click it or use the arrow keys.

## Play

Turn **Takeovr** on and the pads are yours.

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

- **Any of the three bottom-left pads starts a game.**
- Left and right **turn** the snake. They rotate it; they are not compass directions.
- The middle pad **sprints** while you hold it, and only while you hold it. It goes white
  so you can see it working.
- Eat fruit to grow. Every segment makes the snake 10% faster.
- The border is a **wall** and it kills.
- A crash costs a **life**, not the run. You get three. The snake restarts at two
  segments and the gauge empties with it, which is what makes twenty hard.
- Fill all twenty gauge cells and a green smiley blinks. Lose all three lives and it is a
  red frown. Either one stays until you press a pad for the next game.

Without a Push: click the pads in the device view, or use the arrow keys and hold **Up**
to sprint. The **?** button in the device has all of this too.

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
under the grid in the device view says why.

## Built with

[m4l-jweb](https://github.com/alienmind/m4l-jweb) - build Max for Live devices from
TypeScript.
