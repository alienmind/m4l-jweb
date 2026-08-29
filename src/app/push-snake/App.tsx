/**
 * App.tsx (push-snake) - frames out, presses in, the sound, and the SAME GRID on
 * screen.
 *
 * The device that proves the pad surface works, and a device rather than a demo
 * because its bugs are visible from across the room. It exercises every part of the
 * API at once: a frame per tick, a press handler, a worker clock, parameters, a
 * state slot and Web Audio.
 *
 * The page is a SHELL. Everything stateful is in the worker, because the device view
 * is usually not visible and Chromium throttles a hidden page's timers.
 *
 * ------------------------------------------------------------------------------
 * THE ON-SCREEN GRID IS THE SAME FRAME, NOT A SECOND RENDERER.
 *
 * One array of colour names arrives from the worker and goes two places: to
 * `pads.draw()`, which paints the hardware, and to React state, which paints the
 * device view. Neither is authored separately, so the two cannot disagree about the
 * game - and if they disagree about the PICTURE, that is the y flip or the frame
 * diff being wrong, which is exactly the bug worth seeing.
 *
 * It is also the only way to play with no Push in the room: the device works with
 * `Takeovr` off, with no hardware connected, and on a laptop on a train.
 * ------------------------------------------------------------------------------
 */
import { useEffect, useRef, useState } from "react";
import { Frame } from "../shared/Frame";
import { useDevice } from "../shared/device";
import { PALETTE_CSS, type PadColour } from "@m4l-jweb/surface";
import { useParam, usePadGrid, usePadsHeld, usePadsReason, useStateSync } from "@m4l-jweb/surface/react";
import GameWorker from "./worker.ts?worker&inline";
import { createMusic, musicLevelFor, type MusicPlayer } from "./music";
import controls from "./controls";
import surface from "./surface";

/**
 * What each difficulty setting means, as the snake's base rate in moves per second.
 *
 * BASE, not the speed you feel: the game adds 10% of this per segment, so a 20-segment
 * snake moves at 2.8x whatever is here. Normal starts at four moves a second and ends
 * around eleven, which is fast and still readable. Hard ends around seventeen.
 */
const DIFFICULTY_HZ: Record<string, number> = { Easy: 2.5, Normal: 4, Hard: 6 };

/** The two reserved pads, IN the wall, bottom-left - so they cost no playable cell. */
const TURN_CCW = { x: 0, y: 0 };
const TURN_CW = { x: 1, y: 0 };

/**
 * The on-screen pad, in px.
 *
 * The device view is a FIXED ~169 px and clips silently, so this is a budget rather
 * than a taste: 8 rows at 12 px with 2 px gaps is 110 px, which leaves the header,
 * the padding and one line of text. A 14 px pad would clip the bottom row in Live and
 * look fine in a browser.
 */
const PAD = 12;
const GAP = 2;

const css = (name: string) => PALETTE_CSS[name as PadColour] ?? PALETTE_CSS.black;

