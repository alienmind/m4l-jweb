/**
 * chains.mjs - the box()/line() DSL and the canned chain vocabulary.
 *
 * A patcher is just JSON: `boxes` (objects, e.g. "route midinote flush") and
 * `lines` (cords: [sourceBox, outlet] -> [destBox, inlet]). So we never draw
 * one - we generate it. Patch cords become code review.
 *
 * A chain is a small function that claims a STAGE and hands the rest on. There
 * are two streams to claim a stage in, and both work the same way:
 *
 *   the app's messages  `claimAppMessages(ctx, myRoute, unmatchedOutlet)`
 *   the signal path     `ctx.audioIn(ch)` / `ctx.setAudioOut(ch, id, outlet)`
 *
 * A chain never OWNS either stream. It takes what the stage before it left, and
 * says what it leaves for the stage after it - which is what makes
 * `chains: ["lowpass", "gain"]` a series rather than two devices fighting over one
 * patcher. Add your own with `registerChain()`; keep them small and named after
 * what they do.
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

  // Nobody has claimed the stream yet, and yet [jweb] no longer reaches the
  // wrapper: a chain cut that cord by hand (the old `removeLine(jwebId,
  // unmatchedId)` idiom) without saying where it put the messages. We cannot know
  // - and guessing produces a patcher that WORKS while delivering every unrouted
  // message twice, which is not a failure anyone would look for. Say so instead.
  if (!ctx.appOut && !ctx.lines.some((l) => l.patchline.source[0] === ctx.jwebId && l.patchline.destination[0] === ctx.unmatchedId)) {
    throw new Error(
      `a chain on device "${ctx.device?.name}" took [jweb]'s outlet without claimAppMessages(). ` +
        `Routes are chained in series, so each one must hand the next what it did not match. ` +
        `Replace "removeLine(lines, jwebId, unmatchedId); lines.push(line(jwebId, 0, myRoute, 0)); ` +
        `lines.push(line(myRoute, <last>, unmatchedId, 0));" with "claimAppMessages(ctx, myRoute, <last>)".`,
    );
  }

  removeLine(ctx.lines, srcId, ctx.unmatchedId);
  ctx.lines.push(line(srcId, srcOutlet, routeId, 0));
  ctx.lines.push(line(routeId, unmatchedOutlet, ctx.unmatchedId, 0));
  ctx.appOut = [routeId, unmatchedOutlet];
}

/* ------------------------------------------------------------------ *
 * The signal path
 * ------------------------------------------------------------------ */

/** The device's audio endpoints. Created by the BUILD, never by a chain. */
export const AUDIO_IN = "obj-plugin";
export const AUDIO_OUT = "obj-plugout";

/**
 * A [buffer~] name that is unique PER DEVICE INSTANCE.
 *
 * THE BUG THIS EXISTS TO KILL. Buffer names are GLOBAL to Max, and they used to be
 * generated from the device name alone (`buf-<device>-<slot>`) and frozen into the
 * patcher at BUILD time. So two copies of one device - a drum rack on two tracks, which
 * is the normal case, not an exotic one - named their buffers identically, and Max gave
 * both to whichever loaded last. One rack's samples silently became the other's. No
 * error, no console line: just the wrong sound.
 *
 * A name minted by the wrapper after load cannot reach a box frozen at build time (a
 * buffer takes its name from its creation argument and there is no documented runtime
 * rename), so the scoping has to be a load-time substitution Max itself performs.
 *
 * `#0` WAS TRIED AND DOES NOT WORK (spike, doc/TODO.md item 0, run 2026-07-17 in
 * Live). `#0` is documented for abstractions, and an .amxd device patcher turned out
 * not to count as one: the token stayed literal in every instance, so writer and
 * reader still agreed on one global name and the collision survived, silently.
 *
 * `---` IS THE MECHANISM BUILT FOR THIS. Max for Live replaces a leading `---` in a
 * name with an id unique to the DEVICE instance - and the scope is the whole device,
 * subpatchers and [poly~] voices included, not one patcher. That kills the `#0`/`#1`
 * hand-off the first attempt needed: the voice spells the SAME name the device does,
 * and no id has to travel through [poly~]'s arguments.
 *
 * OUTSIDE LIVE `---` stays literal (it is a Live-only substitution). Both writer and
 * reader keep agreeing, so a patcher opened in standalone Max degrades to the old
 * shared-name behavior instead of breaking - acceptable, since the devices only
 * meaningfully run in Live.
 */
export const deviceBufName = (device, slot) => `---buf-${device?.name}-${slot}`;

/** The same buffer, as a [poly~] voice spells it: identical - `---` scopes per DEVICE,
 * not per patcher, so the voice shares the expansion with the patcher that loaded it. */
export const voiceBufName = (device, slot) => deviceBufName(device, slot);

/**
 * How long a `remote` slot takes to slide to each new value, in ms.
 *
 * It is a RAMP TIME, not a rate: the app sends values on the transport tick, and each
 * one is ramped to over this long. Exported because the number is only right in
 * relation to the app's tick - it wants to be about one tick, so a ramp is still
 * arriving when the next value lands and the slots join into a continuous line. Much
 * shorter and the stepping it exists to remove comes back as a staircase with flat
 * treads; much longer and the modulation lags visibly behind the pattern.
 */
export const REMOTE_RAMP_MS = 20;

/** plugin~ hands us a stereo pair, so every stage is a pair of signal objects. */
export const AUDIO_CHANNELS = 2;

/**
 * Create the device's audio endpoints, once, before any chain runs.
 *
 * THIS IS THE FIX FOR A SILENT BUG. Every audio chain used to create `plugin~` and
 * `plugout~` for itself and wire itself between them - so each one was a whole
 * device, not a stage in one. `chains: ["lowpass", "gain"]` emitted two boxes
 * sharing the id `obj-plugin`, two sharing `obj-plugout`, and FOUR sources summing
 * into the output: the filtered pair and the unfiltered gain pair, in parallel. The
 * effects did not stack, they mixed - with no error at build time and none in Live.
 * It just sounded wrong in a way you would blame on your DSP.
 *
 * So the endpoints belong to the device, and a chain occupies a STAGE between them:
 *
 *   [plugin~] -> [onepole~] -> [*~] -> [plugout~]
 *                 "lowpass"   "gain"
 *
 * `ctx.audioIn(ch)` is whatever the last stage left on that channel - `plugin~` if
 * you are the first. `ctx.setAudioOut(ch, id, outlet)` says you are the tail now.
 * `closeAudio()` wires the final tail into `plugout~` once every chain has run.
 *
 * It is the same shape as `claimAppMessages()` one layer down: several things want
 * one stream, so they are chained in SERIES with an explicit hand-off rather than
 * hung off the source in parallel.
 */
export function openAudio(ctx) {
  const { boxes, lines, device } = ctx;
  const type = device?.type;

  if (type !== "audio" && type !== "instrument") {
    // A MIDI effect has no signal path at all. Say so when a chain asks for one,
    // rather than emitting a cord from a box that does not exist - which Max opens
    // as a patcher with a missing object and no explanation.
    const refuse = () => {
      throw new Error(
        `a chain on device "${device?.name}" asked for the signal path, but the device is type "${type}". ` +
          `plugin~/plugout~ exist only in an audio-effect or instrument device: set \`type: "audio"\` in patcher/devices.mjs.`,
      );
    };
    ctx.audioIn = refuse;
    ctx.setAudioOut = refuse;
    return;
  }

  // An audio effect has no MIDI ports. An instrument keeps them: MIDI in is how it
  // is played.
  if (type === "audio") {
    removeBox(boxes, lines, "obj-midiin");
    removeBox(boxes, lines, "obj-midiout");
  }

  boxes.push(box(AUDIO_IN, "plugin~", { numinlets: 1, numoutlets: 2, outlettype: ["signal", "signal"] }));
  boxes.push(box(AUDIO_OUT, "plugout~", { numinlets: 2, numoutlets: 0 }));

  // The tail of the signal path, per channel. Nothing has claimed a stage yet, so
  // it is the input: a device with no audio chain at all is a straight wire.
  ctx.audioTail = Array.from({ length: AUDIO_CHANNELS }, (_, ch) => [AUDIO_IN, ch]);
  ctx.audioIn = (ch) => ctx.audioTail[ch];
  ctx.setAudioOut = (ch, id, outlet = 0) => {
    ctx.audioTail[ch] = [id, outlet];
  };
}

/** Wire whatever the last stage left into `plugout~`. The build calls this last. */
export function closeAudio(ctx) {
  if (!ctx.audioTail) return; // not an audio device
  ctx.audioTail.forEach(([srcId, srcOut], ch) => ctx.lines.push(line(srcId, srcOut, AUDIO_OUT, ch)));
}

/**
 * Two boxes with one id is a MALFORMED patcher, and Max resolves it however it
 * likes - so the device loads, and the cords go somewhere nobody chose. That was
 * the visible half of the audio-chain bug, and nothing rejected it. This does.
 *
 * The build calls it after every chain and the Surface have run, on the patcher
 * that is about to be written, so it covers the canned chains, a device repo's own
 * `patcher/chains.mjs`, and the template underneath both.
 */
