/**
 * push-snake.test.ts - the game's rules and its HUD, played with no hardware.
 *
 * The worker is the whole device: it owns the state, the clock, and the 64-cell frame
 * both surfaces are painted from. It is also a plain module that talks through
 * `self.postMessage` - so a fake `self` and fake timers play a complete game in
 * milliseconds, and every assertion below is about the PICTURE, which is the only
 * thing a person across the room can read.
 *
 * WHAT THIS CATCHES THAT A PUSH CANNOT. A gauge filling the wrong way round, a heart
 * spent from the wrong end, a face that comes to rest invisible - all of them look on
 * the hardware like a game that is simply behaving oddly, and none of them raises
 * anything anywhere.
 */
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { MUSIC_LEVELS, musicLevelFor } from "../src/app/push-snake/music";

/** Grid index for a bottom-up (x, y), which is the orientation the worker emits in. */
const at = (x: number, y: number) => y * 8 + x;

type Msg = [string, ...unknown[]];

let frames: string[][];
let msgs: Msg[];
let worker: { onmessage: (e: { data: Msg }) => void };

/** The last frame the worker emitted. */
const frame = () => frames[frames.length - 1]!;

async function load() {
  frames = [];
  msgs = [];
  const fake = {
    postMessage: (m: Msg) => {
      if (m[0] === "frame") frames.push(m[1] as string[]);
      else msgs.push(m);
    },
  } as unknown as { onmessage: (e: { data: Msg }) => void };
  (globalThis as { self?: unknown }).self = fake;
  // A fresh module per test: the worker holds the game state in module scope, which is
  // exactly right for a worker and useless for a shared test fixture.
  vi.resetModules();
  await import("../src/app/push-snake/worker");
  worker = fake;
}

const send = (...data: Msg) => worker.onmessage({ data });