export default function App() {
  const device = useDevice();
  const pads = usePadGrid(controls, "pads");
  const held = usePadsHeld(controls);
  const reason = usePadsReason(controls);
  const [running, setRunning] = useParam(surface, "running");
  const [difficulty] = useParam(surface, "difficulty");
  const [volume] = useParam(surface, "volume");
  const [musicVolume] = useParam(surface, "music");
  const [sound] = useParam(surface, "sound");
  const [focus] = useParam(surface, "focus");
  const [best, setBest] = useStateSync(surface, "best");
  const [length, setLength] = useState(0);
  const [lives, setLives] = useState(3);
  /** null while a run is in progress or has never happened; true/false is a finished one. */
  const [outcome, setOutcome] = useState<boolean | null>(null);
  /** The last frame, in the WORKER's orientation: index `y * 8 + x`, y bottom-up. */
  const [frame, setFrame] = useState<string[]>([]);

  const worker = useRef<Worker | null>(null);
  const audio = useRef<AudioContext | null>(null);
  const music = useRef<MusicPlayer | null>(null);

  /**
   * ONE AudioContext for the blips and the music.
   *
   * Not tidiness: the `webaudio` chain sums THIS context's output into the device's
   * signal path, so a second context would be a second sound source going to the OS
   * output device instead of the track - past the fader, past the meters, past
   * anything Live is recording.
   */
  const ensureAudio = () => (audio.current ??= new AudioContext());

  // `volume` and `best` are read inside the worker's message handler, which is bound
  // once. Refs keep that handler seeing the current values without rebinding it -
  // rebinding would drop the frames that arrive in the gap.
  const volumeRef = useRef(volume);
  volumeRef.current = volume;
  const soundRef = useRef(sound);
  soundRef.current = sound;
  const bestRef = useRef(best);
  bestRef.current = best;
  const padsRef = useRef(pads);
  padsRef.current = pads;

  /** What the music's master should sit at: its own dial, or silence. */
  const musicGain = () => (sound ? musicVolume : 0);

  /** One blip. The rest of the sound design: pitch says what happened. */
  const blip = (hz: number, ms: number, type: OscillatorType = "square") => {
    // Muted: make no oscillator at all rather than one at zero gain. Anything already
    // sounding decays on its own within 400 ms, which is shorter than the gesture.
    if (!soundRef.current) return;
    const ctx = ensureAudio();
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(hz, t);
    gain.gain.setValueAtTime(Math.max(0.0001, volumeRef.current * 0.25), t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + ms / 1000);
  };

  /** One turn, from wherever it was asked for: a Push pad, a screen pad, an arrow key. */
  const turn = (by: -1 | 1) => worker.current?.postMessage(["turn", by]);

  // `press` is bound once (see the pad effect below) and has to see the CURRENT
  // transport, so it reads a ref rather than closing over the value.
  const runningRef = useRef(running);
  runningRef.current = running;

  /**
   * A turn pad, from the hardware or from the screen.
   *
   * WHILE STOPPED IT STARTS, and that is the whole point: a Push user is looking at
   * the Push, and the `start` button lives in a device view on a laptop behind them.
   * The two pads are the only control this device has on the hardware, so they have to
   * be enough to play it - press one to begin, press them to steer, press one again
   * after a crash. It does not also turn: a fresh snake is pointed up by definition,
   * so a turn before the first tick would mean nothing and read as a lost press.
   */
  const press = (x: number, y: number) => {
    const ccw = x === TURN_CCW.x && y === TURN_CCW.y;
    const cw = x === TURN_CW.x && y === TURN_CW.y;
    if (!ccw && !cw) return;
    if (!runningRef.current) {
      // A press after a result is a NEW GAME: the face on the grid is the only thing
      // still showing, and clearing it here keeps the device view in step with it.
      setOutcome(null);
      setLives(3);
      setLength(2);
      return setRunning(true);
    }
    turn(ccw ? -1 : +1);
  };

  useEffect(() => {
    const w = new GameWorker();
    w.onmessage = (e: MessageEvent) => {
      const [type, arg] = e.data as [string, unknown];
      if (type === "frame") {
        // THE WHOLE GRID, EVERY TICK, to both surfaces. The diff is the library's
        // problem on the hardware side - an unchanged frame crosses the bridge not at
        // all - and React's on this one.
        const cells = arg as string[];
        padsRef.current.draw((f) => cells.forEach((c, i) => f.set(i % 8, Math.floor(i / 8), c)));
        setFrame(cells);
      } else if (type === "moved") {
        const n = arg as number;
        setLength(n);
        // The arrangement is a readout of how fast the game is, so it follows LENGTH -
        // including back down after a crash, when the game genuinely is slow again.
        music.current?.setLevel(musicLevelFor(n));
        blip(160, 25, "triangle");
      } else if (type === "ate") {
        const n = arg as number;
        setLength(n);
        music.current?.setLevel(musicLevelFor(n));
        blip(220 + n * 40, 90); // rises as the snake grows
        if (n > bestRef.current) setBest(n);
      } else if (type === "hurt") {
        // A life, not the game. Two short falling notes, so a crash is audible as
        // something survivable and the end of the run is not.
        setLives(arg as number);
        setLength(2);
        music.current?.setLevel(musicLevelFor(2));
        blip(140, 120, "sawtooth");
      } else if (type === "over") {
        const win = arg === 1;
        setOutcome(win);
        // The face holds on the grid; the music does not. A loop still running under a
        // finished game reads as a device that has not noticed.
        music.current?.stop();
        if (win) blip(880, 500, "triangle");
        else blip(70, 700, "sawtooth");
        // The transport follows the game, so `running` reads false in Live, in the
        // automation lane and on the encoder the moment the run ends.
        setRunning(false);
      }
    };
    worker.current = w;
    return () => w.terminate();
    // Bound once, on purpose - see the refs above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The `running` toggle IS the transport: it works from the device view, from an
  // encoder and from an automation lane, because it is a real Live parameter.
  useEffect(() => {
    worker.current?.postMessage([running ? "start" : "stop"]);
    if (!running) return void music.current?.stop();
    // Created on first use, so a device nobody has played decodes nothing and a
    // device whose tracks are still placeholders loads exactly as fast.
    const player = (music.current ??= createMusic(ensureAudio()));
    player.setVolume(musicGain());
    player.setLevel(musicLevelFor(2));
    // `start()` decodes four files on first run; the game does not wait for it.
    void player.start();
    // `musicVolume` and `sound` have their own effect below - reading them here would
    // restart the soundtrack every time the dial moved or the mute was pressed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  // The mute rides on the SAME master the music dial does, so pressing it ramps over
  // 50 ms rather than cutting - a hard gate on a running loop clicks.
  useEffect(() => music.current?.setVolume(musicGain()), [musicVolume, sound]);
  // The worker takes a RATE, and the parameter is a name - the mapping lives here, in
  // the one place that knows both. Keeping the worker numeric is what lets the game be
  // tested without a surface at all (tests/push-snake.test.ts).
  useEffect(() => {
    worker.current?.postMessage(["speed", DIFFICULTY_HZ[difficulty] ?? DIFFICULTY_HZ.Normal]);
  }, [difficulty]);

  // TWO pads, and only on the way down. Everything else on the grid is inert.
  useEffect(() => pads.onPad((e) => e.down && press(e.x, e.y)), [pads]);

  /**
   * Arrow keys, for playing with no Push.
   *
   * They mean the same thing the two pads do - ROTATE, not "go left" - because the
   * snake is steered relatively and a device that answered the same key two different
   * ways depending on where you pressed it would be worse than one that did not.
   * `preventDefault` keeps the arrows from scrolling the embedded page.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      // Through `press`, so a key does exactly what the pad above it does - including
      // starting a stopped game.
      press(e.key === "ArrowLeft" ? TURN_CCW.x : TURN_CW.x, 0);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <Frame title="Snake" device={device}>
      <dd style={{ gridColumn: "1 / -1", display: "flex", gap: 10, alignItems: "flex-start" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(8, ${PAD}px)`,
            gap: GAP,
            flex: "0 0 auto",
          }}
        >
          {/* Drawn TOP row first, because that is what a screen does - and the frame
              is indexed from the BOTTOM, because that is what the API does. The one
              conversion is this loop, and it is the same one padStore makes for the
              hardware. */}
          {Array.from({ length: 64 }, (_, i) => {
            const x = i % 8;
            const y = 7 - Math.floor(i / 8);
            const isTurn = (x === TURN_CCW.x || x === TURN_CW.x) && y === 0;
            return (
              <button
                key={i}
                title={isTurn ? (running ? (x === TURN_CCW.x ? "turn anticlockwise" : "turn clockwise") : "start") : `x ${x} y ${y}`}
                onClick={isTurn ? () => press(x, y) : undefined}
                style={{
                  width: PAD,
                  height: PAD,
                  padding: 0,
                  border: "1px solid #1c1c1c",
                  borderRadius: 2,
                  background: css(frame[y * 8 + x] ?? "black"),
                  // Only the two turn pads do anything, here as on the hardware.
                  cursor: isTurn ? "pointer" : "default",
                }}
              />
            );
          })}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
          <div className="row" style={{ gap: 8, justifyContent: "flex-start" }}>
            <button onClick={() => setRunning(!running)}>{running ? "stop" : "start"}</button>
            <span>
              {/* The same three numbers the border ring is showing, for whoever is
                  looking at the screen instead of the Push. */}
              {length}/20 · {"♥".repeat(lives) || "–"} · best {best}
              {!sound && <span className="warn"> · muted</span>}
            </span>
          </div>

          {outcome !== null && (
            <div style={{ fontSize: 9 }} className={outcome ? undefined : "warn"}>
              {outcome ? "filled the border - press a green pad to play again" : "out of lives - press a green pad to try again"}
            </div>
          )}

          <div style={{ color: "var(--muted)", fontSize: 9 }}>
            {/* The two turn pads are the bottom-left CORNER of the grid above, and of
                the Push. If they are drawn at the top, the y flip is wrong. */}
            {running ? "turn" : "start"}: the two lit pads bottom-left, or <kbd>&larr;</kbd> <kbd>&rarr;</kbd>
          </div>

          <div style={{ fontSize: 9 }}>
            {/* FOUR causes, one appearance. `takeover` off, no Push plugged in, a Push
                whose control names this role is not among, and another instance holding
                the grid are all a dark Push - and Live will not say which, because a
                rejected grab is a console line and a normal return. This is the
                wrapper reporting the decision it made, which is the half it knows. */}
            {held ? (
              <span>push: held - the grid is yours</span>
            ) : reason === "no_surface" ? (
              <span className="warn">push: no Push or Move connected</span>
            ) : reason === "unresolved" ? (
              <span className="warn">push: connected, but no matrix among its control names</span>
            ) : reason === "not_focused" ? (
              <span className="warn">push: waiting - {focus === "Device" ? "another device" : "another track"} has focus</span>
            ) : (
              <span style={{ color: "var(--muted)" }}>push: Takeovr is off - turn it on, or just play here</span>
            )}
          </div>
        </div>
      </dd>
    </Frame>
  );
}
