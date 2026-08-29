/**
 * surface.ts (push-snake) - the Live parameters, and the controls declaration.
 *
 * `controls` is passed to `defineSurface` rather than living beside it because it
 * CONTRIBUTES two parameters: `takeover` (off by default) and `focus`. The only
 * thing Push can see is a Live parameter, so the switch that hands the pads back has
 * to be one - and the bank below therefore shows five controls, not three.
 */
import { defineSurface, dial, menu, state, toggle } from "@m4l-jweb/surface";
import controls from "./controls";

export default defineSurface({
  controls,
  params: {
    running: toggle({ default: false, short: "Run" }),
    /**
     * How hard the game is - three settings, not a rate.
     *
     * It was a dial in hertz, and that was wrong in three ways at once. The number on
     * Push and the speed on the grid stopped agreeing about ten seconds into a run,
     * because the snake also gains 10% per segment and the dial was only ever the
     * BASE. Nobody thinks about a game in hertz. And most of the travel was unplayable
     * anyway: 1 Hz is one move a second, and 16 Hz becomes 45 moves a second by
     * segment 20, so about two thirds of the encoder did nothing anyone would want.
     *
     * Three named settings say what the control is actually for, and every one of them
     * is a game. The rates they map to are in App.tsx.
     */
    difficulty: menu({ options: ["Easy", "Normal", "Hard"], default: "Normal", short: "Diff" }),
    volume: dial({ range: [0, 1], default: 0.6, format: (v) => `${Math.round(v * 100)}%`, short: "Volume" }),
    // The soundtrack, on its own dial. Separate from `volume` because they are two
    // different jobs: `volume` is the blips, which are FEEDBACK and have to be audible,
    // and this is the music, which is atmosphere and is the first thing anyone turns
    // down. One dial for both would mean turning the game deaf to quieten the tune.
    music: dial({ range: [0, 1], default: 0.5, format: (v) => `${Math.round(v * 100)}%`, short: "Music" }),
    /**
     * MASTER MUTE - the blips and the music at once, on a Push encoder.
     *
     * A separate control from the two level dials, and not a redundant one: turning
     * both to zero to shut the device up loses where they were set, and finding a dial
     * on a hardware encoder and sweeping it to zero is not something anyone does while
     * playing. This is one press. It is a real Live parameter like everything else, so
     * it automates and MIDI-maps too.
     */
    sound: toggle({ default: true, short: "Sound" }),
  },
  // Three declared, and defineControls' `takeover` and `focus` are appended to the
  // first page with room - so one Push page holds the whole device.
  // Order IS the encoder order on Push, so the three audio controls are adjacent and
  // the mute sits at the end of them. `takeover` and `focus` are appended by
  // defineControls, which puts them on encoders 6 and 7 of the same page.
  banks: [{ name: "Snake", params: ["running", "difficulty", "volume", "music", "sound"] }],
  // The high score survives saving the set. A number Live must never automate is
  // exactly what a state slot is for.
  state: { best: state<number>({ default: 0 }) },
});
