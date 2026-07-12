/**
 * devices.mjs - the device manifest. This is what you edit to change the shape
 * of a device; the patcher is generated from it, so patch cords become code
 * review rather than pixels.
 *
 * Fields
 *   name        output basename -> dist/<pkg>/<name>.amxd
 *   type        "midi" (MIDI effect) | "instrument" | "audio" (audio effect)
 *   ui          the folder under src/app/ holding this device's UI. Defaults to
 *               `name`. Each device gets its own UI bundle inside its own .amxd.
 *   chains      canned wiring, applied in order:
 *                 "midiin"      notes played into the device reach the app as
 *                               `notein <pitch> <velocity>` (see onNote()).
 *                 "midiout"     the app emits `midinote <pitch> <vel> <durMs>
 *                               <chan> <delayMs>` (see sendNote()); pipe +
 *                               makenote + midiformat place it on Max's
 *                               scheduler. The app computes WHEN.
 *                 "lowpass"     plugin~ -> onepole~ -> plugout~, with a `cutoff`
 *                               parameter. An audio effect you can hear.
 *                 "gain"        plugin~ -> *~ -> plugout~, with a `gain` parameter.
 *                 "passthrough" plugin~ -> plugout~. Does nothing to the audio.
 *   parameters  real Live parameters: automatable, MIDI-mappable, and what Push
 *               reads. Each becomes a live.* object, and reaches the app as
 *               `<id> <value>`.
 *
 *               Set `default`. Without it the object loads at the BOTTOM of its
 *               range, which for many parameters is a broken device.
 *   unmatchedTo where messages the chains did not consume go. "js" sends them to
 *               the wrapper (ui_ready, ...).
 *
 * Add a second device by adding an entry here and a folder at src/app/<name>/.
 */
export default [
  {
    name: "{{name}}",
    type: "midi",
    chains: ["midiin", "midiout"],
    parameters: [{ id: "density", object: "live.dial", range: [0, 1], default: 0.5 }],
    unmatchedTo: "js",
  },
];
