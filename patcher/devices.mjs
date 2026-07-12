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
		chains: ["midiout"],
		parameters: [
			{ id: "density", object: "live.dial", range: [0, 1] },
			{ id: "running", object: "live.toggle" },
		],
		unmatchedTo: "js",
	},
	{
		name: "hello-audio",
		type: "audio",
		chains: ["passthrough"],
		parameters: [{ id: "mix", object: "live.dial", range: [0, 1] }],
		unmatchedTo: "js",
	},
];
