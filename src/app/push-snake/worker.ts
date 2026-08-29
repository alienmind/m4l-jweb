/**
 * worker.ts (push-snake) - the game, off the UI thread.
 *
 * IT IS IN A WORKER FOR ONE REASON, and it is not performance. The device view is
 * usually NOT VISIBLE - a Push user is looking at the Push - and Chromium throttles
 * timers on a hidden page, so a game clocked off the main thread would stutter or
 * stop exactly when it matters. Dedicated workers are exempt.
 *
 * It owns the state and the clock and emits a whole 64-cell frame per tick; the page
 * is a shell that moves frames out, events in, and makes the noise.
 *
 * ------------------------------------------------------------------------------
 * THE BORDER IS THE HUD, and that is why the arena is only 6x6.
 *
 * A Push user cannot see the device view - it is on a laptop behind them - so every
 * number the game has must be ON THE GRID. The border ring was already spent being a
 * visible wall; making it carry the score and the lives costs nothing more:
 *
 *   left column, top row, right column   the LENGTH GAUGE - 7 + 6 + 7 = 20 cells, one
 *                                        green per segment, filled from the bottom-left
 *                                        UP, then left-to-right along the top, then
 *                                        DOWN the right side. Full is the win.
 *   bottom row, left                     the two turn pads.
 *   bottom row, right                    three LIVES, green until spent, then red,
 *                                        rightmost first.
 *
 * So the whole state of a run is readable from across the room, which is the only test
 * this device was ever built to pass.
 * ------------------------------------------------------------------------------
 */

type Cell = [number, number];

/** The arena is the inner 6x6; the border ring is wall, and the wall is the HUD. */
const MIN = 1;
const MAX = 6;
const inArena = (c: Cell) => c[0] >= MIN && c[0] <= MAX && c[1] >= MIN && c[1] <= MAX;

/**
 * The length gauge, IN FILL ORDER: up the left column, across the top, down the right.
 *
 * Twenty cells - 7 + 6 + 7 - and reaching the end of it is the win. The bottom row is
 * deliberately not in it: that row belongs to the controls and the lives, and a gauge
 * running through the turn pads would light them for a reason that has nothing to do
 * with what they do.
 */
const GAUGE: Cell[] = [];
for (let y = 1; y <= 7; y++) GAUGE.push([0, y]);
for (let x = 1; x <= 6; x++) GAUGE.push([x, 7]);
for (let y = 7; y >= 1; y--) GAUGE.push([7, y]);

/** Fill the gauge and you have won. */
const WIN_LENGTH = GAUGE.length; // 20

/** The three lives, IN THE ORDER THEY ARE LOST: bottom-right first, then leftwards. */
const LIFE_CELLS: Cell[] = [
  [7, 0],
  [6, 0],
  [5, 0],
];
const LIVES = LIFE_CELLS.length;

/**
 * The three reserved pads, in the wall, bottom-left: left, centre, right.
 *
 * Symmetrical on purpose - a turn either side of a boost reads as a control layout rather
 * than two buttons that happen to be next to each other, and your thumb finds the middle
 * one without looking.
 */
const TURN_CCW: Cell = [0, 0];
const BOOST: Cell = [1, 0];
const TURN_CW: Cell = [2, 0];

/**
 * How much faster the snake runs while the centre pad is held.
 *
 * Held, not toggled: it is a sprint you commit to and let go of, so the risk is real -
 * two and a half times the current rate leaves very little time to see a wall coming.
 */
const BOOST_FACTOR = 2.5;

/**
 * The face, in ARENA-LOCAL coordinates (0..5, mapping to the inner 6x6).
 *
 * A smile has its ends UP and its middle DOWN; a frown is the same mouth mirrored.
 * Six by six is barely enough for a face and exactly enough for this one - two eyes,
 * and a mouth of four cells with a corner at each end.
 */
const FACE_EYES: Cell[] = [
  [1, 4],
  [4, 4],
];
const HAPPY_MOUTH: Cell[] = [
  [0, 2],
  [5, 2],
  [1, 1],
  [2, 1],
  [3, 1],
  [4, 1],
];
const SAD_MOUTH: Cell[] = [
  [0, 1],
  [5, 1],
  [1, 2],
  [2, 2],
  [3, 2],
  [4, 2],
];

