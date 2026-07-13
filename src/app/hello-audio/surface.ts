/**
 * surface.ts (hello-audio) - the device's Live parameters, declared as code.
 *
 * The build compiles each of these into the live.dial Live sees, wired both ways:
 * the dial reaches the app as `cutoff <v>`, and the app's slider writes it back with
 * `set_cutoff <v>`.
 *
 * ONE PARAMETER PER STAGE. The device's chains are `["lowpass", "drive", "gain"]`,
 * and each of those chains requires the parameter named after it - `lowpass` wants
 * `cutoff`, `drive` wants `drive`, `gain` wants `gain` - and fails the BUILD if this
 * file does not declare it. There is no way to ship a filter with no cutoff.
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

    /**
     * The `drive` chain's soft-clipping factor, straight into `overdrive~`'s right
     * inlet. 1 is clean - a linear response, no distortion - which is why the range
     * starts there rather than at 0: "off" should be where a user expects it.
     */
    drive: dial({
      range: [1, 10],
      unit: "x", // not one of Live's unit styles, so it prints the number and appends it
      default: 1,
      format: (v) => `${v.toFixed(1)}x`,
      short: "Drive",
    }),

    /**
     * The `gain` chain's multiplier, straight into `*~`'s right inlet. 1 is unity;
     * the range goes to 2 so you can make up the level a filter took away.
     */
    gain: dial({
      range: [0, 2],
      default: 1,
      format: (v) => `${v.toFixed(2)}x`,
      short: "Gain",
    }),
  },

  // Eight parameters fit under Push's eight encoders, so these three are one bank.
  banks: [{ name: "Filter", params: ["cutoff", "drive", "gain"] }],
});
