/**
 * surface.ts (hello-remote) - one parameter, and it is the target of its own modulation.
 *
 * `target` is a normal Live dial. The device also declares `remotes: 1` in the
 * manifest, and the app binds `live.remote~` slot 0 to THIS parameter by LOM id - so
 * the modulation the app streams sweeps a dial that is right there to watch. It is in
 * `layout.native`, so the sweep is visible as a real knob in Live's device view, not
 * only in the web UI - the clearest proof the `remote` path works.
 *
 * `exponent` is 1 (the default), so `writeRemote(0, v)` lands the parameter at exactly
 * `v` - `live.remote~` takes knob TRAVEL, and travel and value coincide only for a
 * linear parameter. A curved one would need the pre-warp `useModulation.toRemote` does.
 */
import { defineSurface, dial } from "@m4l-jweb/surface";

export default defineSurface({
  params: {
    target: dial({ range: [0, 100], unit: "%", default: 50, short: "Target" }),
  },
  layout: { native: { params: ["target"] } },
});