/**
 * The attract banner: SNAKE, scrolling right to left while nothing is being played.
 *
 * A 4x5 font, because 3 columns cannot draw an N. Three-wide letters have no room for a
 * diagonal, so N comes out as H and the word is unreadable at the one size that matters.
 * Four columns and a blank between letters is 5 columns each, 24 for the word.
 *
 * Rows are written TOP DOWN here, the way you read them. `paint` flips to the grid's
 * bottom-up y in the one place it draws them.
 */
const FONT: { [ch: string]: string[] } = {
  S: [".###", "#...", ".##.", "...#", "###."],
  N: ["#..#", "##.#", "#.##", "#..#", "#..#"],
  A: [".##.", "#..#", "####", "#..#", "#..#"],
  K: ["#..#", "#.#.", "##..", "#.#.", "#..#"],
  E: ["####", "#...", "###.", "#...", "####"],
};

const BANNER_WORD = "SNAKE";
/** Five rows of letters, sitting above the bottom row so the HUD keeps it. */
const BANNER_TOP_Y = 6;
const BANNER_ROWS = 5;
/** Yellow, so it is not the green the turn pads use to mean START. */
const BANNER_COLOUR = "yellow";
/** One column per step. Slow enough to read a moving word, fast enough not to look stuck. */
const BANNER_MS = 130;

/**
 * The word as a column bitmap: `BANNER_COLUMNS[i][row]` is lit or not.
 *
 * Built once, at module load, because it never changes - and building it here rather
 * than in `paint` keeps the frame path free of string work.
 */
const BANNER_COLUMNS: boolean[][] = (() => {
  const cols: boolean[][] = [];
  for (const ch of BANNER_WORD) {
    const glyph = FONT[ch];
    for (let c = 0; c < glyph[0]!.length; c++) {
      cols.push(glyph.map((row) => row[c] === "#"));
    }
    cols.push(new Array(BANNER_ROWS).fill(false)); // the gap between letters
  }
  return cols;
})();

/** How long one blink half-cycle lasts, and how many halves a result blinks for. */
const BLINK_MS = 300;
const BLINK_HALVES = 6; // three dark flashes, ending LIT - see startBlink

/** Colour NAMES from @m4l-jweb/surface's provisional Push palette - never an index. */
const FRUIT_COLOURS = ["red", "yellow", "sky", "purple"];
/** The unlit border. No grey is named in the palette, and `tan` is what reads as one. */
const WALL = "tan";

/** Clockwise from up. A turn steps one place around this ring, either way. */
const DIRS: Cell[] = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
];

/**
 * `idle` is before a run and after a deliberate stop; `play` is a run; `result` is a
 * finished one, holding its face until somebody starts another.
 */
type Phase = "idle" | "play" | "result";

let phase: Phase = "idle";
let won = false;
let lives = LIVES;
let snake: Cell[] = [];
let dir = 0;
let fruit: Cell = [0, 0];
let fruitColour = FRUIT_COLOURS[0];
let baseHz = 4;
let timer: ReturnType<typeof setInterval> | null = null;
/** True while the centre pad is held. Reset by anything that ends a run. */
let boosting = false;
let blinkOn = true;
let blinkHalves = 0;
let blinkTimer: ReturnType<typeof setInterval> | null = null;
/** Where the banner has scrolled to, and the timer moving it. */
let bannerAt = 0;
let bannerTimer: ReturnType<typeof setInterval> | null = null;

const same = (a: Cell, b: Cell) => a[0] === b[0] && a[1] === b[1];
const free = (c: Cell) => !snake.some((s) => same(s, c));

function placeFruit(): void {
  const open: Cell[] = [];
  for (let x = MIN; x <= MAX; x++) for (let y = MIN; y <= MAX; y++) if (free([x, y])) open.push([x, y]);
  if (!open.length) return; // arena full: the last segment already won it
  fruit = open[Math.floor(Math.random() * open.length)]!;
  fruitColour = FRUIT_COLOURS[Math.floor(Math.random() * FRUIT_COLOURS.length)]!;
}

