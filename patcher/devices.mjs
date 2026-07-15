/**
 * devices.mjs - the device manifest. THIS is what you edit to change the shape
 * of a device; the patcher itself is generated from it (see
 * @m4l-jweb/build). Patch cords become code review.
 *
 * Fields
 *   name        output basename -> dist/<pkg>/<name>.amxd
 *   type        "midi" (MIDI effect) | "instrument" | "audio" (audio effect)
 *   chains      canned wiring, applied in order. Vocabulary:
 *                 "midiout"     jweb -> route midinote -> pipe -> makenote
 *                               -> midiformat -> midiout. The app emits
 *                               `midinote <pitch> <vel> <durMs> <chan> <delayMs>`;
 *                               it computes WHEN, Max places it precisely.
 *                 "lowpass"     onepole~ in the signal path, on a `cutoff` param.
 *                 "gain"        *~ in the signal path, on a `gain` param.
 *                 "passthrough" nothing at all - an audio effect that passes its
 *                               input through untouched.
 *
 *               THE ORDER IS THE SIGNAL PATH. An audio device's plugin~/plugout~
 *               are created by the build; each audio chain claims one STAGE
 *               between them, so `["lowpass", "gain"]` is
 *               plugin~ -> onepole~ -> *~ -> plugout~, and reversing the list
 *               reverses the effects.
 *   unmatchedTo where messages the chains did not consume go. "js" sends them
 *               to the wrapper (ui_ready, write_clip, read_notes, ...).
 *
 * Parameters are NOT here. They are declared in `src/app/<device>/surface.ts` -
 * one declaration, from which the build derives the live.* objects, the wiring in
 * both directions, and the protocol selectors. This file used to carry a
 * `parameters` field that had to be kept in step with surface.ts by hand; the
 * Surface codegen subsumed it.
 */
export default [
  {
    name: "hello-midi",
    type: "midi",
    // midiin feeds played notes to the app as `notein`; midiout takes the notes
    // the app generates. The app is a small generator: it decides WHEN a note
    // falls and [pipe] places it on Max's scheduler.
    chains: ["midiin", "midiout"],
    // Parameters: src/app/hello-midi/surface.ts (density, rate).
    unmatchedTo: "js",
  },
  {
    /**
     * An audio EFFECT: it sits on an audio track, takes audio in and gives audio
     * out. Three stages, and THIS LINE IS THE SIGNAL PATH:
     *
     *   plugin~ -> onepole~ -> overdrive~ -> *~ -> plugout~
     *              "lowpass"    "drive"    "gain"
     *
     * The build creates the device's plugin~/plugout~; each chain claims one stage
     * between them, in declaration order. Swap "drive" and "gain" here and the
     * device is rewired - and you can HEAR the difference, because distortion and a
     * level change do not commute (a filter and a level change do: reordering
     * "lowpass" and "gain" would generate a different patcher and sound the same).
     *
     * Each chain requires the parameter named after it - cutoff, drive, gain - from
     * src/app/hello-audio/surface.ts, and fails the build without it.
     */
    name: "hello-audio",
    type: "audio",
    chains: ["lowpass", "drive", "gain"],
    unmatchedTo: "js",
  },
  {
    /**
     * NOT AN EXAMPLE - A TEST CASE, and the only one in this repo whose assertion is
     * made with your EARS. Keep it. doc/LISTENING.md is how to run it.
     *
     * hello-audio's signal path, backwards. It shares hello-audio's app folder
     * (`ui`), its surface and its three dials, so the ONLY difference between the two
     * devices in the whole build is the order of three words below. That is what
     * makes it evidence rather than a demo.
     *
     *   hello-audio      filter -> distort -> level    loud and dirty: it distorts at
     *                                                  full level, and no filter comes
     *                                                  after to tame the harshness
     *   hello-audio-rev  level -> distort -> filter    quiet and clean: the level is
     *                                                  cut BEFORE the distortion, so
     *                                                  it barely clips, and the filter
     *                                                  smooths what does
     *
     * If they sound the SAME, the generated series is a lie and the stages are summing
     * in parallel - the bug Stage 2.6 fixed, which shipped silently before it. (They
     * DID sound different, in Live, which is what closed 2.6.)
     *
     * The pair only proves anything because `drive` is NONLINEAR. Reversing two linear
     * stages (a filter and a level) generates a different patcher and sounds
     * identical, so an A/B built from `lowpass` and `gain` alone would "fail" in
     * exactly the way a broken build does. Same trap inside the test: at Drive = 1 and
     * Gain = 1 both stages are pass-throughs and the two devices are SUPPOSED to sound
     * alike. Push Drive up and pull Gain well below 1, or you are testing nothing.
     */
    name: "hello-audio-rev",
    type: "audio",
    ui: "hello-audio", // the same app, the same parameters, the opposite signal path
    chains: ["gain", "drive", "lowpass"],
    unmatchedTo: "js",
  },
  {
    /**
     * hello-downloads
     * Tests the fetch-to-disk capability, which bypasses the lack of disk access in [jweb].
     * Demonstrates using the `download` chain that interfaces with `[maxurl]`.
     */
    name: "hello-downloads",
    type: "audio",
    chains: ["passthrough", "download"],
    unmatchedTo: "js",
  },
  {
    /**
     * hello-sampler - the first device in this repo that ORIGINATES a sound.
     *
     * An INSTRUMENT (`type: "instrument"`), which nothing else here builds: it sits on
     * a MIDI track and is the source of that track's audio rather than a stage in
     * someone else's signal path.
     *
     * The two chains are the whole sample-browser path, in order: `download` puts the
     * file on disk ([maxurl] writes it; the bytes never cross the bridge), and
     * `samples` reads it into a [buffer~] and plays it through [groove~] INTO THE
     * TRACK. A page cannot preview a sample by playing it itself - [jweb] has no
     * signal outlets, so its audio goes to the OS output device, past the fader and
     * the monitor cue.
     *
     * `slots` names the buffers. One is enough for a preview; a drum map wants eight.
     */
    name: "hello-sampler",
    type: "instrument",
    chains: ["samples", "download"],
    // Two slots, so mono-vs-stereo playback can be A/B'd in Live: a stereo file must
    // keep its image, and a MONO file must fold to BOTH ears (the samples chain's
    // [selector~] gate - see doc/TODO.md #4). Each slot is its own [buffer~].
    slots: ["stereo", "mono"],
    unmatchedTo: "js",
  },
  {
    /**
     * hello-state
     * Demonstrates the state persistence API (`useStateSync`).
     * Proves that arbitrary JSON blobs can be saved cleanly into the Ableton Live Set and automatically restored.
     */
    name: "hello-state",
    type: "audio",
    chains: ["passthrough"],
    unmatchedTo: "js",
  },
  {
    /**
     * hello-window
     * Demonstrates the floating window API (`useWindow`): a second page, in a window
     * of its own, for a UI that does not fit in the device view's fixed ~169 px. The
     * window is declared in surface.ts; the build generates the subpatcher, its
     * [jweb] and the [pcontrol] that opens it.
     */
    name: "hello-window",
    type: "audio",
    chains: ["passthrough"],
    unmatchedTo: "js",
  },
];
