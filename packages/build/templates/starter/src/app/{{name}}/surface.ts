/**
 * surface.ts - the device's Live parameters, declared as code.
 *
 * Push reads Live parameters, not your UI, so anything musically meaningful has
 * to exist here as well as in the app.
 *
 * Not wired up yet: this declaration is typechecked and validated, but the
 * codegen that turns it into live.* objects is not built. For now the parameters
 * Live sees come from `parameters` in patcher/devices.mjs, and the two have to
 * be kept in step by hand.
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
