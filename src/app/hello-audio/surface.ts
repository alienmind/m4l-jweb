/**
 * surface.ts (hello-audio) - the device's Live parameters, declared as code.
 *
 * STATUS: typechecked and validated, but not yet compiled into live.* objects -
 * that is the Surface codegen, Stage 2 of doc/TODO.md. Live still reads the
 * parameters from `patcher/devices.mjs`; keep the two in step by hand.
 */
import { defineSurface, dial } from "@m4l-jweb/surface";

export default defineSurface({
  params: {
    cutoff: dial({
      range: [0, 1],
      // Wide open. NOT cosmetic: the bottom of this range is a 40 Hz lowpass,
      // i.e. a device that swallows the signal the moment it loads.
      default: 1,
      // The same log curve the `lowpass` chain applies in the patcher.
      format: (v) => `${Math.round(40 * Math.pow(450, v))} Hz`,
      short: "Cutoff",
    }),
  },

  banks: [{ name: "Filter", params: ["cutoff"] }],
});
