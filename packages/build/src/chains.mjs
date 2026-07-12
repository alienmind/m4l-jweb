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
 * back. The dial is wired straight into the `*~` right inlet, in the patcher, so
 * the audio path does not depend on the browser being alive or keeping up. The
 * app gets its own copy of the value (via addParameters) purely to DISPLAY it.
 * Audio is Max's job; the UI is a view of it.
 *
 * Requires a parameter named `gain` (or pass `device.gainParam`).
 */
function gainChain({ boxes, lines, device }) {
  removeBox(boxes, lines, "obj-midiin");
  removeBox(boxes, lines, "obj-midiout");

  const paramId = device?.gainParam ?? "gain";
  const declared = (device?.parameters ?? []).some((p) => p.id === paramId);
  if (!declared) {
    throw new Error(`chain "gain" on device "${device?.name}" needs a parameter with id "${paramId}" (or set gainParam)`);
  }

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
    // The live.dial box is created LATER, by addParameters(). A patchline may name
    // a box that appears further down the boxes array - the patcher is a graph, not
    // a script - so this cord is valid as long as the parameter is declared, which
    // is what the check above guarantees.
    lines.push(line(`obj-param-${paramId}`, 0, id, 1));
  }
}

/**
 * Let the APP write to a Live parameter: `set_<id> <value>` from [jweb] lands on
 * the live.* object's inlet, and from there in the signal path and in Live's
 * automation, exactly as if the user had turned the dial.
 *
 * This is the missing half of the parameter story. Reading one has always worked
 * (addParameters wires the object out to the app). Writing one did not exist, so
 * a control in the web UI could only ever be a readout of a knob you had to turn
 * somewhere else - useless.
 *
 * TWO TRAPS, and the whole design of this helper is about them:
 *
 * 1. FEEDBACK. Sending a bare value into a live.dial's inlet SETS IT AND MAKES
 *    IT OUTPUT, which sends it straight back to the app - which could set it
 *    again. `set <value>` is the documented message that updates the value
 *    WITHOUT producing outlet output, so the loop never starts. (Spike 1.1 in
 *    doc/SPIKES.md confirms the behaviour properly; the field evidence is
 *    below.)
 *
 * 2. `set` SUPPRESSING THE OUTPUT IS NOT FREE. It silences the dial for
 *    EVERYONE, not just for the app - including whatever the dial drives inside
 *    the patcher. The first version of the lowpass chain fed its filter from the
 *    dial's OUTLET, so writing the parameter with `set` moved the dial and told
 *    the filter nothing: the slider appeared dead and the cutoff never budged.
 *
 *    So the value is FANNED OUT, not chained. The route outlet is the source of
 *    truth for the app's write, and the caller taps it directly (see
 *    `valueOutlet` below) to drive whatever the parameter controls. The dial is
 *    updated in parallel, so Live's automation, MIDI mapping and Push all stay
 *    correct - but nothing downstream *depends* on the dial re-emitting.
 *
 *    The dial's own outlet still feeds the same destination, because that is the
 *    path a real knob-turn, an automation lane or a Push encoder travels.
 *
 * Returns `{ valueOutlet(id) }`: the [route] outlet carrying the raw value the
 * app wrote, for the chain to wire wherever the parameter actually acts.
 *
 * This is a hand-rolled sliver of what the Surface will generate for every
 * parameter at once (Stage 2 of doc/TODO.md). It is here because "a slider in
 * the device window that actually does something" should not have to wait.
 */