/**
 * Scroll the banner while the device is idle.
 *
 * It starts off the right edge and runs until the word has left on the left, then wraps.
 * Only the cells that change reach the hardware, so eight frames a second of a moving
 * word costs a few `send_value` calls rather than sixty-four.
 */
function startBanner(): void {
  stopBanner();
  bannerAt = -8;
  paint();
  bannerTimer = setInterval(() => {
    bannerAt++;
    if (bannerAt > BANNER_COLUMNS.length) bannerAt = -8;
    paint();
  }, BANNER_MS);
}

function stopBanner(): void {
  if (bannerTimer) clearInterval(bannerTimer);
  bannerTimer = null;
}

/** A whole new game: three lives, a short snake, the clock running. */
function reset(): void {
  stopBanner();
  stopBlink();
  phase = "play";
  won = false;
  lives = LIVES;
  // A pad held when the last run ended must not carry into this one.
  boosting = false;
  respawn();
}

/** A new snake on the same run - what a crash costs, when there is a life left to pay. */
function respawn(): void {
  snake = [
    [3, 3],
    [3, 2],
  ];
  dir = 0;
  placeFruit();
  reschedule();
  paint();
}

/**
 * Speed rises with LENGTH, by ten percent of the base per segment.
 *
 * Linear, not compounding: 1.1^18 is nearly six times the starting rate by the
 * twentieth segment, which is not a difficulty curve but a wall. Linear reaches 2.8x,
 * fast enough that the last few segments are the hard ones.
 */
function reschedule(): void {
  if (timer) clearInterval(timer);
  const hz = baseHz * (1 + (snake.length - 2) * 0.1) * (boosting ? BOOST_FACTOR : 1);
  timer = setInterval(step, 1000 / hz);
}

function step(): void {
  if (phase !== "play") return;
  const [hx, hy] = snake[0]!;
  const [dx, dy] = DIRS[dir]!;
  const head: Cell = [hx + dx, hy + dy];

  // The wall is the border ring, and there is no wrap.
  if (!inArena(head) || !free(head)) return crash();

  snake.unshift(head);
  if (same(head, fruit)) {
    // THE GAUGE IS THE SNAKE'S LENGTH, so the win condition and the picture are one
    // fact - there is no separate score that can disagree with what is lit.
    if (snake.length >= WIN_LENGTH) return finish(true);
    placeFruit();
    reschedule();
    self.postMessage(["ate", snake.length]);
  } else {
    snake.pop();
    self.postMessage(["moved", snake.length]);
  }
  paint();
}

/** One life, spent. The run continues on a fresh snake until there are none left. */
function crash(): void {
  lives--;
  if (lives <= 0) {
    lives = 0;
    return finish(false);
  }
  self.postMessage(["hurt", lives]);
  respawn();
}

function finish(win: boolean): void {
  if (timer) clearInterval(timer);
  timer = null;
  boosting = false;
  stopBanner();
  phase = "result";
  won = win;
  startBlink();
  self.postMessage(["over", win ? 1 : 0, snake.length]);
}

/**
 * Three blinks, ENDING LIT.
 *
 * Six half-cycles from a lit start gives dark-lit-dark-lit-dark-lit: three dark
 * flashes. The last toggle is forced back on rather than counted, so the face cannot
 * come to rest invisible on an off-by-one. It then stays until somebody starts another
 * game - a result nobody was in the room for is a result they never saw.
 */
function startBlink(): void {
  stopBlink();
  blinkOn = true;
  blinkHalves = BLINK_HALVES;
  paint();
  blinkTimer = setInterval(() => {
    blinkOn = !blinkOn;
    blinkHalves--;
    if (blinkHalves <= 0) {
      blinkOn = true;
      stopBlink();
    }
    paint();
  }, BLINK_MS);
}

function stopBlink(): void {
  if (blinkTimer) clearInterval(blinkTimer);
  blinkTimer = null;
}

/**
 * One frame out per tick: a flat 64-cell array of colour NAMES, row-major from the
 * BOTTOM-left - the API's orientation, not the hardware's. The page hands it straight
 * to `pads.draw()`, which works out which cells actually changed and flips y once.
 */
