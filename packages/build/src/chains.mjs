/**
 * chains.mjs - the box()/line() DSL and the canned chain vocabulary.
 *
 * A patcher is just JSON: `boxes` (objects, e.g. "route midinote flush") and
 * `lines` (cords: [sourceBox, outlet] -> [destBox, inlet]). So we never draw
 * one - we generate it. Patch cords become code review.
 *
 * A chain is a small function that claims [jweb]'s outlet, routes the selectors
 * it owns, and passes everything else on to `unmatchedTo`. Add your own with
 * `registerChain()`; keep them small and named after what they do.
 */

let y = 300; // stack generated objects below the hand-made ones

/** Reset the layout cursor. The build calls this once per device. */
export function resetLayout() {
	y = 300;
}

export const box = (id, text, extra = {}) => ({
	box: {
		id,
		maxclass: "newobj",
		text,
		numinlets: 1,
		numoutlets: 1,
		outlettype: [""],
		patching_rect: [16, (y += 32), 220, 20],
		...extra,
	},
});

export const line = (srcId, srcOut, dstId, dstIn) => ({
	patchline: { source: [srcId, srcOut], destination: [dstId, dstIn] },
});

/** Drop every cord touching a box, then the box. */
export function removeBox(boxes, lines, id) {
	const i = boxes.findIndex((b) => b.box.id === id);
	if (i >= 0) boxes.splice(i, 1);
	for (let j = lines.length - 1; j >= 0; j--) {
		const pl = lines[j].patchline;
		if (pl.source[0] === id || pl.destination[0] === id) lines.splice(j, 1);
	}
}

/** Drop a specific cord (used when a chain takes over jweb's output). */
export function removeLine(lines, srcId, dstId) {
	for (let i = lines.length - 1; i >= 0; i--) {
		const pl = lines[i].patchline;
		if (pl.source[0] === srcId && pl.destination[0] === dstId) lines.splice(i, 1);
	}
}

/**
 * "midiin" - feed incoming MIDI notes to the app as `notein <pitch> <velocity>`.
 *
 * Also CUTS the template's direct midiin -> midiout thru cord: a device that
 * transforms notes must not also leak the untransformed ones.
 */
function midiInChain({ boxes, lines, jwebId }) {
	removeLine(lines, "obj-midiin", "obj-midiout");
	boxes.push(
		box("obj-midiparse", "midiparse", {
			numinlets: 1,
			numoutlets: 8,
			outlettype: ["list", "list", "int", "int", "int", "list", "int", ""],
		}),
	);
	boxes.push(box("obj-noteinmsg", "prepend notein"));
	lines.push(line("obj-midiin", 0, "obj-midiparse", 0));
	lines.push(line("obj-midiparse", 0, "obj-noteinmsg", 0)); // outlet 0 = note: pitch, velocity
	lines.push(line("obj-noteinmsg", 0, jwebId, 0));
}

/**
 * "midiout" - the app emits `midinote <pitch> <vel> <durMs> <chan> <delayMs>`
 * and `flush`. Compute WHEN in your app; let Max place the note precisely.
 */
