/**
 * watch.ts (hello-midi) - the Live properties this device OBSERVES, declared once.
 *
 * The read-only twin of surface.ts: a parameter is something the app reads AND
 * writes, a watch is something Live owns and the app only reads. The build injects
 * this list and the packaged wrapper attaches every observer from `bang()` - the
 * one moment a LiveAPI object is not born dead - so a change to the scale in Live
 * reaches the app as `watch_scale <name>`, and `useWatch()` renders it.
 */
import { defineWatch, watch } from "@m4l-jweb/surface";

export default defineWatch({
  watches: {
    /**
     * The set's time-signature numerator - the top number of "4/4". It is a Song
     * property that Live actually OBSERVES, so changing the time signature in Live's
     * control bar fires this at once.
     *
     * `scale_name` was the first pick and it does NOT work: you can `get` it (the
     * resend shows the current scale) but Live never notifies a change, so the
     * observer attaches and sits silent. Observability is per-property in the Live
     * Object Model - `get` working is not proof `observe` does - so a watch must name
     * a property Live emits. `signature_numerator`, `tempo`, `signature_denominator`
     * do; `scale_name` (in this Live) does not.
     */
    sig: watch({ path: "live_set", property: "signature_numerator", default: 4 }),
  },
});