function paint(): void {
  const f: string[] = new Array(64).fill(WALL); // the border ring, everywhere
  const at = (c: Cell) => c[1] * 8 + c[0];
  for (let x = MIN; x <= MAX; x++) for (let y = MIN; y <= MAX; y++) f[at([x, y])] = "black";

  // THE LENGTH GAUGE. One green per segment, in fill order. Capped at the win: a snake
  // cannot outgrow the gauge, but a cap is cheaper than trusting that it cannot.
  const filled = Math.min(snake.length, WIN_LENGTH);
  for (let i = 0; i < filled; i++) f[at(GAUGE[i]!)] = "green";

  // THE LIVES, bottom-right, spent rightmost-first. `LIFE_CELLS[i]` is red once i lives
  // are gone, which is what leaves the leftmost of the three standing longest.
  const lost = LIVES - lives;
  for (let i = 0; i < LIVES; i++) f[at(LIFE_CELLS[i]!)] = i < lost ? "red" : "green";

  // THE THREE PADS say what they do right now: all green and all meaning START whenever
  // there is no run; two directions and a boost while there is one. The boost pad goes
  // WHITE while it is held, so the sprint is visible on the hardware and not only felt.
  f[at(TURN_CCW)] = phase === "play" ? "ocean" : "green";
  f[at(BOOST)] = phase === "play" ? (boosting ? "white" : "amber") : "green";
  f[at(TURN_CW)] = phase === "play" ? "sky" : "green";

  if (phase === "play") {
    f[at(fruit)] = fruitColour;
    snake.forEach((c, i) => {
      f[at(c)] = i === 0 ? "white" : "green";
    });
  } else if (phase === "idle") {
    // THE ATTRACT BANNER. It uses the full width, including the gauge columns - they are
    // empty while idle, and a word that stopped at column 6 would be unreadable.
    for (let x = 0; x < 8; x++) {
      const col = BANNER_COLUMNS[bannerAt + x];
      if (!col) continue;
      for (let r = 0; r < BANNER_ROWS; r++) {
        if (col[r]) f[at([x, BANNER_TOP_Y - r])] = BANNER_COLOUR;
      }
    }
  } else if (phase === "result" && blinkOn) {
    // The face sits in the inner 6x6, so the HUD around it stays readable while it
    // blinks: the full gauge on a win, the three red hearts on a loss.
    const colour = won ? "green" : "red";
    const face = FACE_EYES.concat(won ? HAPPY_MOUTH : SAD_MOUTH);
    for (const [lx, ly] of face) f[at([MIN + lx, MIN + ly])] = colour;
  }

  self.postMessage(["frame", f]);
}

/**
 * Start scrolling at load, before anything has been played.
 *
 * This paints the first frame as well as beginning the banner, which matters: without a
 * frame at load, a device just dropped on a track shows sixty-four dark pads - on the Push
 * AND in the device view - and the two turn pads, the only clue about how to play, are
 * invisible until you already know. The board is drawn from the start. Only the snake
 * waits for `running`.
 */
startBanner();

self.onmessage = (e: MessageEvent) => {
  const [type, arg] = e.data as [string, number];
  if (type === "start") reset();
  else if (type === "stop") {
    // A FINISHED GAME IGNORES `stop`. The page turns the `running` parameter off the
    // moment a run ends, which arrives here as a stop - and clearing the board on it
    // would wipe the face in the same message turn it was drawn in.
    if (phase === "result") return;
    phase = "idle";
    if (timer) clearInterval(timer);
    timer = null;
    boosting = false;
    snake = [];
    lives = LIVES;
    // Back to the attract loop, so a stopped device is never a dark grid.
    startBanner();
  }
  // arg is +1 clockwise, -1 anticlockwise. Only a running game turns.
  else if (type === "turn") {
    if (phase === "play") dir = (dir + arg + 4) % 4;
  } else if (type === "boost") {
    // Rescheduled immediately, both ways: waiting for the next tick to speed up would
    // make the pad feel late, and waiting to slow down would spend a segment at a rate
    // nobody asked for any more.
    const next = arg === 1;
    if (next === boosting) return;
    boosting = next;
    if (phase === "play") {
      reschedule();
      paint();
    }
  } else if (type === "speed") {
    baseHz = arg;
    if (phase === "play") reschedule();
  }
};