function midiOutChain({ boxes, lines, jwebId, unmatchedId }) {
	// This chain consumes jweb's output, so the template's direct jweb -> js cord
	// is replaced by the route's unmatched outlet.
	removeLine(lines, jwebId, unmatchedId);

	boxes.push(box("obj-route", "route midinote flush", { numoutlets: 3, outlettype: ["", "", ""] }));
	// Explicit unpack instead of letting pipe spread the list: unpack fires
	// right-to-left, so the delay (outlet 4) lands in pipe's delay inlet BEFORE
	// the pitch (outlet 0) hits the hot inlet.
	boxes.push(
		box("obj-unpack", "unpack 0 0 0 0 0", {
			numinlets: 1,
			numoutlets: 5,
			outlettype: ["int", "int", "int", "int", "int"],
		}),
	);
	boxes.push(
		box("obj-pipe", "pipe 0 0 0 0 0", {
			numinlets: 5, // 4 data inlets + delay
			numoutlets: 4,
			outlettype: ["int", "int", "int", "int"],
		}),
	);
	boxes.push(box("obj-makenote", "makenote 100 250", { numinlets: 3, numoutlets: 2, outlettype: ["int", "int"] }));
	boxes.push(box("obj-packnote", "pack 0 0", { numinlets: 2, numoutlets: 1, outlettype: [""] }));
	boxes.push(box("obj-fmt", "midiformat", { numinlets: 7, numoutlets: 1, outlettype: ["int"] }));
	// `route` STRIPS the selector: a bare "flush" emerges from outlet 1 as a bang,
	// which makenote ignores. Re-materialize the word with a message box so
	// makenote actually releases hanging notes.
	boxes.push(box("obj-flushmsg", "flush", { maxclass: "message", numinlets: 2, numoutlets: 1 }));

	lines.push(line(jwebId, 0, "obj-route", 0));
	lines.push(line("obj-route", 0, "obj-unpack", 0));
	lines.push(line("obj-route", 1, "obj-flushmsg", 0));
	lines.push(line("obj-flushmsg", 0, "obj-makenote", 0));
	for (let i = 0; i < 5; i++) lines.push(line("obj-unpack", i, "obj-pipe", i));
	lines.push(line("obj-pipe", 0, "obj-makenote", 0)); // pitch
	lines.push(line("obj-pipe", 1, "obj-makenote", 1)); // velocity
	lines.push(line("obj-pipe", 2, "obj-makenote", 2)); // duration ms
	lines.push(line("obj-pipe", 3, "obj-fmt", 6)); // channel
	lines.push(line("obj-makenote", 0, "obj-packnote", 0));
	lines.push(line("obj-makenote", 1, "obj-packnote", 1));
	lines.push(line("obj-packnote", 0, "obj-fmt", 0));
	lines.push(line("obj-fmt", 0, "obj-midiout", 0));
	// Unmatched selectors (ui_ready, write_clip, read_notes...) carry on.
	lines.push(line("obj-route", 2, unmatchedId, 0));
}

/** "passthrough" - an audio effect that passes its input through untouched. */
function passthroughChain({ boxes, lines }) {
	// An audio effect has no MIDI ports.
	removeBox(boxes, lines, "obj-midiin");
	removeBox(boxes, lines, "obj-midiout");
	boxes.push(box("obj-plugin", "plugin~", { numinlets: 1, numoutlets: 2, outlettype: ["signal", "signal"] }));
	boxes.push(box("obj-plugout", "plugout~", { numinlets: 2, numoutlets: 0 }));
	lines.push(line("obj-plugin", 0, "obj-plugout", 0));
	lines.push(line("obj-plugin", 1, "obj-plugout", 1));
}

export const CHAINS = {
	midiin: midiInChain,
	midiout: midiOutChain,
	passthrough: passthroughChain,
};

/** Add a chain to the vocabulary. Called before generatePatchers(). */
export function registerChain(name, fn) {
	CHAINS[name] = fn;
}

/**
 * Real Live parameters: automatable, MIDI-mappable, and the ONLY thing Push can
 * display. Each becomes a live.* object wired into the UI as `<id> <value>`, so
 * a parameter change is just another inlet message to your app.
 */
export function addParameters(boxes, lines, params, dstId) {
	let x = 480;
	for (const p of params) {
		const objId = `obj-param-${p.id}`;
		const prependId = `obj-prepend-${p.id}`;
		boxes.push({
			box: {
				id: objId,
				maxclass: p.object, // live.dial | live.toggle | live.menu
				numinlets: 1,
				numoutlets: 1,
				outlettype: [""],
				parameter_enable: 1,
				patching_rect: [x, 300, 44, 48],
				saved_attribute_attributes: {
					valueof: {
						parameter_longname: p.id,
						parameter_shortname: p.id.slice(0, 8), // Push shows short names
						parameter_type: p.object === "live.toggle" ? 2 : 0, // 2 = enum, 0 = float
						...(p.range ? { parameter_range: p.range } : {}),
					},
				},
			},
		});
		boxes.push(box(prependId, `prepend ${p.id}`));
		lines.push(line(objId, 0, prependId, 0));
		lines.push(line(prependId, 0, dstId, 0));
		x += 56;
	}
}
