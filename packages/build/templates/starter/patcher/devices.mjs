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
 *                 "lowpass"     onepole~ in the signal path, with a `cutoff`
 *                               parameter. An audio effect you can hear.
 *                 "drive"       overdrive~ in the signal path, with a `drive`
 *                               parameter. Soft-clipping distortion.
 *                 "gain"        *~ in the signal path, with a `gain` parameter.
 *                 "passthrough" nothing at all. Does not touch the audio.
 *
 *               THE ORDER IS THE SIGNAL PATH. An audio device's plugin~/plugout~
 *               are created by the build; each audio chain claims one STAGE
 *               between them, so `["lowpass", "drive", "gain"]` is
 *               plugin~ -> onepole~ -> overdrive~ -> *~ -> plugout~. Reorder the
 *               list and the device is rewired - and with a nonlinear stage like
 *               `drive` in it, you can hear the difference. (Two LINEAR stages
 *               commute: swapping "lowpass" and "gain" sounds identical.)
 *   unmatchedTo where messages the chains did not consume go. "js" sends them to
 *               the wrapper (ui_ready, ...).
 *
 * Parameters are NOT here: they are declared in src/app/<ui>/surface.ts, and the
 * build generates the live.* objects and their wiring from that one declaration.
 * A chain that names a parameter (`lowpass` wants `cutoff`) fails the build if the
 * surface does not declare it.
 *
 * Add a second device by adding an entry here and a folder at src/app/<name>/.
 */
export default [
  {
    name: "{{name}}",
    type: "midi",
    chains: ["midiin", "midiout"],
    unmatchedTo: "js",
  },
];
