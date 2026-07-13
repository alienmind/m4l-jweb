/**
 * surface.ts (hello-audio) - the device's Live parameters, declared as code.
 *
 * The build compiles this into the live.dial Live sees, wired both ways: the dial
 * reaches the app as `cutoff <v>`, and the app's slider writes it with
 * `set_cutoff <v>`. The `lowpass` chain requires a parameter named `cutoff` and
 * fails the build without one.
 */
import { defineSurface, dial } from "@m4l-jweb/surface";

export default defineSurface({
  params: {
    cutoff: dial({
      // The range the filter ACTUALLY has, in the unit it is actually in. Live's
      // automation lane, Push and the app all read Hz, and the value goes straight
      // into onepole~ - nothing converts it on the way.
      range: [40, 18000],
      unit: "Hz",
      // Hearing is logarithmic. Without this the knob spends nearly all its travel
      // in the top octave, where a lowpass does nothing audible, and races through
      // the bottom, where it does everything.
      exponent: 4,
      // Wide open. NOT cosmetic: the bottom of this range is a 40 Hz lowpass, i.e.
      // a device that swallows the signal the moment it loads.
      default: 18000,
      format: (v) => (v < 1000 ? `${Math.round(v)} Hz` : `${(v / 1000).toFixed(1)} kHz`),
      short: "Cutoff",
    }),
  },

  banks: [{ name: "Filter", params: ["cutoff"] }],
});
