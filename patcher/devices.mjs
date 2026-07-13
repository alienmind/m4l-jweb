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
 *                 "passthrough" plugin~ -> plugout~ (an audio effect that
 *                               passes its input through untouched).
 *
 *               TWO AUDIO CHAINS CANNOT BE COMBINED TODAY. Each one creates its
 *               own plugin~/plugout~ and owns the whole signal path, so
 *               `["lowpass", "gain"]` emits duplicate boxes and SUMS the two
 *               paths instead of stacking them - silently. Stage 2.6 of
 *               doc/TODO.md fixes this (the build owns the endpoints; a chain
 *               claims a stage). Until then: one audio chain per device.
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
     * out. This one is audible - a one-pole lowpass with the Cutoff dial on it,
     * so sweeping the knob takes the top end away. Ableton's Auto Filter, minus
     * everything except the part you can hear.
     *
     * (It used to be the `passthrough` chain: a straight wire that proved the
     * container built and did nothing else. Removing it from a track sounded
     * identical, which is a fair thing to be annoyed by.)
     */
    name: "hello-audio",
    type: "audio",
    chains: ["lowpass"],
    // The `cutoff` parameter the chain needs: src/app/hello-audio/surface.ts. It
    // is 0-1 on the dial; the chain maps it logarithmically to 40 Hz - 18 kHz,
    // because a linear sweep of frequency does not sound like a linear sweep.
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
