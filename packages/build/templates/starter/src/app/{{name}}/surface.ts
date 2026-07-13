/**
 * surface.ts - the device's Live parameters, declared as code.
 *
 * Push reads Live parameters, not your UI, so anything musically meaningful has
 * to exist here as well as in the app.
 *
 * This is the ONLY place they are declared. The build imports this file and
 * generates the live.* objects from it, wired in both directions: a knob turn
 * reaches the app as `<id> <value>`, and the app writes the parameter back with
 * `set_<id> <value>` - which moves the dial, the automation lane and Push.
 */
import { defineSurface, dial } from "@m4l-jweb/surface";

export default defineSurface({
  params: {
    density: dial({
      range: [0, 1],
      default: 0.5,
      format: (v) => `${Math.round(v * 100)}%`,
      short: "Dens", // Push has ~8 characters per encoder label
    }),
  },

  // Push renders parameters in banks of eight. A bank is a page.
  banks: [{ name: "Perform", params: ["density"] }],
});
