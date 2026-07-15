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
 * The buffer NAMES are global to Max, and they are generated from the device name
 * (`buf-<device>-<slot>`), so two INSTANCES of the same device on two tracks name
 * their buffers alike - and Max hands the name to whichever loaded last. Not
 * verified in Live yet; a preview device you drag onto one track is unaffected.
 *
 * Slots default to one, named "preview". `slots: ["kick", "snare"]` in the manifest
 * gives you more.
 */
function samplesChain(ctx) {
  const { boxes, lines, device, jwebId, unmatchedId } = ctx;
  const slots = device?.slots ?? ["preview"];
  const bufName = (slot) => `buf-${device?.name}-${slot}`;

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

export const CHAINS = {
  midiin: midiInChain,
  samples: samplesChain,
  midiout: midiOutChain,
  passthrough: passthroughChain,
  gain: gainChain,
  lowpass: lowpassChain,
  drive: driveChain,
  delay: delayChain,
  reverb: reverbChain,
  download: downloadChain,
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
 *     `drive` (1x): the DSP object itself is a wire at that value.
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
  drive: { drive: 1 },
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
