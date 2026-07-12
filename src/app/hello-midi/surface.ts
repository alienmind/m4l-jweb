/**
 * surface.ts (hello-midi) - the device's Live parameters, declared as code.
 *
 * Push cannot see your React UI. It reads Live parameters and nothing else, so
 * anything musically meaningful has to exist here as well as in the app.
 *
 * STATUS: this declaration is typechecked and validated, but the codegen that
 * compiles it into live.* objects is Stage 2 of doc/TODO.md and does not exist
 * yet. The parameters Live actually sees still come from `parameters` in
 * patcher/devices.mjs, and the two must be kept in step by hand until then.
 */
import { defineSurface, dial } from "@m4l-jweb/surface";

export default defineSurface({
  params: {
    density: dial({
      range: [0, 1],
      default: 0.5,
      format: (v) => `${Math.round(40 + v * 87)}`, // velocity
      short: "Dens",
    }),
    rate: dial({
      range: [0, 4],
      step: 1, // an index into [off, 1/4, 1/8, 1/16, 1/32] - see App.tsx
      default: 0,
      format: (v) => ["off", "1/4", "1/8", "1/16", "1/32"][Math.round(v)] ?? "off",
      short: "Rate",
    }),
  },

  banks: [{ name: "Perform", params: ["rate", "density"] }],
});
