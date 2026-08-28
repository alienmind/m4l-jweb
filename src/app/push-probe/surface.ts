/**
 * surface.ts (push-probe) - two dials that exist ONLY so the encoders have
 * something to carry.
 *
 * The probe declared no parameters, and Push correctly showed "No parameters
 * mapped" - so turning an encoder did nothing, and U6 could not be asked at all:
 * "the encoders are grabbed" and "the encoders have nothing on them" look
 * identical from the hardware. Two dials make the difference visible.
 *
 * They control nothing. That is the point - a parameter that drove something would
 * make the test about the something.
 */
import { defineSurface, dial } from "@m4l-jweb/surface";

export default defineSurface({
  params: {
    probea: dial({ range: [0, 100], default: 25, unit: "%", short: "ProbeA" }),
    probeb: dial({ range: [0, 100], default: 75, unit: "%", short: "ProbeB" }),
  },
  banks: [{ name: "Probe", params: ["probea", "probeb"] }],
});
