/**
 * surface.ts (hello-midi) - the device's Live parameters, declared as code.
 *
 * Push cannot see your React UI. It reads Live parameters and nothing else, so
 * anything musically meaningful has to exist here as well as in the app.
 *
 * This is the only place they are declared: the build imports this file and
 * generates the live.dial objects Live sees, wired in both directions.
 */
import { defineSurface, dial, menu, window, state } from "@m4l-jweb/surface";

/** The note divisions this device can pulse at. `off` is one of them, not a special case. */
export const RATES = ["off", "1/4", "1/8", "1/16", "1/32"] as const;

export default defineSurface({
  params: {
    /**
     * A MENU, not a dial, and that is the whole point of the distinction.
     *
     * The rate is a CHOICE from a list - "1/8" is not 2.4 of anything - so it is an
     * enum parameter, and Live stores the labels in `parameter_enum`. Push then
     * prints "1/16" under the encoder, because it has the words.
     *
     * It was a `dial` carrying an INDEX, which is what a rate looks like if you
     * think about the slider before you think about the parameter. Live had nothing
     * to print but the number, so a Push user saw "0".."4" and had to know the
     * mapping. The app had the labels all along; they simply never crossed over.
     */
    rate: menu({ options: RATES, default: "off", short: "Rate" }),

    /**
     * How hard the pulse hits, as a PERCENTAGE - so Live prints "50 %" rather than
     * "0.50", and the number in the automation lane is the number in the UI.
     */
    density: dial({ range: [0, 100], unit: "%", default: 50, short: "Dens" }),
  },

  banks: [{ name: "Perform", params: ["rate", "density"] }],

  windows: {
    testWindow: window({ title: "My Floating Window", width: 400, height: 300, entry: "App" }),
  },
  state: {
    config: state({ default: { testValue: 42 } }),
  },
});
