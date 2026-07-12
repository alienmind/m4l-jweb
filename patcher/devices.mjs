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
 *   parameters  real Live parameters: automatable, MIDI-mappable, and the ONLY
 *               thing Push can show. Each becomes a live.* object wired into
 *               the UI as `<id> <value>`. No custom UI reaches Push - not
 *               yours, not anyone's - so put every musically meaningful control
 *               here as well as in the web UI.
 *   unmatchedTo where messages the chains did not consume go. "js" sends them
 *               to the wrapper (ui_ready, write_clip, read_notes, ...).
 */
export default [
  {
    name: "hello-midi",
    type: "midi",
    // midiin feeds played notes to the app as `notein`; midiout takes the notes
    // the app generates. The app is a small generator: it decides WHEN a note
    // falls and [pipe] places it on Max's scheduler.
    chains: ["midiin", "midiout"],
    // These MUST stay in step with src/app/surface.ts by hand until the Surface
    // codegen (Stage 2 of doc/TODO.md) generates them and this field goes away.
    parameters: [
      { id: "density", object: "live.dial", range: [0, 1], default: 0.5 },
      // The pulse rate, as an index into the app's rate list (0=off, 1=1/4 ...
      // 4=1/32). An index rather than the division itself because a Live
      // parameter sweeps continuously, and 1/4 -> 1/32 is not a sweep.
      { id: "rate", object: "live.dial", range: [0, 4], default: 0 },
    ],
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
    // 0-1 on the dial; the chain maps it logarithmically to 40 Hz - 18 kHz,
    // because a linear sweep of frequency does not sound like a linear sweep.
    //
    // `default: 1` is load-bearing. Without it the dial loads at the bottom of
    // its range - and the bottom of THIS range is a 40 Hz lowpass, i.e. a device
    // that swallows the signal the moment you drop it on a track. It sounds
    // exactly like a broken filter, which is what it is.
    parameters: [{ id: "cutoff", object: "live.dial", range: [0, 1], default: 1 }],
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