export function assertUniqueBoxIds(boxes, deviceName, scope = "the patcher") {
  const seen = new Set();
  const dupes = new Set();
  for (const { box: b } of boxes) (seen.has(b.id) ? dupes : seen).add(b.id);
  if (dupes.size) {
    throw new Error(
      `device "${deviceName}" generated duplicate box ids in ${scope}: ${[...dupes].join(", ")}. ` +
        `Two boxes with one id is a patcher Max will interpret however it likes. ` +
        `A chain that creates a box another chain also creates is not a stage - it is claiming to be the whole device. ` +
        `Take the stage before you (ctx.audioIn / ctx.appOut) and hand yours on, or name your boxes after your chain.`,
    );
  }
  // A SUBPATCHER is its own id namespace, so its boxes are checked against each
  // other and not against ours - a floating window's [jweb] may be called
  // `obj-jweb` even though the device's is too. It is checked, though: the window
  // codegen emitted two inlets sharing one id and nothing said a word, because
  // this only ever looked at the top level.
  for (const { box: b } of boxes) {
    if (b.patcher?.boxes) assertUniqueBoxIds(b.patcher.boxes, deviceName, `subpatcher [${b.text ?? b.id}]`);
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
 * It claims no stage, so the signal path stays what the build left it:
 * `plugin~ -> plugout~`, a straight wire. Removing the device from a track sounds
 * identical, because it does nothing to the audio - it exists to prove that an
 * audio-effect container builds and that the UI runs inside one.
 *
 * It is a scaffold, not a feature, and since the build now creates the endpoints it
 * is also a NO-OP: `type: "audio"` with no chains at all does exactly this. It
 * survives because `chains: ["passthrough"]` says out loud what an empty list only
 * implies. If you want an audio effect that is audible, you want `gain` below, or
 * your own chain shaped like it.
 */
function passthroughChain(ctx) {
  ctx.audioIn(0); // ...and hand it straight on. Also asserts the device HAS audio.
}

/**
 * "gain" - an audio effect that actually DOES something: `*~` in the signal path,
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
  const paramId = requireParam(ctx, "gain", device?.gainParam ?? "gain", "gainParam");

  // One *~ per channel: a signal object handles ONE signal, and plugin~ hands us
  // a stereo pair. `1.` (a float, not an int) keeps the right inlet in float mode.
  for (const [ch, id] of [
    [0, "obj-gain-l"],
    [1, "obj-gain-r"],
  ]) {
    const [srcId, srcOut] = ctx.audioIn(ch); // whatever the last stage left
    boxes.push(box(id, "*~ 1.", { numinlets: 2, numoutlets: 1, outlettype: ["signal"] }));
    lines.push(line(srcId, srcOut, id, 0));
    ctx.setAudioOut(ch, id, 0); // we are the tail now
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
 *
 * THE VALUE ARRIVES IN REAL UNITS, AND A CHAIN DOES NO ARITHMETIC ON IT. The range,
 * the unit and the curve live on the PARAMETER (`range: [40, 18000]`, `unit: "Hz"`,
 * `exponent`) - which is where Live wants them: the automation lane reads Hz, Push
 * reads "7.3 kHz", and the number drops straight into the DSP object. `lowpass`
 * used to take a 0-1 parameter and map it with `[expr 40. * pow(450., $f1)]`; a
 * chain that reintroduces a mapping like that DOUBLE-MAPS a parameter that already
 * carries its own curve, and lies to every readout while it does it.
 */
export function fanParamInto(ctx, paramId, dstId, dstInlet) {
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
 * `onepole~` in the signal path, one filter per channel.
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
  const paramId = requireParam(ctx, "lowpass", device?.cutoffParam ?? "cutoff", "cutoffParam");

  // One filter per channel: a signal object handles ONE signal, and plugin~ hands
  // us a stereo pair. Both take the same cutoff, so the image does not shift.
  for (const [ch, id] of [
    [0, "obj-lpf-l"],
    [1, "obj-lpf-r"],
  ]) {
    const [srcId, srcOut] = ctx.audioIn(ch);
    boxes.push(box(id, "onepole~ 18000.", { numinlets: 2, numoutlets: 1, outlettype: ["signal"] }));
    lines.push(line(srcId, srcOut, id, 0));
    ctx.setAudioOut(ch, id, 0);
    // The cutoff, in Hz, into the RIGHT inlet - from both of its sources: the dial
    // (a knob turn, an automation lane, a Push encoder) and the route (the app's
    // write, which the dial will not re-emit because it arrives as `set`).
    fanParamInto(ctx, paramId, id, 1);
  }
}

/**
 * "drive" - soft-clipping distortion: an `overdrive~` in the signal path, with a
 * Live parameter on the drive factor.
 *
 * THE CHAIN WHOSE PLACE IN THE LIST YOU CAN HEAR, and it is in the vocabulary for
 * that reason as much as for the sound. `lowpass` and `gain` are both LINEAR, so
 * they commute: `["lowpass", "gain"]` and `["gain", "lowpass"]` generate different
 * patchers and produce identical audio. A composition built only from those two
 * cannot be verified by ear - you would reorder them, hear nothing change, and
 * reasonably conclude the build was broken.
 *
 * Distortion does not commute with a level change. `["gain", "drive"]` turns the
 * signal down and THEN distorts it, so a quiet input barely clips; `["drive",
 * "gain"]` distorts at full level and turns the result down, so it stays dirty and
 * gets quieter. Same two chains, same parameters, unmistakably different sound -
 * which is what makes the series real rather than a claim in a test.
 *
 * `overdrive~` limits to +/- 1 and takes its drive factor (1 = clean, 10 = filthy)
 * in the RIGHT inlet, per Max's own reference. Below 1 it distorts violently; the
 * parameter's range starts at 1, which is where a user would expect "off" to be.
 *
 * Requires a parameter named `drive` (or pass `device.driveParam`).
 */
function driveChain(ctx) {
  const { boxes, lines, device } = ctx;
  const paramId = requireParam(ctx, "drive", device?.driveParam ?? "drive", "driveParam");

  for (const [ch, id] of [
    [0, "obj-drive-l"],
    [1, "obj-drive-r"],
  ]) {
    const [srcId, srcOut] = ctx.audioIn(ch);
    boxes.push(box(id, "overdrive~ 1.", { numinlets: 2, numoutlets: 1, outlettype: ["signal"] }));
    lines.push(line(srcId, srcOut, id, 0));
    ctx.setAudioOut(ch, id, 0);
    fanParamInto(ctx, paramId, id, 1);
  }
}

/**
 * "hpf" - a high-pass next to `lowpass`, and a WIRE at 0 Hz.
 *
 *   dry --+--------------------> [-~] --> out
 *         |                       ^
 *         +--> [onepole~] --------+       (the low end, subtracted away)
 *
 * WHY A SUBTRACTION AND NOT A HIGHPASS OBJECT. `onepole~` is lowpass-only, and the
 * one-pole highpass is its exact complement: everything the lowpass keeps is what a
 * highpass throws away, so `dry - lowpass(dry)` IS the highpass, sample for sample.
 * No second filter design, no new object, and the same 6 dB/octave slope, resonance-
 * free and impossible to blow up, that `lowpass` was chosen for.
 *
 * IT IS ALSO WHAT MAKES 0 HZ A REAL NEUTRAL, which is the frozen-graph law's whole
 * demand (CHAIN_NEUTRAL below). A one-pole lowpass at cutoff 0 has nothing to pass:
 * its output is silence, so the subtraction reads `dry - 0` and the stage is the
 * input, bit for bit. A highpass object would instead be neutral at its cutoff floor,
 * where it is NOT a wire - it still turns DC and the bottom octave, which is a
 * colouration a device could not switch off. The complement has no such setting.
 *
 * NOT a wet/dry send, despite the shape: there is no mix gain, and the parameter that
 * reaches neutral is the CUTOFF itself. It is naturally transparent, like `lowpass` -
 * see the two kinds of neutral in CHAIN_NEUTRAL.
 *
 * The cutoff is in Hz and the chain does no arithmetic on it - the range, unit and
 * curve ride the PARAMETER, exactly as in `lowpass`.
 *
 * Requires a parameter named `hpfreq` (or pass `device.hpfreqParam`), in Hz.
 */
function hpfChain(ctx) {
  const { boxes, lines, device } = ctx;
  const paramId = requireParam(ctx, "hpf", device?.hpfreqParam ?? "hpfreq", "hpfreqParam");

  for (const [ch, s] of [
    [0, "l"],
    [1, "r"],
  ]) {
    const [srcId, srcOut] = ctx.audioIn(ch);
    const lp = `obj-hpf-lp-${s}`;
    const sub = `obj-hpf-sub-${s}`;

    // The low end to remove. A float argument (0.) so the stage starts as a wire
    // before any parameter loads, and the right inlet stays in float mode.
    boxes.push(box(lp, "onepole~ 0.", { numinlets: 2, numoutlets: 1, outlettype: ["signal"] }));
    boxes.push(box(sub, "-~", { numinlets: 2, numoutlets: 1, outlettype: ["signal"] }));

    lines.push(line(srcId, srcOut, lp, 0));
    lines.push(line(srcId, srcOut, sub, 0)); // dry at unity, into the LEFT inlet
    lines.push(line(lp, 0, sub, 1)); // minus the low end
    fanParamInto(ctx, paramId, lp, 1);
    ctx.setAudioOut(ch, sub, 0);
  }
}

/**
 * "crush" - bit-depth reduction (`degrade~`), neutral at full depth.
 *
 * `degrade~` takes a sample-rate RATIO (inlet 1, 1.0 = untouched) and a BIT DEPTH
 * (inlet 2). This chain drives the bit depth only and leaves the ratio at 1.0: two
 * knobs on one stage would be a second parameter the fx line has no word for -
 * Strudel's `.crush(n)` is bit depth, and `.coarse()` is the rate reduction, a
 * separate effect and a separate chain when someone wants it.
 *
 * THE NEUTRAL IS FULL DEPTH, NOT STRUDEL'S 16. Strudel calls `.crush(16)` "minimum
 * crush", but 16-bit quantisation is not a wire - it is a quiet crush, and a stage
 * that is always in the path (the frozen-graph law) must have a setting where it does
 * NOTHING. So the parameter's range runs to the object's full 24 bits and rests
 * there, where degrade~ passes its input through. A user who types `.crush(16)` gets
 * 16-bit quantisation - the same sound superdough's crush(16) makes - and a user who
 * never types `.crush()` at all gets their signal back untouched. Both are honest;
 * only the second is possible with a neutral of 16.
 *
 * The depth is in BITS and the chain does no arithmetic on it - the range rides the
 * parameter, as everywhere else.
 *
 * Requires a parameter named `crush` (or pass `device.crushParam`), in bits.
 */
function crushChain(ctx) {
  const { boxes, lines, device } = ctx;
  const paramId = requireParam(ctx, "crush", device?.crushParam ?? "crush", "crushParam");

  for (const [ch, s] of [
    [0, "l"],
    [1, "r"],
  ]) {
    const [srcId, srcOut] = ctx.audioIn(ch);
    const id = `obj-crush-${s}`;

    // `degrade~ 1. 24.` - rate ratio 1.0 (untouched), 24 bits (full depth): a wire
    // until the parameter says otherwise.
    boxes.push(box(id, "degrade~ 1. 24.", { numinlets: 3, numoutlets: 1, outlettype: ["signal"] }));
    lines.push(line(srcId, srcOut, id, 0));
    ctx.setAudioOut(ch, id, 0);
    // Bit depth into inlet 2. Inlet 1 (the rate ratio) is left at its argument.
    fanParamInto(ctx, paramId, id, 2);
  }
}

/**
 * "remote" - `live.remote~`, so a PATTERN can modulate a Live parameter.
 *
 *   app -> remote_bind <slot> <lomId>  -> [route <slot>] -> [prepend id] -> [live.remote~]
 *          remote_val  <slot> <v>      -> [route <slot>] -> [pack f 20]  -> [line~] -> ^
 *
 * WHY THIS EXISTS AT ALL. `.lpf(sine.range(200, 2000))` describes something
 * CONTINUOUS. The obvious implementation - have the app read the pattern on the
 * transport tick and write the parameter - produces about 20 values a second, and it
 * is wrong three times over: the steps are audible, every write fights the automation
 * lane for ownership of the parameter, and the lane fills with the app's own noise.
 * `live.remote~` is Live's answer to exactly this: it takes a SIGNAL and modulates the
 * parameter without writing automation, which is what a modulation source is meant to
 * do.
 *
 * THE `[line~]` IS THE WHOLE TRICK, and it is why this is a chain rather than a bridge
 * call. The app is still control-rate: it can only send a value per tick, and a bare
 * number into live.remote~ would step exactly as badly as a parameter write. A
 * `[line~]` given a 20 ms ramp turns each of those values into a SIGNAL that slides to
 * the next one, so the control-rate stream becomes signal-rate at the Max end and the
 * stepping disappears. The ramp is about one tick long by design: it is still arriving
 * when the next value does, so the ramps chain into a continuous line rather than a
 * staircase with pauses in it.
 *
 * BIND BY LOM ID, AND THE APP OWNS THE BINDING. live.remote~ names its target with an
 * `id <lomId>` message, so the chain does not know or care WHICH parameter a slot
 * drives - the app resolves that (our own filter, or an Auto Filter the user placed by
 * hand) and says so. That is what makes this bigger than an LFO on our own DSP: a slot
 * can point at any parameter in the set. **LOM ids are not stable across set reloads**,
 * so the app must re-bind on load and must never persist a raw id - see the diff rules
 * in doc/TODO.md item 1.
 *
 * NOT IN THE SIGNAL PATH. It touches no audio: `ctx.audioIn`/`setAudioOut` are never
 * called, so `remote` composes with any chain list without taking a stage. It has no
 * neutral for the same reason - an unbound slot modulates nothing.
 *
 * `remotes: <n>` in the manifest declares how many slots. There is no default: a
 * device that asks for this chain and forgets the count would build a patcher with no
 * live.remote~ in it and fail silently at runtime, which is the failure this repo
 * exists to prevent.
 */
function remoteChain(ctx) {
  const { boxes, lines, device } = ctx;
  const n = device?.remotes;
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(
      `chain "remote" on device "${device?.name}" needs \`remotes: <n>\` in the manifest ` +
        `(got ${JSON.stringify(n)}). It is the number of live.remote~ slots to generate, ` +
        `and there is no sensible default - 0 slots is a chain that silently does nothing.`,
    );
  }

  const slots = Array.from({ length: n }, (_, i) => i);
  const slotList = slots.join(" ");
  // `route` needs an outlet per slot, plus the unmatched one it never uses here.
  const slotRoute = { numoutlets: n + 1, outlettype: slots.map(() => "").concat("") };

  boxes.push(box("obj-remote-route", "route remote_bind remote_val", { numoutlets: 3, outlettype: ["", "", ""] }));
  claimAppMessages(ctx, "obj-remote-route", 2);

  // `route` strips the selector, so the SLOT is now the first word of both messages
  // and a second route dispatches on it.
  boxes.push(box("obj-remote-bindroute", `route ${slotList}`, slotRoute));
  boxes.push(box("obj-remote-valroute", `route ${slotList}`, slotRoute));
  lines.push(line("obj-remote-route", 0, "obj-remote-bindroute", 0));
  lines.push(line("obj-remote-route", 1, "obj-remote-valroute", 0));

  for (const slot of slots) {
    const bind = `obj-remote-bind-${slot}`;
    const pack = `obj-remote-pack-${slot}`;
    const ramp = `obj-remote-line-${slot}`;
    const rem = `obj-remote-${slot}`;

    // The binding: `id <lomId>` is how live.remote~ is told what to modulate.
    boxes.push(box(bind, "prepend id"));
    // `<target> <rampMs>` is line~'s list form - the pack is what makes the ramp time
    // ride along with every value, rather than being set once and forgotten.
    boxes.push(box(pack, `pack f ${REMOTE_RAMP_MS}`, { numinlets: 2, numoutlets: 1 }));
    boxes.push(box(ramp, "line~", { numinlets: 2, numoutlets: 2, outlettype: ["signal", "bang"] }));
    boxes.push(box(rem, "live.remote~", { numinlets: 1, numoutlets: 0 }));

    lines.push(line("obj-remote-bindroute", slot, bind, 0));
    lines.push(line(bind, 0, rem, 0));

    lines.push(line("obj-remote-valroute", slot, pack, 0));
    lines.push(line(pack, 0, ramp, 0));
    lines.push(line(ramp, 0, rem, 0));
  }
}

/**
 * "download" - `[maxurl]`, so the app can fetch a file to DISK.
 *
 *   [js] out 1 -> [route maxurl] -> [maxurl] -> [prepend maxurl_done]     -> [js] in 0
 *                                            -> [prepend maxurl_progress] -> [js] in 0
 *
 * The bytes never enter the Max message stream: [js] hands maxurl a request dict
 * carrying `filename_out` and libcurl writes the file itself. What comes back here
 * is only the RESULT - a response dict name, and progress. That is the whole point:
 * [js] is a control plane, not a data plane. See the fetch section of core.ts for
 * the request dict, which is where this feature was actually broken.
 *
 * The request leaves [js] on OUTLET 1 (the aux outlet) rather than outlet 0, which
 * belongs to [jweb]: a `maxurl` message on outlet 0 would be delivered to the web
 * view, which has no idea what to do with it. The [route maxurl] then strips the
 * tag, so what reaches the object is the bare `dictionary <name>` it expects.
 *
 * maxurl has TWO outlets (per its reference page): 0 = the response dictionary,
 * 1 = progress. Not three.
 */
function downloadChain(ctx) {
  const { boxes, lines, unmatchedId } = ctx; // unmatchedId is the wrapper's [js]

  boxes.push(box("obj-maxurl", "maxurl", { numinlets: 2, numoutlets: 2, outlettype: ["", ""] }));

  boxes.push(box("obj-route-maxurl", "route maxurl", { numoutlets: 2, outlettype: ["", ""] }));
  lines.push(line(unmatchedId, 1, "obj-route-maxurl", 0));
  lines.push(line("obj-route-maxurl", 0, "obj-maxurl", 0));

  // Tag both replies, so [js] dispatches them to a handler rather than to
  // anything(), which would swallow them - they arrive as a bare `dictionary
  // <name>` and a bare list otherwise.
  boxes.push(box("obj-prepend-maxurl-done", "prepend maxurl_done"));
  boxes.push(box("obj-prepend-maxurl-progress", "prepend maxurl_progress"));

  lines.push(line("obj-maxurl", 0, "obj-prepend-maxurl-done", 0));
  lines.push(line("obj-maxurl", 1, "obj-prepend-maxurl-progress", 0));

  lines.push(line("obj-prepend-maxurl-done", 0, unmatchedId, 0));
  lines.push(line("obj-prepend-maxurl-progress", 0, unmatchedId, 0));
}

/**
 * "renderplay" - double-buffered, transport-locked loop playback of a rendered WAV pair.
 *
 * This is the Max half of the SUPERDOUGH Rendering design (m4l-strudel
 * doc/IDEA-STRUDEL-INSTRUMENT.md, section D.3). The app renders a Strudel pattern to a
 * WAV, `saveToFile`s it next to the device, then:
 *
 *   app -> render_load <slot> <path> <lengthBeats>  -> [js] resolves path
 *                                                    -> render_replace -> [buffer~ <name>]
 *          render_arm <slot>                         -> swap playback to it at the boundary
 *          render_stop                               -> fade out
 *   app <- render_ready <slot>                       when the WAV finished loading
 *
 * TRANSPORT LOCK - the mechanism, and why THIS one. The design names `phasor~ @lock` as
 * the first idea and flags it UNVERIFIED, because an arbitrary loop length (7 beats, say)
 * does not spell as a note value and the tempo math is fragile. This implements the
 * design's fallback instead: both slots play through [groove~ @loop 1] (the same player
 * the `samples` chain proves), and a control-rate boundary detector HARD RE-SYNCS both
 * grooves to position 0 at every loop boundary. The boundary is read straight off the
 * host transport - [plugsync~] outlet 6 is song position in beats (a signal; the
 * m4l-strudel engine already samples it via [snapshot~]) - so `floor(beats / lengthBeats)`
 * increments exactly once per loop, and [change] turns each increment into the re-sync
 * bang. No tempo arithmetic, no note-value spelling: the loop is pinned to the transport
 * by restarting it on the transport's own beat count. Drift between re-syncs is at most
 * one control tick (~10 ms) and is hidden under the crossfade, which is the fallback's
 * whole point.
 *
 * CROSSFADE, NOT GATING. Both grooves always play, phase-aligned by the shared re-sync;
 * only the [line~] gains move. `render_arm <slot>` stores the target slot; at the next
 * boundary the stored index is read out and each slot's gain ramps to (armed==slot) over
 * 15 ms. So the swap always lands on a loop boundary and a half-faded old loop is never
 * heard mid-cycle.
 *
 * ORIGINATES SOUND, like `samples`: it SUMS into the signal path ([+~]) rather than
 * claiming a stage, and the buffer names are instance-scoped (`deviceBufName`).
 *
 * OPEN (S3, verified in Live, not here): the exact re-sync timing and the equal-power
 * curve of the crossfade are tuning knobs to confirm by ear on real transport; and the
 * first loop before the first boundary bang plays at the initial gains (slot 0 up), so a
 * device should `render_arm` slot 0 once at start. See doc/TEST-CHAIN-RENDERPLAY.md.
 */
function renderplayChain(ctx) {
  const { boxes, lines, device, jwebId, unmatchedId } = ctx;
  const slots = device?.renderSlots;
  if (!Array.isArray(slots) || slots.length !== 2) {
    throw new Error(
      `the "renderplay" chain needs exactly two renderSlots on device "${device?.name}", got ${JSON.stringify(slots)}. ` +
        `It is double-buffered by design: one slot loops while the other loads the next render.`,
    );
  }
  const bufName = (slot) => deviceBufName(device, slot);
  const slotList = slots.join(" ");

  // App stream: claim render_arm / render_stop here; render_load falls through outlet 2
  // to the wrapper (it needs the path resolved, exactly like `samples`' buffer_load).
  boxes.push(box("obj-render-route", "route render_arm render_stop", { numoutlets: 3, outlettype: ["", "", ""] }));
  claimAppMessages(ctx, "obj-render-route", 2);

  // The wrapper resolves the path and hands the load back on its AUX outlet as
  // `render_replace <slot> <absPath>` - one symbol, so Live-library spaces survive.
  boxes.push(box("obj-render-replaceroute", "route render_replace", { numoutlets: 2, outlettype: ["", ""] }));
  lines.push(line(unmatchedId, 1, "obj-render-replaceroute", 0));

  // route strips the selector, so the slot name is the first word now: dispatch per slot.
  const slotOutlets = { numoutlets: slots.length + 1, outlettype: slots.map(() => "").concat("") };
  boxes.push(box("obj-render-loadslot", `route ${slotList}`, slotOutlets));
  lines.push(line("obj-render-replaceroute", 0, "obj-render-loadslot", 0));

  // Boundary clock: the MASTER groove's OWN loop, not the host transport. [plugsync~]
  // outlet 6 (song-position-in-beats) was measured stuck at 0 while the transport played
  // (its outlet semantics differ by host), so timing the loop off it left the whole device
  // silent. groove~'s LAST outlet is a 0..1 sync ramp of loop position, and the groove is
  // the one thing we confirmed is running - so it is the reliable clock. `[<~ 0.5]` turns
  // the ramp into a once-per-loop square (1 in the first half, 0 in the second), and
  // `[edge~]` bangs on its rising edge - which happens right as the ramp wraps to 0, i.e.
  // at the loop boundary. Slot 0 is the master; both slots share the loop length.
  // (Transport-BAR alignment is deferred: the loop is self-clocked, not pinned to Live's
  // bar. Revisit once a host beat source that actually advances is found - S3 open item.)
  boxes.push(box("obj-render-syncgate", "<~ 0.5", { numinlets: 2, numoutlets: 1, outlettype: ["signal"] }));
  boxes.push(box("obj-render-syncedge", "edge~", { numinlets: 1, numoutlets: 2, outlettype: ["bang", "bang"] }));
  boxes.push(box("obj-render-boundary", "t b b", { numinlets: 1, numoutlets: 2, outlettype: ["bang", "bang"] }));
  lines.push(line(`obj-render-groove-${slots[0]}`, 2, "obj-render-syncgate", 0)); // master sync ramp
  lines.push(line("obj-render-syncgate", 0, "obj-render-syncedge", 0));
  lines.push(line("obj-render-syncedge", 0, "obj-render-boundary", 0)); // outlet 0 = rising edge = loop wrap

  // A boundary applies the gains only when a swap is PENDING - the first boundary after an
  // arm (and the first after load). [gate 1 1] starts OPEN so slot 0 fades up on load; the
  // boundary passes its bang through, then CLOSES the gate. So a held selection is not
  // re-ramped every loop - that per-loop re-trigger was the audible tick, and it also fought
  // render_stop (the next boundary kept re-raising the gain the stop had just faded out).
  // An arm re-opens the gate for exactly one boundary; stop closes it and ramps to silence.
  // [t b b] fires right-to-left: the bang goes THROUGH the gate (right) before the gate is
  // closed behind it (left).
  boxes.push(box("obj-render-pending", "gate 1 1", { numinlets: 2, numoutlets: 1, outlettype: ["bang"] }));
  boxes.push(box("obj-render-pendclose", "0", { maxclass: "message", numinlets: 2, numoutlets: 1 }));
  lines.push(line("obj-render-boundary", 1, "obj-render-pending", 1)); // right, first: bang through the gate
  lines.push(line("obj-render-boundary", 0, "obj-render-pendclose", 0)); // left, then: close behind it
  lines.push(line("obj-render-pendclose", 0, "obj-render-pending", 0));
  lines.push(line("obj-render-pending", 0, "obj-render-armed", 0)); // gated bang -> read armed -> gains

  // Armed slot index (0/1): stored cold by an arm, read out by a pending boundary.
  boxes.push(box("obj-render-armed", "i 0", { numinlets: 2, numoutlets: 1, outlettype: ["int"] }));
  boxes.push(box("obj-render-armslot", `route ${slotList}`, slotOutlets));
  lines.push(line("obj-render-route", 0, "obj-render-armslot", 0)); // render_arm <slot>

  // An arm re-opens the pending gate (for the next boundary to apply the swap); a stop
  // closes it (so no boundary re-raises the gain the stop is fading out).
  boxes.push(box("obj-render-pendopen", "1", { maxclass: "message", numinlets: 2, numoutlets: 1 }));
  lines.push(line("obj-render-route", 0, "obj-render-pendopen", 0)); // any render_arm
  lines.push(line("obj-render-pendopen", 0, "obj-render-pending", 0));
  lines.push(line("obj-render-route", 1, "obj-render-pendclose", 0)); // render_stop also closes it

  // Arm stores the target index only (below); the grooves start when their WAV LOADS (so
  // an arm never restarts a playing groove and clicks), and the crossfade gains move at the
  // BOUNDARY, so a swap lands on the loop boundary rather than the instant you click. That
  // makes the transport meaningful: with it stopped there are no boundaries, so nothing
  // becomes audible; start it and the armed slot fades up at the next boundary.

  // Summing buses, per channel: (slotA*gainA) + (slotB*gainB), then + the device input.
  boxes.push(box("obj-render-sumslots-l", "+~", { numinlets: 2, numoutlets: 1, outlettype: ["signal"] }));
  boxes.push(box("obj-render-sumslots-r", "+~", { numinlets: 2, numoutlets: 1, outlettype: ["signal"] }));

  slots.forEach((slot, i) => {
    const buf = `obj-render-buf-${slot}`;
    const groove = `obj-render-groove-${slot}`;

    // buffer~: outlet 1 bangs when a read completes. replace, then report render_ready.
    boxes.push(box(buf, `buffer~ ${bufName(slot)}`, { numinlets: 1, numoutlets: 2, outlettype: ["float", "bang"] }));
    boxes.push(box(`obj-render-replace-${slot}`, "prepend replace"));
    lines.push(line("obj-render-loadslot", i, `obj-render-replace-${slot}`, 0));
    lines.push(line(`obj-render-replace-${slot}`, 0, buf, 0));
    boxes.push(box(`obj-render-ready-${slot}`, `prepend render_ready ${slot}`));
    lines.push(line(buf, 1, `obj-render-ready-${slot}`, 0));
    lines.push(line(`obj-render-ready-${slot}`, 0, jwebId, 0));
    // Start this groove looping the moment its WAV has loaded (buffer~ read-complete bang).
    // It free-runs from here via @loop 1; the gain stays 0 until a boundary raises it.
    lines.push(line(buf, 1, `obj-render-resync-${slot}`, 0));

    // Player: [groove~ <buf> 2 @loop 1] at rate 1 (the WAV's own tempo; a tempo change is
    // a full re-render, so rate stays 1). Two signal outlets = L/R.
    boxes.push(box(`obj-render-rate-${slot}`, "sig~ 1.", { numinlets: 1, numoutlets: 1, outlettype: ["signal"] }));
    boxes.push(box(groove, `groove~ ${bufName(slot)} 2 @loop 1`, { numinlets: 3, numoutlets: 3, outlettype: ["signal", "signal", "signal"] }));
    lines.push(line(`obj-render-rate-${slot}`, 0, groove, 0));

    // Start message: a bare `0` (a start position in ms) into groove~'s left inlet starts
    // the loop from the top. Banged once, from the buffer read-complete above.
    boxes.push(box(`obj-render-resync-${slot}`, "0", { maxclass: "message", numinlets: 2, numoutlets: 1 }));
    lines.push(line(`obj-render-resync-${slot}`, 0, groove, 0));

    // Gain: this slot's target = (armed == i). At the boundary the armed index is read
    // out, [== i] gives 0/1, [pack <v> 50] makes the `<target> 50ms` list for [line~] - a
    // short equal-ish crossfade at the boundary.
    boxes.push(box(`obj-render-istarget-${slot}`, `expr $i1 == ${i}`, { numinlets: 1, numoutlets: 1, outlettype: ["int"] }));
    boxes.push(box(`obj-render-gainpack-${slot}`, "pack 0. 400", { numinlets: 2, numoutlets: 1, outlettype: [""] }));
    boxes.push(box(`obj-render-gain-${slot}`, "line~", { numinlets: 2, numoutlets: 1, outlettype: ["signal"] }));
    lines.push(line("obj-render-armed", 0, `obj-render-istarget-${slot}`, 0));
    lines.push(line(`obj-render-istarget-${slot}`, 0, `obj-render-gainpack-${slot}`, 0));
    lines.push(line(`obj-render-gainpack-${slot}`, 0, `obj-render-gain-${slot}`, 0));

    // render_stop: ramp this slot's gain to 0 over 500 ms - a clearly audible fade. The
    // pending gate (closed by stop) keeps the next boundary from re-raising it.
    boxes.push(box(`obj-render-stopgain-${slot}`, "0. 500", { maxclass: "message", numinlets: 2, numoutlets: 1 }));
    lines.push(line("obj-render-route", 1, `obj-render-stopgain-${slot}`, 0));
    lines.push(line(`obj-render-stopgain-${slot}`, 0, `obj-render-gain-${slot}`, 0));

    // Apply the gain to each channel, then sum into the per-channel bus.
    const mulL = `obj-render-mul-l-${slot}`;
    const mulR = `obj-render-mul-r-${slot}`;
    boxes.push(box(mulL, "*~", { numinlets: 2, numoutlets: 1, outlettype: ["signal"] }));
    boxes.push(box(mulR, "*~", { numinlets: 2, numoutlets: 1, outlettype: ["signal"] }));
    lines.push(line(groove, 0, mulL, 0));
    lines.push(line(groove, 1, mulR, 0));
    lines.push(line(`obj-render-gain-${slot}`, 0, mulL, 1));
    lines.push(line(`obj-render-gain-${slot}`, 0, mulR, 1));
    lines.push(line(mulL, 0, "obj-render-sumslots-l", i));
    lines.push(line(mulR, 0, "obj-render-sumslots-r", i));

    // Arm: store this slot's index (cold) in [i]. That is ALL an arm does - it queues the
    // target. The next transport boundary reads it out and fades the gains, so the swap
    // lands on the loop boundary, not the instant you click. lengthBeats rode in on
    // render_load and reaches the boundary detector's cold inlet via render_len below.
    boxes.push(box(`obj-render-armidx-${slot}`, `${i}`, { maxclass: "message", numinlets: 2, numoutlets: 1 }));
    lines.push(line("obj-render-armslot", i, `obj-render-armidx-${slot}`, 0));
    lines.push(line(`obj-render-armidx-${slot}`, 0, "obj-render-armed", 1)); // cold store, no output
  });

  // render_len still arrives from the wrapper (it carries lengthBeats alongside the path)
  // but the self-clocked boundary no longer needs it: a [route render_len] swallows it so
  // it does not fall through to the wrapper as an unknown message. (Kept for when
  // transport-bar alignment returns and wants the loop length again.)
  boxes.push(box("obj-render-lenroute", "route render_len", { numoutlets: 2, outlettype: ["", ""] }));
  lines.push(line(unmatchedId, 1, "obj-render-lenroute", 0));

  // Sum the two per-channel buses onto the device's signal path and become its tail.
  for (const [ch, sumId] of [
    [0, "obj-render-sumslots-l"],
    [1, "obj-render-sumslots-r"],
  ]) {
    const [srcId, srcOut] = ctx.audioIn(ch);
    const outId = `obj-render-out-${ch}`;
    boxes.push(box(outId, "+~", { numinlets: 2, numoutlets: 1, outlettype: ["signal"] }));
    lines.push(line(srcId, srcOut, outId, 0)); // the device input (silence on an instrument)
    lines.push(line(sumId, 0, outId, 1)); // the rendered mix
    ctx.setAudioOut(ch, outId, 0);
  }

  // KNOWN MINOR ARTIFACT (S3): a faint tick at the loop wrap, from [groove~]'s loop-point
  // interpolation. The WAV loops seamlessly (whole-cycle sine, matched value AND slope at
  // the seam) and the gains are no longer re-triggered per loop, so this is groove~ itself
  // reading across the boundary. It is worst on a pure sine (the hardest case for loop
  // clicks) and is typically inaudible on real rendered content. Proper declick, if ever
  // needed on real material: drive playback from a [phasor~] into [play~]/[wave~], or bake a
  // few-ms equal-power loop crossfade into the render. Deferred - not worth it on a tone.
}

/**
 * "samples" - the first chain that ORIGINATES a sound: a named [buffer~] per slot,
 * loaded from a file on disk, played back through [groove~] into the signal path.
 *
 *   app -> buffer_load <slot> <path>  -> [js] (resolves the path)
 *                                     -> buffer_replace -> [buffer~ <name>]
 *          buffer_play <slot>         -> [groove~] set + play
 *          buffer_stop                -> [groove~] stop
 *   app <- buffer_ready <slot> <sr> <ms> <chans>   when the read actually completed
 *          buffer_error <slot> <msg>                when there was no file to read
 *
 * THE BYTES NEVER CROSS THE BRIDGE. [buffer~] reads the file itself; what travels in
 * Max messages is a path and, coming back, a description of what landed - the same
 * rule the `download` chain follows, which is how you get the file there in the
 * first place.
 *
 * WAV/AIFF/Next-Sun ONLY. [buffer~]'s `read`/`replace` does not take MP3 - that list
 * (MP3, OGG, FLAC, M4A) is [sfplay~]'s, which streams from disk rather than filling a
 * buffer, and is therefore a different chain. A format it cannot read is an error in
 * the Max console and NO bang, so the app's promise times out rather than lying.
 *
 * WHAT LOADED IS NOT WHAT YOU ASKED FOR, so the chain reports what it GOT. `replace`
 * resizes the buffer and adopts the FILE's channel count and sample rate, so a slot
 * is not mono because you wanted it to be. [info~] is banged from the buffer's own
 * "read completed" outlet (outlet 1 - outlet 0 is a mouse position in the editing
 * window) and reports sample rate, duration and channels; the app derives frames from
 * those. A frame count on its own is not proof of a read: a failed `replace` leaves
 * the PREVIOUS contents in place, so "there are samples in there" says nothing. The
 * bang does - it only fires when a read completed - and until it does the app's
 * promise is still open (see loadSample() in @m4l-jweb/bridge, which is where the
 * timeout lives).
 *
 * info~'s outlets fire right-to-left, so the LAST one to arrive is outlet 0, the
 * sample rate - which is therefore the one wired to [pack]'s hot inlet. Wire it the
 * other way round and the message goes out carrying the PREVIOUS load's numbers.
 *
 * ONE VOICE, DELIBERATELY. `groove~` takes `set <buffer-name>` to switch buffers, so
 * one stereo player covers N slots: this is a PREVIEW - the sample browser's "let me
 * hear it, through the track" - not a sampler. Polyphony is the `instrument` chain,
 * and it is still open (doc/TODO.md item 2).
 *
 * It SUMS into the signal path rather than claiming it ([+~]), because it makes sound
 * of its own: on an audio effect the preview plays over the track's audio, and on an
 * instrument there is nothing at the input to add.
 *
 * The buffer names are INSTANCE-SCOPED (`deviceBufName`, `---buf-<device>-<slot>`), so
 * two copies of this device on two tracks own separate buffers. They used to be global
 * to Max and generated from the device name alone, which meant the second copy loaded
 * silently stole the first's samples.
 *
 * Slots default to one, named "preview". `slots: ["kick", "snare"]` in the manifest
 * gives you more.
 */
function samplesChain(ctx) {
  const { boxes, lines, device, jwebId, unmatchedId } = ctx;
  const slots = device?.slots ?? ["preview"];
  // Instance-scoped, for the same reason the instrument's are: two copies of a preview
  // device on two tracks are two devices, and a global name would hand both the same
  // buffer. `---` expands per device instance in Live - see deviceBufName.
  const bufName = (slot) => deviceBufName(device, slot);

  // `buffer_load` is NOT claimed from [jweb]. It goes on to the wrapper, which
  // resolves the path and hands it back on its AUX OUTLET as `buffer_replace <slot>
  // <abs path>` - the same shape the `download` chain takes `maxurl` in.
  //
  // The detour is the whole fix. The app writes a path relative to the device's
  // folder (that is where fetchToFile puts the file), and [buffer~] does not resolve
  // it that way: a bare name is looked up in MAX'S SEARCH PATH, which the device's
  // folder is not in, so a file that was downloaded correctly reports "can't open".
  // The resolved path then contains SPACES on a normal Live install ("Ableton
  // Library"), and a path travelling through the patcher as message text would split
  // there into atoms. Out of [js] it stays one symbol.
  boxes.push(box("obj-samples-route", "route buffer_play buffer_stop", { numoutlets: 3, outlettype: ["", "", ""] }));
  claimAppMessages(ctx, "obj-samples-route", 2);

  boxes.push(box("obj-samples-replaceroute", "route buffer_replace", { numoutlets: 2, outlettype: ["", ""] }));
  lines.push(line(unmatchedId, 1, "obj-samples-replaceroute", 0));

  // `route` strips the selector, so the slot name is now the first word of both
  // remaining messages: a second route per stream dispatches on it.
  const slotList = slots.join(" ");
  const slotOutlets = { numoutlets: slots.length + 1, outlettype: slots.map(() => "").concat("") };
  boxes.push(box("obj-samples-loadslot", `route ${slotList}`, slotOutlets));
  boxes.push(box("obj-samples-playslot", `route ${slotList}`, slotOutlets));
  lines.push(line("obj-samples-replaceroute", 0, "obj-samples-loadslot", 0));
  lines.push(line("obj-samples-route", 0, "obj-samples-playslot", 0));

  // The player. `groove~ <buffer> 2` = two signal outlets (plus a loop-sync outlet),
  // and it MIXES a buffer with more channels down rather than dropping them.
  // @loop 0 makes it a one-shot: a preview that loops forever is a preview you have
  // to fight. [sig~ 1.] is the playback rate, in the left inlet, which is a SIGNAL
  // inlet - a float there means something else entirely (a position, in ms).
  boxes.push(box("obj-samples-rate", "sig~ 1.", { numinlets: 1, numoutlets: 1, outlettype: ["signal"] }));
  boxes.push(
    box("obj-samples-groove", `groove~ ${bufName(slots[0])} 2 @loop 0`, {
      numinlets: 3,
      numoutlets: 3,
      outlettype: ["signal", "signal", "signal"],
    }),
  );
  lines.push(line("obj-samples-rate", 0, "obj-samples-groove", 0));

  // MONO FOLD. `groove~ <buf> 2` hard-wires two signal outlets to L and R, and a
  // MONO buffer drives outlet 0 ONLY - so a mono file (most of tidal-drum-machines
  // is mono) plays in one ear. The channel count is not a build-time fact: [info~]
  // MEASURES it when the buffer loads. So gate the R channel at RUNTIME - a
  // [selector~ 2] whose control says which groove~ outlet is the real right channel:
  //   input 1 = groove~ outlet 1 (a stereo file's true R)
  //   input 2 = groove~ outlet 0 (fold the mono signal to R as well)
  // The control is the currently-loaded slot's channel count run through
  // [expr ($i1==1)+1]: mono(1) -> 2 (fold), stereo(2) -> 1 (real R). The L channel
  // always takes groove~ outlet 0, so it needs no gate.
  boxes.push(box("obj-samples-rsel", "selector~ 2", { numinlets: 3, numoutlets: 1, outlettype: ["signal"] }));
  boxes.push(box("obj-samples-rgate", "expr ($i1==1)+1", { numinlets: 1, numoutlets: 1, outlettype: ["int"] }));
  lines.push(line("obj-samples-groove", 1, "obj-samples-rsel", 1)); // stereo R -> input 1
  lines.push(line("obj-samples-groove", 0, "obj-samples-rsel", 2)); // mono fold -> input 2
  lines.push(line("obj-samples-rgate", 0, "obj-samples-rsel", 0)); // which one, per loaded slot

  // Stop: a bare `buffer_stop` arrives from [route] as a BANG - the word is gone -
  // so re-materialize it in a message box, or groove~ hears nothing it knows.
  boxes.push(box("obj-samples-stopmsg", "stop", { maxclass: "message", numinlets: 2, numoutlets: 1 }));
  lines.push(line("obj-samples-route", 1, "obj-samples-stopmsg", 0));
  lines.push(line("obj-samples-stopmsg", 0, "obj-samples-groove", 0));

  slots.forEach((slot, i) => {
    const buf = `obj-samples-buf-${slot}`;
    const info = `obj-samples-info-${slot}`;

    // buffer~: outlet 0 is a mouse position, outlet 1 is the bang on a completed
    // read. Only the second one means anything here.
    boxes.push(box(buf, `buffer~ ${bufName(slot)}`, { numinlets: 1, numoutlets: 2, outlettype: ["float", "bang"] }));
    boxes.push(box(`obj-samples-replace-${slot}`, "prepend replace"));
    lines.push(line("obj-samples-loadslot", i, `obj-samples-replace-${slot}`, 0));
    lines.push(line(`obj-samples-replace-${slot}`, 0, buf, 0));

    // What actually landed. info~'s outlets: 0 = sample rate, 6 = duration in ms,
    // 8 = number of channels (per its reference page - do not count them from
    // memory). They fire right-to-left, so 0 arrives last and is the hot one.
    boxes.push(
      box(info, `info~ ${bufName(slot)}`, {
        numinlets: 1,
        numoutlets: 10,
        outlettype: ["float", "list", "float", "float", "float", "float", "float", "", "int", ""],
      }),
    );
    boxes.push(box(`obj-samples-pack-${slot}`, "pack 0. 0. 0", { numinlets: 3, numoutlets: 1, outlettype: [""] }));
    boxes.push(box(`obj-samples-ready-${slot}`, `prepend buffer_ready ${slot}`));

    lines.push(line(buf, 1, info, 0)); // the read completed - ask what it was
    lines.push(line(info, 8, `obj-samples-pack-${slot}`, 2)); // channels (fires first)
    lines.push(line(info, 6, `obj-samples-pack-${slot}`, 1)); // duration, ms
    lines.push(line(info, 0, `obj-samples-pack-${slot}`, 0)); // sample rate - hot, last
    lines.push(line(`obj-samples-pack-${slot}`, 0, `obj-samples-ready-${slot}`, 0));
    lines.push(line(`obj-samples-ready-${slot}`, 0, jwebId, 0));

    // Retain THIS slot's measured channel count, so play can re-assert the mono
    // fold for whichever buffer is loaded into the one shared groove~. [info~]
    // outlet 8 stores it in [f]'s cold inlet (no output); the play trigger bangs it
    // out to the shared gate below. Every slot's [f] feeds that one gate.
    boxes.push(box(`obj-samples-chans-${slot}`, "f", { numinlets: 2, numoutlets: 1, outlettype: [""] }));
    lines.push(line(info, 8, `obj-samples-chans-${slot}`, 1)); // measured channels, cold-stored
    lines.push(line(`obj-samples-chans-${slot}`, 0, "obj-samples-rgate", 0));

    // Play: pick the buffer, THEN start it. Two cords out of one outlet fire in an
    // order Max chooses, so the sequence goes through a [t b b] - right outlet
    // first - and never through a fan-out. Starting the OLD buffer and then
    // switching is exactly the bug that looks like "the wrong sample previewed".
    boxes.push(box(`obj-samples-trig-${slot}`, "t b b b", { numinlets: 1, numoutlets: 3, outlettype: ["bang", "bang", "bang"] }));
    boxes.push(box(`obj-samples-set-${slot}`, `set ${bufName(slot)}`, { maxclass: "message", numinlets: 2, numoutlets: 1 }));
    // A float in groove~'s left inlet is a playback POSITION in ms, and 0 is "from
    // the beginning" - which is also what starts it after a `stop`.
    boxes.push(box(`obj-samples-start-${slot}`, "0", { maxclass: "message", numinlets: 2, numoutlets: 1 }));

    // [t] fires right-to-left, so: set the fold gate, THEN the buffer, THEN start -
    // the gate and the buffer are both in place before groove~ makes a sound.
    lines.push(line("obj-samples-playslot", i, `obj-samples-trig-${slot}`, 0));
    lines.push(line(`obj-samples-trig-${slot}`, 2, `obj-samples-chans-${slot}`, 0)); // first: assert the fold
    lines.push(line(`obj-samples-trig-${slot}`, 1, `obj-samples-set-${slot}`, 0)); // then: set the buffer
    lines.push(line(`obj-samples-trig-${slot}`, 0, `obj-samples-start-${slot}`, 0)); // ...then play it
    lines.push(line(`obj-samples-set-${slot}`, 0, "obj-samples-groove", 0));
    lines.push(line(`obj-samples-start-${slot}`, 0, "obj-samples-groove", 0));
  });

  // Sum into the signal path: this chain MAKES sound, it does not process what came
  // before. Claiming the stage instead would silence the track the preview plays over.
  for (const [ch, id] of [
    [0, "obj-samples-mix-l"],
    [1, "obj-samples-mix-r"],
  ]) {
    const [srcId, srcOut] = ctx.audioIn(ch);
    boxes.push(box(id, "+~", { numinlets: 2, numoutlets: 1, outlettype: ["signal"] }));
    lines.push(line(srcId, srcOut, id, 0));
    // L takes groove~ outlet 0 directly; R takes the mono-fold [selector~] instead
    // of groove~ outlet 1, so a mono buffer reaches both ears.
    if (ch === 0) lines.push(line("obj-samples-groove", 0, id, 1));
    else lines.push(line("obj-samples-rsel", 0, id, 1));
    ctx.setAudioOut(ch, id, 0);
  }
}

/**
 * "delay" - a feedback delay, sent from a dry/wet knob: `.delay()`, `.delaytime()`
 * and `.delayfeedback()` mapped straight onto Max's delay line.
 *
 *   dry -->[+~ fbsum]-->[tapin~ 2000]-->[tapout~ 250]--+--> wet
 *           ^                                          |
 *           +----------[*~ feedback]<-----------------+
 *   out = dry + delay * wet
 *
 * SEND-STYLE, WHICH IS WHAT MAKES IT NEUTRAL. The dry input reaches the output
 * summing [+~] at UNITY, untouched; the delayed signal is scaled by the `delay`
 * mix and added on top. At `delay` = 0 the wet [*~] contributes exactly 0.0, so the
 * output is bit-for-bit the input - a straight wire, which is the neutrality
 * contract this chain declares in CHAIN_NEUTRAL below. That is the whole reason a
 * wet path is SUMMED rather than crossfaded: `dry + 0` is identity, `dry*1 + wet*0`
 * is too but invites a `1 - mix` no one can null-test by eye.
 *
 * tapin~/tapout~, per Max's reference (read on disk, not remembered): tapin~ writes
 * a signal into a delay line; tapout~ reads it back, and the connection between them
 * is NOT a signal cord - it is the delay-line link. tapout~'s inlet 0 takes BOTH
 * that link and the delay time (a float in ms), the same way groove~'s left inlet
 * takes a signal and messages at once. `tapin~ 2000` sizes the line to the top of
 * `delaytime`'s range; a delay time past the max is silently clamped, so the max is
 * a real limit, not decoration.
 *
 * Feedback closes the loop THROUGH a [+~] before tapin~, so the delayed signal is
 * re-injected with the dry input rather than replacing it. At `delayfeedback` = 0
 * the loop gain is 0 and you get a single echo.
 *
 * Requires `delay`, `delaytime`, `delayfeedback` in the device's surface (or point
 * the chain at other names with `delayParam` / `delaytimeParam` /
 * `delayfeedbackParam`). All in REAL units: the mix and feedback are 0-1, the time
 * is in ms - the chain does no arithmetic on any of them.
 */
function delayChain(ctx) {
  const { boxes, lines, device } = ctx;
  const mixParam = requireParam(ctx, "delay", device?.delayParam ?? "delay", "delayParam");
  const timeParam = requireParam(ctx, "delay", device?.delaytimeParam ?? "delaytime", "delaytimeParam");
  const fbParam = requireParam(ctx, "delay", device?.delayfeedbackParam ?? "delayfeedback", "delayfeedbackParam");

  for (const [ch, s] of [
    [0, "l"],
    [1, "r"],
  ]) {
    const [srcId, srcOut] = ctx.audioIn(ch);
    const fbsum = `obj-delay-fbsum-${s}`;
    const tin = `obj-delay-tapin-${s}`;
    const tout = `obj-delay-tapout-${s}`;
    const fb = `obj-delay-fb-${s}`;
    const wet = `obj-delay-wet-${s}`;
    const mix = `obj-delay-mix-${s}`;

    boxes.push(box(fbsum, "+~", { numinlets: 2, numoutlets: 1, outlettype: ["signal"] }));
    boxes.push(box(tin, "tapin~ 2000", { numinlets: 1, numoutlets: 1, outlettype: ["signal"] }));
    boxes.push(box(tout, "tapout~ 250", { numinlets: 1, numoutlets: 1, outlettype: ["signal"] }));
    // A float, not int - the feedback and wet gains start at 0.0 so the stage is a
    // wire until its parameters load, and the right inlets stay in float mode.
    boxes.push(box(fb, "*~ 0.", { numinlets: 2, numoutlets: 1, outlettype: ["signal"] }));
    boxes.push(box(wet, "*~ 0.", { numinlets: 2, numoutlets: 1, outlettype: ["signal"] }));
    boxes.push(box(mix, "+~", { numinlets: 2, numoutlets: 1, outlettype: ["signal"] }));

    // dry (+ feedback) into the delay line
    lines.push(line(srcId, srcOut, fbsum, 0));
    lines.push(line(fb, 0, fbsum, 1));
    lines.push(line(fbsum, 0, tin, 0));
    lines.push(line(tin, 0, tout, 0)); // the delay-line link, not a signal cord
    fanParamInto(ctx, timeParam, tout, 0); // delay time, ms, into tapout~'s inlet

    // feedback loop: the tap, scaled, back to the sum
    lines.push(line(tout, 0, fb, 0));
    fanParamInto(ctx, fbParam, fb, 1);

    // the send: dry at unity + the tap scaled by `delay`
    lines.push(line(tout, 0, wet, 0));
    fanParamInto(ctx, mixParam, wet, 1);
    lines.push(line(srcId, srcOut, mix, 0));
    lines.push(line(wet, 0, mix, 1));
    ctx.setAudioOut(ch, mix, 0);
  }
}

/**
 * "reverb" - `cverb~` sent from a dry/wet knob (`.room()`).
 *
 *   dry --+--------------------> [+~ mix] --> out
 *         |                        ^
 *         +-->[cverb~]-->[*~ room]-+
 *
 * cverb~ SHIPS INSIDE LIVE (`resources/externals/m4l/cverb~.mxe64`, checked on disk)
 * and is MONAURAL and WET-ONLY: its output is pure reverberation, no dry component.
 * A wet-only object dropped straight in the path is a colouration you cannot switch
 * off - the exact trap the neutrality contract exists to forbid. So the dry/wet is a
 * property of THIS chain, not something a device is trusted to remember: the dry
 * signal reaches the output [+~] at unity, and the reverb is scaled by `room` and
 * summed on top. At `room` = 0 the wet [*~] is 0.0 and the output is the input,
 * bit-for-bit (CHAIN_NEUTRAL below).
 *
 * Mono, so one cverb~ per channel. The reverb TIME is fixed at the object's argument
 * - the `fx` surface exposes only the send (`room`), not a time - so there is no
 * parameter for it; add one and fan it into inlet 1 (signal/float, reverb time in
 * ms, per the reference) if a device wants it.
 *
 * Requires `room` in the device's surface (or `roomParam`), 0-1.
 */
function reverbChain(ctx) {
  const { boxes, lines, device } = ctx;
  const mixParam = requireParam(ctx, "reverb", device?.roomParam ?? "room", "roomParam");

  for (const [ch, s] of [
    [0, "l"],
    [1, "r"],
  ]) {
    const [srcId, srcOut] = ctx.audioIn(ch);
    const rv = `obj-reverb-cverb-${s}`;
    const wet = `obj-reverb-wet-${s}`;
    const mix = `obj-reverb-mix-${s}`;

    boxes.push(box(rv, "cverb~ 2000.", { numinlets: 2, numoutlets: 1, outlettype: ["signal"] }));
    boxes.push(box(wet, "*~ 0.", { numinlets: 2, numoutlets: 1, outlettype: ["signal"] }));
    boxes.push(box(mix, "+~", { numinlets: 2, numoutlets: 1, outlettype: ["signal"] }));

    lines.push(line(srcId, srcOut, rv, 0));
    lines.push(line(rv, 0, wet, 0));
    fanParamInto(ctx, mixParam, wet, 1);
    lines.push(line(srcId, srcOut, mix, 0)); // dry at unity
    lines.push(line(wet, 0, mix, 1)); // + reverb scaled by `room`
    ctx.setAudioOut(ch, mix, 0);
  }
}

/**
 * The [poly~] voice patch: ONE played note, start to finish, as its own patcher.
 *
 * [poly~] loads N copies of this and hands each `note` message to the first voice
 * whose [thispoly~] is not busy - so polyphony and voice-stealing are Max's job, not
 * the app's, which is the whole reason to spend a [poly~] rather than run N groove~s
 * and a scheduler by hand. Max cannot embed this inline (no factory device does; they
 * all ship it as a named .maxpat), so the build freezes it into the .amxd as a
 * dependency and [poly~] resolves it by name from the device's own bundle - the same
 * way `Analogue Drums.amxd` carries `analog.Kick~.maxpat` (checked on disk).
 *
 * MULTI-SAMPLE. A voice can play ANY of the device's slots - one named [buffer~] per
 * slot - so the instrument is a keymap, not one repitched sample. The voice request at
 * [in 1] is the list `slot rate velocity durMs channels`:
 *   - slot       -> which buffer: [sel 0 1 ...] picks the matching `set <bufName>`
 *                   message, so groove~ switches to that slot's buffer before it starts.
 *   - rate       -> playback RATE straight into [sig~] -> groove~'s left (signal) inlet.
 *                   EXPLICIT, not derived: the app decides whether a note plays a
 *                   dedicated sample at rate 1 or a repitched one at rate 2, which is
 *                   what makes this a multi-sample keymap rather than one stretched
 *                   buffer. No pitch->rate arithmetic here.
 *   - velocity   -> amplitude, /127, on both channels' [*~].
 *   - durMs      -> when to FREE the voice: [delay durMs] -> 0 to [thispoly~] and
 *                   `stop` to groove~. The app times the note; Max holds the voice
 *                   exactly that long. A one-shot past the sample's end is silent
 *                   anyway (@loop 0), so this only bounds the allocation.
 *   - channels   -> the mono fold, the SAME runtime gate the samples chain uses: a
 *                   mono buffer drives groove~ outlet 0 only, so a [selector~ 2] keyed
 *                   on the measured channel count folds it into R (see samplesChain).
 *
 * The order is sequenced with [t]: the whole list reaches [unpack] (buffer selected,
 * rate, gate and duration all set) BEFORE the voice marks itself busy and starts
 * groove~ from 0. Buffer-select is separate from start - `set <buf>` switches the
 * buffer WITHOUT playing, and only the seq's `0` starts it - so a note never begins on
 * the previous note's buffer or rate.
 */
function instrumentVoicePatch(bufNames) {
  let vy = 40;
  const vbox = (id, text, extra = {}) => ({
    box: { id, maxclass: "newobj", text, numinlets: 1, numoutlets: 1, outlettype: [""], patching_rect: [24, (vy += 30), 150, 22], ...extra },
  });
  const vmsg = (id, text) => ({
    box: { id, maxclass: "message", text, numinlets: 2, numoutlets: 1, outlettype: [""], patching_rect: [200, (vy += 30), 90, 22] },
  });

  const L = (s, so, d, di) => ({ patchline: { source: [s, so], destination: [d, di] } });

  const boxes = [
    vbox("v-in", "in 1", { numinlets: 0, numoutlets: 1 }),
    vbox("v-trig", "t b l", { numoutlets: 2, outlettype: ["bang", ""] }),
    vbox("v-unpack", "unpack 0 0. 0 0 0", { numoutlets: 5, outlettype: ["int", "float", "int", "int", "int"] }),
    vbox("v-seq", "t b b", { numoutlets: 2, outlettype: ["bang", "bang"] }),
    vmsg("v-busy", "1"),
    vmsg("v-start", "0"),
    vbox("v-thispoly", "thispoly~", { numoutlets: 2, outlettype: ["int", "int"] }),
    // slot -> which buffer. [sel] fires the matching outlet; the last (rightmost) is
    // the no-match passthrough, left unwired.
    vbox("v-sel", `sel ${bufNames.map((_, i) => i).join(" ")}`, { numoutlets: bufNames.length + 1, outlettype: bufNames.map(() => "bang").concat("") }),
    vbox("v-sig", "sig~", { numoutlets: 1, outlettype: ["signal"] }),
    vbox("v-vel", "/ 127.", { outlettype: ["float"] }),
    // groove~ starts on the FIRST slot's buffer; `set` switches it per note.
    vbox("v-groove", `groove~ ${bufNames[0]} 2 @loop 0`, { numinlets: 3, numoutlets: 3, outlettype: ["signal", "signal", "signal"] }),
    vbox("v-gate", "expr ($i1==1)+1", { outlettype: ["int"] }),
    vbox("v-rsel", "selector~ 2", { numinlets: 3, numoutlets: 1, outlettype: ["signal"] }),
    vbox("v-ampL", "*~", { numinlets: 2, numoutlets: 1, outlettype: ["signal"] }),
    vbox("v-ampR", "*~", { numinlets: 2, numoutlets: 1, outlettype: ["signal"] }),
    vbox("v-del", "delay", { numinlets: 2, numoutlets: 1, outlettype: ["bang"] }),
    vbox("v-free", "t b b", { numoutlets: 2, outlettype: ["bang", "bang"] }),
    vmsg("v-freebusy", "0"),
    vmsg("v-stop", "stop"),
    vbox("v-out1", "out~ 1", { numinlets: 1, numoutlets: 0 }),
    vbox("v-out2", "out~ 2", { numinlets: 1, numoutlets: 0 }),
  ];

  const lines = [
    L("v-in", 0, "v-trig", 0),
    // list first (right outlet), then the start sequence (left) - values before play.
    L("v-trig", 1, "v-unpack", 0),
    L("v-trig", 0, "v-seq", 0),
    L("v-unpack", 0, "v-sel", 0), // slot -> pick a buffer
    L("v-unpack", 1, "v-sig", 0), // rate (explicit) -> signal rate
    L("v-sig", 0, "v-groove", 0),
    L("v-unpack", 2, "v-vel", 0), // velocity -> amp
    L("v-vel", 0, "v-ampL", 1),
    L("v-vel", 0, "v-ampR", 1),
    L("v-unpack", 3, "v-del", 1), // duration -> delay time (cold)
    L("v-unpack", 4, "v-gate", 0), // channels -> mono fold gate
    L("v-gate", 0, "v-rsel", 0),
    // the start sequence: mark busy, then start groove~ from 0 AND arm the free timer.
    L("v-seq", 1, "v-busy", 0),
    L("v-busy", 0, "v-thispoly", 0),
    L("v-seq", 0, "v-start", 0),
    L("v-start", 0, "v-groove", 0),
    L("v-seq", 0, "v-del", 0), // bang the delay: it fires after durMs
    // groove~ out: L direct, R via the mono-fold selector (stereo R vs. folded mono).
    L("v-groove", 0, "v-ampL", 0),
    L("v-groove", 1, "v-rsel", 1), // stereo R
    L("v-groove", 0, "v-rsel", 2), // mono fold
    L("v-rsel", 0, "v-ampR", 0),
    L("v-ampL", 0, "v-out1", 0),
    L("v-ampR", 0, "v-out2", 0),
    // free the voice when the note's duration elapses.
    L("v-del", 0, "v-free", 0),
    L("v-free", 1, "v-freebusy", 0),
    L("v-freebusy", 0, "v-thispoly", 0),
    L("v-free", 0, "v-stop", 0),
    L("v-stop", 0, "v-groove", 0),
  ];

  // One `set <buffer>, ` message per slot: [sel] outlet i switches groove~ to that
  // slot's buffer WITHOUT starting it (the seq's `0` does that). A trailing comma
  // would start it; there is none, deliberately.
  bufNames.forEach((buf, i) => {
    const setId = `v-set-${i}`;
    boxes.push(vmsg(setId, `set ${buf}`));
    lines.push(L("v-sel", i, setId, 0));
    lines.push(L(setId, 0, "v-groove", 0));
  });

  return {
    patcher: {
      fileversion: 1,
      appversion: { major: 8, minor: 0, revision: 0, architecture: "x64", modernui: 1 },
      rect: [100, 100, 320, 600],
      boxes,
      lines,
    },
  };
}

/**
 * "instrument" - the marquee: a [poly~] of sample voices over a KEYMAP of named
 * buffers, PLAYED by the note contract the bridge exports. `samples` made the first
 * sound as ONE preview voice; this is the other half - N voices, N buffers, Max doing
 * the allocation and stealing.
 *
 *   app -> voice_play <slot> <rate> <vel> <durMs> <chans>  -> [route] -> [prepend note] -> [poly~]
 *          buffer_load <slot> <path>                       -> [js] resolves -> [buffer~ <slot>]
 *   app <- buffer_ready <slot> <sr> <ms> <chans>            when that slot's read completed
 *
 * The load path is the samples chain's, deliberately: the bytes never cross the bridge
 * ([buffer~] reads the file, the wrapper resolves the path on its aux outlet), and the
 * reply reports what [info~] MEASURED, not what was asked for. Every slot is its own
 * named [buffer~]; the voice picks one per note by index and plays it at the rate the
 * app chose - so a dedicated sample plays at rate 1 and a repitched one at rate 2,
 * which is the app's decision, not the chain's.
 *
 * `slots: ["c", "e", "g"]` in the manifest is three buffers; the default is one
 * ("voice"). The buffer names are INSTANCE-SCOPED (`deviceBufName`): each copy of the
 * device owns its own, which is what lets a drum rack exist on two tracks at once.
 * `---` scopes per DEVICE, so the voice spells the same name the device does - see
 * deviceBufName.
 *
 * It SUMS into the signal path ([+~]): an instrument makes sound where there was none
 * at its input, so there is nothing to claim a stage over.
 */
function instrumentChain(ctx) {
  const { boxes, lines, device, jwebId, unmatchedId } = ctx;
  const slots = device?.slots ?? ["voice"];
  const bufName = (slot) => deviceBufName(device, slot);
  const voices = device?.voices ?? 8;
  const voiceFile = `${device?.name}-voice.maxpat`;

  // The frozen voice patch (a keymap of every slot's buffer), and the [poly~] that
  // loads N copies of it. The voice spells the buffers exactly as the device does:
  // `---` is device-scoped, so no id travels through poly~'s arguments.
  ctx.extras.push({ name: voiceFile, data: instrumentVoicePatch(slots.map((s) => voiceBufName(device, s))) });
  // [poly~]'s name is the file WITHOUT its extension, per Max's abstraction lookup.
  boxes.push(
    box(`obj-instr-poly`, `poly~ ${voiceFile.replace(/\.maxpat$/, "")} ${voices}`, {
      numinlets: 1,
      numoutlets: 2,
      outlettype: ["signal", "signal"],
    }),
  );

  // voice_play -> `note <slot> <rate> <vel> <durMs> <chans>` -> poly~. `route` strips
  // the selector, leaving the bare args; `prepend note` is the word poly~ dispatches on
  // to pick a free voice. Claimed in series so ui_ready still reaches the wrapper.
  boxes.push(box("obj-instr-playroute", "route voice_play", { numoutlets: 2, outlettype: ["", ""] }));
  claimAppMessages(ctx, "obj-instr-playroute", 1);
  boxes.push(box("obj-instr-note", "prepend note"));
  lines.push(line("obj-instr-playroute", 0, "obj-instr-note", 0));
  lines.push(line("obj-instr-note", 0, "obj-instr-poly", 0));

  // The load path, from the wrapper's aux outlet - identical in shape to samples: a
  // bare buffer name resolves against MAX'S SEARCH PATH, not the device folder, so the
  // wrapper resolves it and hands back `buffer_replace <slot> <abs path>`. One buffer
  // per slot, dispatched by slot name (route matches a whole word).
  boxes.push(box("obj-instr-replaceroute", "route buffer_replace", { numoutlets: 2, outlettype: ["", ""] }));
  lines.push(line(unmatchedId, 1, "obj-instr-replaceroute", 0));
  boxes.push(box("obj-instr-loadslot", `route ${slots.join(" ")}`, { numoutlets: slots.length + 1, outlettype: slots.map(() => "").concat("") }));
  lines.push(line("obj-instr-replaceroute", 0, "obj-instr-loadslot", 0));

  slots.forEach((slot, i) => {
    const buf = `obj-instr-buf-${slot}`;
    const info = `obj-instr-info-${slot}`;
    boxes.push(box(buf, `buffer~ ${bufName(slot)}`, { numinlets: 1, numoutlets: 2, outlettype: ["float", "bang"] }));
    boxes.push(box(`obj-instr-replace-${slot}`, "prepend replace"));
    lines.push(line("obj-instr-loadslot", i, `obj-instr-replace-${slot}`, 0));
    lines.push(line(`obj-instr-replace-${slot}`, 0, buf, 0));

    // Report what LOADED, from the read-completed outlet (1). info~ fires right-to-left,
    // so the sample rate (outlet 0) arrives last and drives [pack]'s hot inlet.
    boxes.push(
      box(info, `info~ ${bufName(slot)}`, {
        numinlets: 1,
        numoutlets: 10,
        outlettype: ["float", "list", "float", "float", "float", "float", "float", "", "int", ""],
      }),
    );
    boxes.push(box(`obj-instr-pack-${slot}`, "pack 0. 0. 0", { numinlets: 3, numoutlets: 1, outlettype: [""] }));
    boxes.push(box(`obj-instr-ready-${slot}`, `prepend buffer_ready ${slot}`));
    lines.push(line(buf, 1, info, 0));
    lines.push(line(info, 8, `obj-instr-pack-${slot}`, 2)); // channels
    lines.push(line(info, 6, `obj-instr-pack-${slot}`, 1)); // duration ms
    lines.push(line(info, 0, `obj-instr-pack-${slot}`, 0)); // sample rate, hot
    lines.push(line(`obj-instr-pack-${slot}`, 0, `obj-instr-ready-${slot}`, 0));
    lines.push(line(`obj-instr-ready-${slot}`, 0, jwebId, 0));
  });

  // Sum the voices into the signal path - an instrument originates sound.
  for (const [ch, id] of [
    [0, "obj-instr-mix-l"],
    [1, "obj-instr-mix-r"],
  ]) {
    const [srcId, srcOut] = ctx.audioIn(ch);
    boxes.push(box(id, "+~", { numinlets: 2, numoutlets: 1, outlettype: ["signal"] }));
    lines.push(line(srcId, srcOut, id, 0));
    lines.push(line("obj-instr-poly", ch, id, 1));
    ctx.setAudioOut(ch, id, 0);
  }
}

export const CHAINS = {
  midiin: midiInChain,
  samples: samplesChain,
  instrument: instrumentChain,
  midiout: midiOutChain,
  passthrough: passthroughChain,
  gain: gainChain,
  lowpass: lowpassChain,
  hpf: hpfChain,
  drive: driveChain,
  crush: crushChain,
  delay: delayChain,
  reverb: reverbChain,
  remote: remoteChain,
  download: downloadChain,
  renderplay: renderplayChain,
};

/**
 * The NEUTRALITY CONTRACT: the parameter value at which each stage is a straight
 * wire - identical input and output samples.
 *
 * The DSP graph is written at BUILD time and every stage is ALWAYS in the signal
 * path, including the ones a device's line never mentions. That is only safe if each
 * stage has a setting where it does nothing, and if the library can say what it is.
 * Two kinds of stage reach neutral two ways:
 *
 *   naturally transparent - `gain` (1.0), `lowpass` (18 kHz, nothing left to remove),
 *     `drive` (1x), `crush` (24 bits, full depth), `hpf` (0 Hz, where its subtracted
 *     low end is silence): the DSP object itself is a wire at that value.
 *   send-style wet/dry - `delay` (0), `reverb` (0): the wet branch is scaled to 0.0
 *     and summed onto an untouched dry path, so the output is `dry + 0`. A WET-ONLY
 *     object (cverb~) has NO neutral of its own - it must carry this dry/wet, which
 *     is why it is a property of the chain and pinned here, not left to a device.
 *
 * `tests/neutrality.test.mjs` null-tests the send-style stages structurally (the dry
 * wire survives at unity and the only other path is gain-0), which is what can be
 * proven with no Max in the loop; the bit-exact acoustic check is a listening test,
 * the same standing as hello-audio.
 */
export const CHAIN_NEUTRAL = {
  gain: { gain: 1 },
  lowpass: { cutoff: 18000 },
  hpf: { hpfreq: 0 },
  drive: { drive: 1 },
  crush: { crush: 24 },
  delay: { delay: 0 },
  reverb: { room: 0 },
};

/** The send-style chains: wet-only or naturally additive, neutral by a 0 mix they own. */
export const WET_DRY_CHAINS = ["delay", "reverb"];

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
