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
     * NOT AN EXAMPLE - AN EXPERIMENT. Delete this entry once you have listened to it.
     *
     * hello-audio's signal path, backwards. It shares hello-audio's app folder
     * (`ui`), its surface and its three dials, so the ONLY difference between the two
     * devices in the whole build is the order of three words below. That is what
     * makes it evidence: put both on a track, match the dials, push Drive up, and
     * A/B them.
     *
     *   hello-audio      filter -> distort -> level    smooth: the distortion's
     *                                                  harmonics are then filtered off
     *   hello-audio-rev  level -> distort -> filter    gritty: a quiet signal barely
     *                                                  clips, and what does clip is
     *                                                  left bright
     *
     * If they sound the SAME, the generated series is a lie and the chains are still
     * summing in parallel - which is exactly the bug this was built to catch, and the
     * one that shipped silently before Stage 2.6.
     *
     * Note the pair only proves anything because `drive` is NONLINEAR. Reversing two
     * linear stages (a filter and a level) generates a different patcher and sounds
     * identical, so an A/B built from `lowpass` and `gain` alone would "fail" in
     * exactly the way a broken build does.
     */
    name: "hello-audio-rev",
    type: "audio",
    ui: "hello-audio", // the same app, the same parameters, the opposite signal path
    chains: ["gain", "drive", "lowpass"],
    unmatchedTo: "js",
  },
  {
    /**
     * Not a device - an instrument for answering the three Stage 1 questions
     * that the rest of the plan is gated on. Build it, drag it onto a MIDI
     * track, open the Max console, and follow doc/SPIKES.md.
     *
     * Delete this entry (and patcher/chains.mjs, and wrapper/device.ts) once
     * the answers are recorded.
     */
    name: "spike",
    type: "midi",
    mode: "spike", // the wrapper and the UI both switch on this
    chains: ["spike"],
    unmatchedTo: "js",
  },
];
