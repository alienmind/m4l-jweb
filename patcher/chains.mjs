/**
 * chains.mjs - this repo's OWN chains, on top of the packaged vocabulary.
 *
 * Importing this file is enough: `registerChain()` mutates the shared vocabulary,
 * and @m4l-jweb/build imports it before generating patchers.
 *
 * Everything here is spike machinery for `push-probe`. It is deliberately NOT in
 * `packages/build/src/chains.mjs`: the library ships chains that devices are meant
 * to compose, and a raw MPE tap is a question being asked, not an answer being
 * offered.
 */
import { box, line, registerChain } from "@m4l-jweb/build/chains";

/**
 * The selectors this repo's own chains SEND to the UI - the local twin of
 * `CHAIN_IN` in @m4l-jweb/bridge, and it exists for the same two reasons.
 *
 * The honest one: the name a chain emits and the name the app binds should come from
 * ONE definition, or a typo is a message falling on the floor with no error anywhere.
 *
 * The load-bearing one: `tests/protocol.test.mjs` proves every IN selector is
 * actually sent, and it looks for a `[prepend <sel>]` or a string literal. `mpeevent`
 * is neither - `[mpeparse]` emits the word ITSELF, out of outlet 9 - so without this
 * declaration the lint calls a perfectly wired selector unrouted. Adding a `[prepend
 * mpeevent]` to satisfy it would be worse than the warning: the message already leads
 * with that symbol, so it would arrive as `mpeevent mpeevent ...`.
 */
export const REPO_CHAIN_IN = {
  /** mpein -> UI: the whole MPE event as one list. See mpeInChain below. */
  mpeevent: "mpeevent",
};

/**
 * "mpein" - the RAW MPE stream, straight to the page.
 *
 * A device declaring `mpe: true` is SENT MPE by Live (the `is_mpe` patcher
 * attribute, read off Max's own reference and confirmed set to 1 in a shipping
 * takeover device). This is what reads it.
 *
 *   [midiin] -> [mpeparse] -> outlet 9 -> [jweb]
 *
 * OUTLET 9, and only outlet 9. `mpeparse` has ten, and the other nine are the
 * decomposed message types - note, poly key pressure, control change, aftertouch,
 * pitch bend, and the three zone/voice numbers - which would arrive as separate
 * messages with Max's right-to-left ordering deciding what the page sees first.
 * Outlet 9 is the whole event as ONE list, already led by the symbol `mpeevent`:
 *
 *   mpeevent <zoneFirstChannel> <zoneIndex> <voiceNumber> <channel> <messageNumber> <data...>
 *
 * So it needs no [prepend], it cannot be reordered against itself, and the page
 * binds it like any other selector. (Read off
 * `refpages/max-ref/mpeparse.maxref.xml` - never an outlet order from memory.)
 *
 * THE MIDI THRU CORD IS LEFT ALONE, unlike the packaged `midiin` chain which cuts
 * it. That chain cuts it because a device transforming notes must not also leak the
 * untransformed ones; this one transforms nothing and only listens, so cutting the
 * thru would make the probe silently eat the track's MIDI.
 */
function mpeInChain({ boxes, lines, jwebId }) {
  boxes.push(
    box("obj-mpeparse", "mpeparse", {
      numinlets: 1,
      numoutlets: 10,
      outlettype: ["list", "list", "list", "int", "int", "int", "int", "int", "int", "list"],
    }),
  );
  lines.push(line("obj-midiin", 0, "obj-mpeparse", 0));
  lines.push(line("obj-mpeparse", 9, jwebId, 0));
}

registerChain("mpein", mpeInChain);
