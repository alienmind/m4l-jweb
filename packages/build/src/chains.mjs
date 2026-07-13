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
 * Splice a `route` into the app's message stream and hand the rest on.
 *
 * More than one thing routes [jweb]'s output - `midiout` claims `midinote` and
 * `flush`, the Surface claims every `set_<id>`, and whatever neither wanted must
 * still reach the wrapper. They cannot hang off [jweb]'s outlet in parallel: each
 * would pass the unmatched messages on to [js], and the wrapper would see
 * `ui_ready` once per route. So they are chained in SERIES, each feeding the next
 * from its unmatched outlet:
 *
 *   [jweb] -> [route midinote flush] -> [route set_density] -> [js]
 *                        unmatched               unmatched
 *
 * `ctx.appOut` names the tail of that chain - the outlet currently carrying
 * everything nobody has claimed. Claim from THAT, never from `jwebId` directly,
 * or you steal the messages the chain before you was passing on.
 *
 * Do not go looking for the cord to cut by searching for whatever feeds [js]
 * either: `live.thisdevice` feeds it too, and cutting that one is invisible here
 * and fatal in Live - it is the bang every LiveAPI observer is created from.
 */
export function claimAppMessages(ctx, routeId, unmatchedOutlet) {
  const [srcId, srcOutlet] = ctx.appOut ?? [ctx.jwebId, 0];
  removeLine(ctx.lines, srcId, ctx.unmatchedId);
  ctx.lines.push(line(srcId, srcOutlet, routeId, 0));
  ctx.lines.push(line(routeId, unmatchedOutlet, ctx.unmatchedId, 0));
  ctx.appOut = [routeId, unmatchedOutlet];
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
function midiOutChain(ctx) {
  const { boxes, lines } = ctx;

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

  // Take the app's messages, and pass on what is not a note (ui_ready, set_<id>,
  // ...) from outlet 2 - to the Surface's route if the device has parameters, and
  // to the wrapper in the end.
  claimAppMessages(ctx, "obj-route", 2);

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
}

/**
 * "passthrough" - an audio effect that passes its input through UNTOUCHED.
 *
 * It is a straight wire: `plugin~ -> plugout~`. Removing it from a track sounds
 * identical, because it does nothing to the audio - it exists to prove that an
 * audio-effect container builds and that the UI runs inside one.
 *
 * It is a scaffold, not a feature. If you want an audio effect that is audible,
 * you want `gain` below, or your own chain shaped like it.
 */
function passthroughChain({ boxes, lines }) {
  // An audio effect has no MIDI ports.
  removeBox(boxes, lines, "obj-midiin");
  removeBox(boxes, lines, "obj-midiout");
  boxes.push(box("obj-plugin", "plugin~", { numinlets: 1, numoutlets: 2, outlettype: ["signal", "signal"] }));
  boxes.push(box("obj-plugout", "plugout~", { numinlets: 2, numoutlets: 0 }));
  lines.push(line("obj-plugin", 0, "obj-plugout", 0));
  lines.push(line("obj-plugin", 1, "obj-plugout", 1));
}

/**
 * "gain" - an audio effect that actually DOES something: `plugin~ -> *~ -> plugout~`,
 * with a Live parameter riding the multiplier. Turn the dial, hear the level move.
 *
 * The smallest honest example of the shape every audio effect has - your DSP goes
 * where the `*~` is - and the smallest proof that a Live parameter reaches the
 * SIGNAL domain, not just the app.
 *
 * Note what does NOT happen here: the value does not travel through [jweb] and
 * back. The parameter is wired straight into the `*~` right inlet, in the patcher,
 * so the audio path does not depend on the browser being alive or keeping up. The
 * app gets its own copy of the value purely to DISPLAY it. Audio is Max's job; the
 * UI is a view of it.
 *
 * Requires a parameter named `gain` in the device's surface.ts (or pass
 * `device.gainParam`).
 */
function gainChain(ctx) {
  const { boxes, lines, device } = ctx;
  removeBox(boxes, lines, "obj-midiin");
  removeBox(boxes, lines, "obj-midiout");

  const paramId = requireParam(ctx, "gain", device?.gainParam ?? "gain", "gainParam");

  boxes.push(box("obj-plugin", "plugin~", { numinlets: 1, numoutlets: 2, outlettype: ["signal", "signal"] }));
  boxes.push(box("obj-plugout", "plugout~", { numinlets: 2, numoutlets: 0 }));

  // One *~ per channel: a signal object handles ONE signal, and plugin~ hands us
  // a stereo pair. `1.` (a float, not an int) keeps the right inlet in float mode.
  for (const [i, id] of [
    [0, "obj-gain-l"],
    [1, "obj-gain-r"],
  ]) {
    boxes.push(box(id, "*~ 1.", { numinlets: 2, numoutlets: 1, outlettype: ["signal"] }));
    lines.push(line("obj-plugin", i, id, 0));
    lines.push(line(id, 0, "obj-plugout", i));
    fanParamInto(ctx, paramId, id, 1);
  }
}

/**
 * Wire a parameter into the thing it controls, from BOTH of its sources:
 *
 *   the OBJECT's outlet - a knob turn, an automation lane, a Push encoder.
 *   the ROUTE's outlet  - the value the app wrote.
 *
 * The second is not redundant, and leaving it out is the bug this helper exists to
 * make unrepeatable. The app's write reaches the object as `set <value>`, which
 * updates it WITHOUT producing output - so the object never passes the app's value
 * on, and whatever it drives sits where it was while the UI's slider appears dead.
 * It did exactly that. See packages/build/src/surface.mjs.
 *
 * The boxes named here are created LATER, by applySurface(). A patchline may name a
 * box further down the array: a patcher is a graph, not a script.
 */
function fanParamInto(ctx, paramId, dstId, dstInlet) {
  const [objId, objOut] = ctx.paramObject(paramId);
  const [routeId, routeOut] = ctx.paramValue(paramId);
  ctx.lines.push(line(objId, objOut, dstId, dstInlet));
  ctx.lines.push(line(routeId, routeOut, dstId, dstInlet));
}

/** A chain that drives DSP from a parameter is broken without it - say so loudly. */
function requireParam(ctx, chainName, paramId, overrideField) {
  if (!ctx.surface?.params?.[paramId]) {
    const declared = ctx.surface ? ctx.surface.ids.join(", ") || "none" : "no surface.ts at all";
    throw new Error(
      `chain "${chainName}" on device "${ctx.device?.name}" needs a parameter "${paramId}" in ` +
        `src/app/${ctx.device?.ui ?? ctx.device?.name}/surface.ts (declared: ${declared}). ` +
        `Rename it, or point the chain at another one with \`${overrideField}\`.`,
    );
  }
  return paramId;
}

/**
 * "lowpass" - an audio effect you can actually HEAR: a resonance-free one-pole
 * lowpass with a Live parameter on the cutoff. Sweep it down and the top end
 * goes away. The smallest device in this repo that does something musical.
 *
 * The Cutoff slider lives in the DEVICE WINDOW (the jweb UI) and writes the Live
 * parameter via `set_cutoff` - so moving it moves the dial, the automation lane
 * and the filter together. It is one control, with two faces.
 *
 * `plugin~ -> onepole~ -> plugout~`, one filter per channel.
 *
 * WHY onepole~ and not lores~/svf~/biquad~: a one-pole is a 6 dB/octave slope -
 * the gentlest filter there is. It cannot self-oscillate, cannot blow up, and
 * has no resonance to set. That makes it the honest choice for a demo: the
 * effect is unmistakable when you sweep it, and there is no way to configure it
 * into silence or into a scream. Swap in `svf~` when you want a real filter.
 *
 * THE CUTOFF IS IN HERTZ, and no arithmetic happens here. The chain used to take a
 * 0-1 parameter and map it through `[expr 40. * pow(450., $f1)]`, because pitch is
 * logarithmic and a linear knob is useless on a filter. That mapping now lives on
 * the PARAMETER (`range: [40, 18000]`, `unit: "Hz"`, `exponent`), which is where
 * Live wants it: the automation lane reads Hz, Push reads "7.3 kHz", the app reads
 * Hz, and the value drops straight into onepole~. A normalised parameter with the
 * curve hidden in a chain lies to every one of those readouts.
 *
 * Requires a parameter named `cutoff` (or pass `device.cutoffParam`), in Hz.
 */
function lowpassChain(ctx) {
  const { boxes, lines, device } = ctx;
  removeBox(boxes, lines, "obj-midiin");
  removeBox(boxes, lines, "obj-midiout");

  const paramId = requireParam(ctx, "lowpass", device?.cutoffParam ?? "cutoff", "cutoffParam");

  boxes.push(box("obj-plugin", "plugin~", { numinlets: 1, numoutlets: 2, outlettype: ["signal", "signal"] }));
  boxes.push(box("obj-plugout", "plugout~", { numinlets: 2, numoutlets: 0 }));

  // One filter per channel: a signal object handles ONE signal, and plugin~ hands
  // us a stereo pair. Both take the same cutoff, so the image does not shift.
  for (const [i, id] of [
    [0, "obj-lpf-l"],
    [1, "obj-lpf-r"],
  ]) {
    boxes.push(box(id, "onepole~ 18000.", { numinlets: 2, numoutlets: 1, outlettype: ["signal"] }));
    lines.push(line("obj-plugin", i, id, 0));
    lines.push(line(id, 0, "obj-plugout", i));
    // The cutoff, in Hz, into the RIGHT inlet - from both of its sources: the dial
    // (a knob turn, an automation lane, a Push encoder) and the route (the app's
    // write, which the dial will not re-emit because it arrives as `set`).
    fanParamInto(ctx, paramId, id, 1);
  }
}

export const CHAINS = {
  midiin: midiInChain,
  midiout: midiOutChain,
  passthrough: passthroughChain,
  gain: gainChain,
  lowpass: lowpassChain,
};

/** Add a chain to the vocabulary. Called before generatePatchers(). */
export function registerChain(name, fn) {
  CHAINS[name] = fn;
}

/**
 * Parameters used to be declared in the manifest and generated here, by
 * `addParameters()`, in ONE direction: object -> app. Writing one back was a
 * per-chain hand-roll (`writableParams()`).
 *
 * Both are gone. A device's parameters are declared in `src/app/<ui>/surface.ts`
 * and compiled by `applySurface()` in surface.mjs - objects, both directions, and
 * the fan-out that the `set` behaviour forces. A chain reaches them through
 * `fanParamInto()` above.
 */