function writableParams({ boxes, lines, jwebId, unmatchedId }, ids) {
  removeLine(lines, jwebId, unmatchedId);

  const selectors = ids.map((id) => `set_${id}`);
  boxes.push(
    box("obj-setparam-route", `route ${selectors.join(" ")}`, {
      numoutlets: ids.length + 1,
      outlettype: ids.map(() => "").concat(""),
    }),
  );
  lines.push(line(jwebId, 0, "obj-setparam-route", 0));

  ids.forEach((id, i) => {
    // `route` STRIPS the selector, so what emerges is the bare value. Re-wrap it
    // as `set <value>` - the set-without-output message - and feed the object, so
    // the dial, the automation lane and Push all follow the app's slider.
    boxes.push(box(`obj-set-${id}`, "prepend set"));
    lines.push(line("obj-setparam-route", i, `obj-set-${id}`, 0));
    lines.push(line(`obj-set-${id}`, 0, `obj-param-${id}`, 0));
  });

  // Unmatched (ui_ready, and anything the wrapper handles) carries on.
  lines.push(line("obj-setparam-route", ids.length, unmatchedId, 0));

  return {
    /** The outlet carrying the value the APP wrote. Wire it where the parameter acts. */
    valueOutlet: (id) => ["obj-setparam-route", ids.indexOf(id)],
  };
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
 * THE CUTOFF MAPPING is the interesting part. The dial is 0-1 (a Live parameter
 * wants a bounded, automatable range), but pitch is logarithmic: a linear sweep
 * from 20 Hz to 18 kHz spends almost all its travel in the top octave, where you
 * can hear nothing happening, and races through the bottom, where everything
 * happens. So the value goes through [expr] first:
 *
 *     40 * 450^x     x = 0 -> 40 Hz,  x = 0.5 -> ~850 Hz,  x = 1 -> 18 kHz
 *
 * which spreads the audible action evenly across the knob. This is exactly the
 * curve a filter knob on real hardware has.
 *
 * Requires a parameter named `cutoff` (or pass `device.cutoffParam`).
 */
function lowpassChain(ctx) {
  const { boxes, lines, device } = ctx;
  removeBox(boxes, lines, "obj-midiin");
  removeBox(boxes, lines, "obj-midiout");

  const paramId = device?.cutoffParam ?? "cutoff";
  const declared = (device?.parameters ?? []).some((p) => p.id === paramId);
  if (!declared) {
    throw new Error(`chain "lowpass" on device "${device?.name}" needs a parameter with id "${paramId}" (or set cutoffParam)`);
  }

  // The slider in the device window writes the parameter: `set_cutoff <0-1>`.
  const { valueOutlet } = writableParams(ctx, [paramId]);
  const [routeId, routeOut] = valueOutlet(paramId);

  boxes.push(box("obj-plugin", "plugin~", { numinlets: 1, numoutlets: 2, outlettype: ["signal", "signal"] }));
  boxes.push(box("obj-plugout", "plugout~", { numinlets: 2, numoutlets: 0 }));

  // 0-1 -> 40..18000 Hz, logarithmically. Floats, not ints: `40.` and `450.` keep
  // expr in float mode, and an int cutoff would quantise the sweep into steps.
  boxes.push(box("obj-cutoff-hz", "expr 40. * pow(450., $f1)", { numinlets: 1, numoutlets: 1, outlettype: [""] }));

  // TWO sources feed the filter, and it needs both:
  //
  //   the DIAL's outlet    - a knob turn, an automation lane, a Push encoder.
  //   the ROUTE's outlet   - the app's slider.
  //
  // The second is not redundant. The app writes the dial with `set`, which
  // updates it WITHOUT producing output - so the dial would never pass the app's
  // value on, and the filter would sit wherever it was while the slider appeared
  // to do nothing. (It did exactly that.) Tap the value where it enters.
  lines.push(line(`obj-param-${paramId}`, 0, "obj-cutoff-hz", 0));
  lines.push(line(routeId, routeOut, "obj-cutoff-hz", 0));

  // One filter per channel: a signal object handles ONE signal, and plugin~ hands
  // us a stereo pair. Both take the same cutoff, so the image does not shift.
  for (const [i, id] of [
    [0, "obj-lpf-l"],
    [1, "obj-lpf-r"],
  ]) {
    boxes.push(box(id, "onepole~ 18000.", { numinlets: 2, numoutlets: 1, outlettype: ["signal"] }));
    lines.push(line("obj-plugin", i, id, 0));
    lines.push(line(id, 0, "obj-plugout", i));
    // Cutoff into the RIGHT inlet. The dial box itself is created LATER, by
    // addParameters() - a patchline may name a box further down the array,
    // because a patcher is a graph, not a script.
    lines.push(line("obj-cutoff-hz", 0, id, 1));
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
 * Real Live parameters: automatable, MIDI-mappable, and the ONLY thing Push can
 * display. Each becomes a live.* object wired into the UI as `<id> <value>`, so
 * a parameter change is just another inlet message to your app.
 *
 * `default` is not optional in practice, whatever the type says. A live.* object
 * with no initial value loads at the BOTTOM of its range, and for a great many
 * parameters the bottom of the range is a broken device: a filter cutoff of 0
 * loads as a device that eats the signal, and it looks exactly like a bug in your
 * DSP. Declare `default` and Max stores it as the object's initial value, which
 * Live restores on load and on "reset to default".
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
            // parameter_initial is a LIST, and it is inert without
            // parameter_initial_enable - setting one without the other silently
            // does nothing, which is the worst way for this to fail.
            ...(p.default !== undefined ? { parameter_initial_enable: 1, parameter_initial: [p.default] } : {}),
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
