/**
 * chains.mjs - chains owned by THIS device repo.
 *
 * Importing this file is enough: registerChain() mutates the shared vocabulary
 * that @m4l-jweb/build reads when it generates the patchers.
 *
 * Everything here served the Stage 1 spikes (doc/TODO.md). These are not
 * production chains and they are not part of the library - they exist to answer
 * three questions about Max's actual behaviour that the rest of the plan is
 * gated on, and they should be deleted once the answers are recorded.
 */
import { box, claimAppMessages, line, registerChain } from "@m4l-jweb/build/chains";

/**
 * "spike" - the instrumentation for all three Stage 1 spikes in one device.
 *
 * It deliberately wires the REAL thing under test rather than a mock, because
 * the whole point of a spike is that a mock cannot answer the question.
 *
 * Spike 1.1 - does `set` on a live.dial set the value WITHOUT producing output?
 *
 *   The Surface's no-feedback design rests on this. App -> parameter is new
 *   wiring, and feeding a value into a live.dial's inlet normally makes it
 *   OUTPUT, which sends it back to the app, which may set it again - a loop that
 *   can oscillate rather than settle with floats. `set` is the documented
 *   escape. This chain wires BOTH paths side by side so the difference is
 *   visible in the message log:
 *
 *     set_param <v> -> [prepend set] -> [live.dial]   should NOT echo
 *     raw_param <v> ->                  [live.dial]   SHOULD echo (the control)
 *
 *   The dial's outlet goes back to the UI as `dial_out <v>`. If `set_param`
 *   produces a `dial_out`, the design needs the [gate] fallback instead.
 *
 * Spike 1.2 - can [js] drive a [buffer~] to read a real file off disk?
 *
 *   Just a named buffer~ for the wrapper to address as new Buffer("...").
 *   Nothing is wired to it: the question is whether [js] can load a file into it
 *   and read frames back, not whether MSP can play it (MSP playing a loaded
 *   buffer~ is not in doubt).
 *
 * Spike 1.3 - which HTTP object downloads to disk inside Live, and how?
 *
 *   [maxurl] hangs off the wrapper's SPARE outlet (outlet 1), and its reply
 *   comes back in as `url_reply`. The UI sends it raw words, so the spike is an
 *   instrument for exploration rather than a guess at a message vocabulary
 *   nobody here has confirmed.
 */
function spikeChain(ctx) {
  const { boxes, lines, jwebId, unmatchedId } = ctx;

  boxes.push(box("obj-spike-route", "route set_param raw_param", { numoutlets: 3, outlettype: ["", "", ""] }));
  // Claim the app's messages and pass the rest on from outlet 2 - everything the
  // spike does not own still has to reach [js].
  claimAppMessages(ctx, "obj-spike-route", 2);

  // --- spike 1.1: the dial, and the two ways of writing to it ---
  boxes.push({
    box: {
      id: "obj-spike-dial",
      maxclass: "live.dial",
      numinlets: 1,
      numoutlets: 1,
      outlettype: [""],
      parameter_enable: 1,
      patching_rect: [480, 300, 44, 48],
      saved_attribute_attributes: {
        valueof: {
          parameter_longname: "spike_dial",
          parameter_shortname: "Spike",
          parameter_type: 0, // float
          parameter_range: [0, 1],
        },
      },
    },
  });

  // `set <v>` is the documented set-without-output message. The control path
  // (raw_param) sends the bare value, which definitely DOES output.
  boxes.push(box("obj-spike-set", "prepend set"));
  lines.push(line("obj-spike-route", 0, "obj-spike-set", 0));
  lines.push(line("obj-spike-set", 0, "obj-spike-dial", 0));
  lines.push(line("obj-spike-route", 1, "obj-spike-dial", 0));

  // The echo detector: whatever the dial emits goes straight back to the UI.
  boxes.push(box("obj-spike-dialout", "prepend dial_out"));
  lines.push(line("obj-spike-dial", 0, "obj-spike-dialout", 0));
  lines.push(line("obj-spike-dialout", 0, jwebId, 0));

  // --- spike 1.2: a named buffer~ for [js] to address ---
  // NO size argument, deliberately. A declared size is indistinguishable from a
  // successful read: `buffer~ m4ljweb_spike 1000 1` reports 48000 frames at 48k
  // whether or not the file ever arrived, and the first run of this spike read
  // exactly that and looked like a pass. Starting empty makes frames>0 mean one
  // thing only. The wrapper does `new Buffer("m4ljweb_spike")`.
  boxes.push(box("obj-spike-buffer", "buffer~ m4ljweb_spike", { numinlets: 1, numoutlets: 2, outlettype: ["float", "bang"] }));

  // --- spike 1.3: maxurl on the wrapper's spare outlet ---
  //
  // ALL THREE outlets come back, each tagged with its own index, because "which
  // outlet does the completion arrive on" is one of the questions - and CLAUDE.md
  // is explicit that an object's outlet order is never to be trusted from memory.
  // The tag turns that from a guess into a reading: `url_reply 2 ...` says outlet
  // 2 fired, in the console, in front of you.
  boxes.push(box("obj-spike-maxurl", "maxurl", { numinlets: 1, numoutlets: 3, outlettype: ["", "", ""] }));
  lines.push(line(unmatchedId, 1, "obj-spike-maxurl", 0)); // [js] outlet 1 (spare) -> maxurl

  for (let i = 0; i < 3; i++) {
    boxes.push(box("obj-spike-urlreply-" + i, "prepend url_reply " + i));
    lines.push(line("obj-spike-maxurl", i, "obj-spike-urlreply-" + i, 0));
    lines.push(line("obj-spike-urlreply-" + i, 0, unmatchedId, 0)); // -> [js] url_reply()
  }
}

registerChain("spike", spikeChain);
