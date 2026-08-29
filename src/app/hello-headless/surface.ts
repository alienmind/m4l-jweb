/**
 * surface.ts (hello-headless) - the whole interface of a device with NO BROWSER.
 *
 * This is the point of the headless target: the declaration is exactly what a jweb
 * device writes, and it still produces real Live parameters - automatable, MIDI-
 * mappable, on Push, in an automation lane. What it does NOT produce is a React page,
 * so `layout.native` is not a nicety here, it is the device view: the `live.*` objects
 * the codegen already generates, made visible.
 *
 * There is no `protocol.ts` either, and there cannot be one: a protocol is the contract
 * across the bridge between two halves, and this device is one half. A parameter still
 * reaches the logic as `<id> <value>` and still takes `set_<id>` back - but both ends
 * of that are now [js], so the names are generated and nothing declares them twice.
 */
import { defineSurface, dial, toggle } from "@m4l-jweb/surface";

export default defineSurface({
  params: {
    running: toggle({ default: false, short: "Run" }),
    // REAL UNITS, as always: the automation lane and the Push encoder both read Hz.
    rate: dial({ range: [1, 16], default: 6, unit: "Hz", short: "Rate" }),
    // The pattern is `steps` notes climbing from `root`, so these two are the tune.
    steps: dial({ range: [2, 8], step: 1, default: 4, short: "Steps" }),
    root: dial({ range: [24, 84], step: 1, default: 48, unit: "midi", short: "Root" }),
  },
  banks: [{ name: "Arp", params: ["running", "rate", "steps", "root"] }],
  // THE DEVICE VIEW. Four native objects and no page - which is the entire UI budget
  // of a headless device, and enough for a device whose controls are four numbers.
  layout: { native: { params: ["running", "rate", "steps", "root"], rows: 1 } },
});