beforeEach(async () => {
  vi.useFakeTimers();
  // Fruit lands on the first free cell every time, so a run is deterministic. It is
  // (1, 1), which a snake climbing from (3, 3) never reaches - these tests are about
  // the border, not about eating.
  vi.spyOn(Math, "random").mockReturnValue(0);
  await load();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** One life is four ticks: (3,3) climbs to (3,7), which is the wall. */
const TICKS_PER_LIFE = 4;
const advanceOneLife = () => vi.advanceTimersByTime((1000 / 4) * TICKS_PER_LIFE);

test("the board is drawn at LOAD, before anything is started", () => {
  // Otherwise a device just dropped on a track shows sixty-four dark pads, and the two
  // turn pads - the only clue about how to play - are invisible until you already know.
  expect(frames.length).toBe(1);
  const f = frame();
  expect(f[at(0, 0)]).toBe("green"); // both turn pads mean START
  expect(f[at(1, 0)]).toBe("green");
  expect(f[at(3, 0)]).toBe("tan"); // the rest of the bottom row is wall
  expect(f[at(3, 3)]).toBe("black"); // the arena is empty
});

test("the bottom-right three are LIVES, and the gauge is empty before a run", () => {
  const f = frame();
  expect([f[at(7, 0)], f[at(6, 0)], f[at(5, 0)]]).toEqual(["green", "green", "green"]);
  // The gauge is the other three edges, and nothing has been earned yet.
  expect(f[at(0, 1)]).toBe("tan");
  expect(f[at(3, 7)]).toBe("tan");
  expect(f[at(7, 4)]).toBe("tan");
});

test("the gauge fills from the BOTTOM-LEFT, upwards", () => {
  send("start");
  const f = frame();
  // A run starts at length 2, so exactly the first two gauge cells are lit - and they
  // are the two above the bottom-left corner, not the corner itself (that is a turn
  // pad) and not the top.
  expect(f[at(0, 1)]).toBe("green");
  expect(f[at(0, 2)]).toBe("green");
  expect(f[at(0, 3)]).toBe("tan");
  expect(f[at(0, 0)]).toBe("ocean"); // ...and the turn pads are two directions now
  expect(f[at(1, 0)]).toBe("sky");
});

test("a crash spends the RIGHTMOST heart first, and the run continues", () => {
  send("start");
  advanceOneLife();

  expect(msgs.map((m) => m[0])).toContain("hurt");
  const f = frame();
  expect(f[at(7, 0)]).toBe("red"); // spent
  expect(f[at(6, 0)]).toBe("green");
  expect(f[at(5, 0)]).toBe("green");
  // Still playing: a fresh snake, and the gauge back to two.
  expect(f[at(0, 0)]).toBe("ocean");
  expect(f[at(0, 2)]).toBe("green");
  expect(f[at(0, 3)]).toBe("tan");
});

test("three crashes end the game with a RED face that stops LIT", () => {
  send("start");
  advanceOneLife();
  advanceOneLife();
  advanceOneLife();

  const over = msgs.find((m) => m[0] === "over");
  expect(over).toBeDefined();
  expect(over![1]).toBe(0); // lost

  let f = frame();
  expect([f[at(7, 0)], f[at(6, 0)], f[at(5, 0)]]).toEqual(["red", "red", "red"]);
  // The eyes, in the inner 6x6. A frown puts its ends DOWN and its middle UP, which is
  // the one thing that distinguishes it from the win face at this size.
  expect(f[at(2, 5)]).toBe("red");
  expect(f[at(5, 5)]).toBe("red");
  expect(f[at(1, 2)]).toBe("red"); // mouth end, low
  expect(f[at(3, 3)]).toBe("red"); // mouth middle, high

  // ...and it BLINKS three times and comes to rest LIT. A face that stopped dark would
  // read as a device that crashed rather than a game that ended.
  vi.advanceTimersByTime(300);
  expect(frame()[at(2, 5)]).toBe("black");
  vi.advanceTimersByTime(300 * 6);
  f = frame();
  expect(f[at(2, 5)]).toBe("red");
  expect(f[at(3, 3)]).toBe("red");
});

test("a finished game IGNORES stop, so the page turning the transport off keeps the face", () => {
  send("start");
  advanceOneLife();
  advanceOneLife();
  advanceOneLife();
  const before = frame();

  // This is what the page does the moment a run ends - `running` is a real Live
  // parameter and it has to read false. Clearing the board on it would wipe the result
  // in the same message turn it was drawn in.
  send("stop");
  expect(frame()).toEqual(before);
});

test("...and starting again clears it: three hearts, an empty gauge, a live snake", () => {
  send("start");
  advanceOneLife();
  advanceOneLife();
  advanceOneLife();
  send("start");

  const f = frame();
  expect([f[at(7, 0)], f[at(6, 0)], f[at(5, 0)]]).toEqual(["green", "green", "green"]);
  expect(f[at(0, 2)]).toBe("green");
  expect(f[at(0, 3)]).toBe("tan");
  expect(f[at(3, 3)]).toBe("white"); // the head is back in the middle
});

test("a stopped game clears the board, and the turn pads go back to meaning START", () => {
  send("start");
  send("stop");
  const f = frame();
  expect(f[at(0, 0)]).toBe("green");
  expect(f[at(1, 0)]).toBe("green");
  expect(f[at(0, 1)]).toBe("tan"); // gauge empty
  expect(f[at(3, 3)]).toBe("black"); // arena empty
});

/* ------------------------------------------------------------------ *
 * The soundtrack's tension level
 * ------------------------------------------------------------------ */

test("the arrangement climbs one level per TWO segments, and stays on the full mix", () => {
  // One speed increase per segment eaten, one music step per two of those - and then
  // it holds, because there is no fifth mix and a game that ran out of music at
  // segment nine would go quiet for the eleven that matter most.
  expect(musicLevelFor(2)).toBe(0);
  expect(musicLevelFor(3)).toBe(0);
  expect(musicLevelFor(4)).toBe(1);
  expect(musicLevelFor(5)).toBe(1);
  expect(musicLevelFor(6)).toBe(2);
  expect(musicLevelFor(8)).toBe(MUSIC_LEVELS - 1);
  expect(musicLevelFor(20)).toBe(MUSIC_LEVELS - 1);
});

test("...and a crash drops it back down, because the game really is slow again", () => {
  // The music is a readout of the current speed, not a high-water mark. A respawn puts
  // the snake back to two segments, and the full mix under a two-segment snake reads as
  // a device that has lost track of what is happening.
  expect(musicLevelFor(2)).toBe(0);
});
