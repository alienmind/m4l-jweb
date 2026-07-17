/**
 * watch.ts - the observers a device DECLARED with defineWatch(), created here.
 *
 * Concatenated after liveapi.ts, so it can call observeProperty(). The list of
 * what to observe is injected by the build as WATCH_SPECS (like BUILD_STAMP and
 * the payloads) - one array per device, from its src/app/<device>/watch.ts. This
 * file is generic: it observes whatever the array names, and a device that
 * declared no watches ships an undefined WATCH_SPECS and this does nothing.
 *
 * WHY THE DECLARATION EXISTS AT ALL. A LiveAPI observer built during loadbang is
 * DEAD - it constructs without error and notifies nothing, forever (hard rule 4).
 * The only safe moment is live.thisdevice's bang. So the observers are not
 * hand-written in a device's wrapper/device.ts, where the trap is one typo away;
 * they are declared as data and created HERE, from bang(), unconditionally - which
 * is the one place, and the one way, that is correct by construction.
 */

/**
 * The attached observers, kept alive for the life of the device: drop the LiveAPI
 * and its observer dies with it. Recreated (not reused) on every bang - an object
 * from a previous, loading context is dead and must not be trusted.
 */
var watchObservers: (LiveAPI | null)[] = [];

/** Attach every declared observer. Call from bang() (and reload()), never loadbang(). */
function setupWatches(): void {
  if (typeof WATCH_SPECS === "undefined") return;
  // Recreate unconditionally - a guard like `if (watchObservers.length) return`
  // would make hard rule 4 permanent, keeping a dead observer forever.
  watchObservers = [];
  for (var i = 0; i < WATCH_SPECS.length; i++) {
    var w = WATCH_SPECS[i];
    // observeProperty forwards every change as `watch_<key> <value...>` - the same
    // shape a parameter uses, so the app binds it exactly like `useParam`'s inlet.
    watchObservers.push(observeProperty(w.path, w.property, "watch_" + w.key));
  }
  if (WATCH_SPECS.length) post("m4l-jweb: watching " + WATCH_SPECS.length + " Live propert" + (WATCH_SPECS.length === 1 ? "y" : "ies") + "\n");
}

/**
 * Send each watched property's CURRENT value once, on ui_ready.
 *
 * The observer's first callback can beat the page's binding - the page loads
 * asynchronously and long after bang() attached the observer - so the app would
 * miss the value it had at load. This is the watch twin of sendCurrentTempo(): a
 * fresh read, straight to the device view. It goes out outlet(0) like tick and
 * tempo, not through reply(): a watch streams to the device UI, and a window is an
 * editor that never receives the transport clock either.
 */
function resendWatches(): void {
  if (typeof WATCH_SPECS === "undefined") return;
  for (var i = 0; i < WATCH_SPECS.length; i++) {
    var w = WATCH_SPECS[i];
    try {
      var api = new LiveAPI(w.path);
      var v = api.get(w.property);
      var args: unknown[] = [0, "watch_" + w.key];
      // LiveAPI.get returns an array for a multi-atom property and a bare value for a
      // scalar; spread the first so a scalar arrives as one atom, matching the observer.
      // Duck-typed, not `instanceof Array`: a Max array is not a JS Array instance, and
      // neither is one crossing a vm realm in the tests - both have a numeric length.
      if (v !== null && typeof v === "object" && typeof (v as { length?: unknown }).length === "number") {
        var arr = v as unknown[];
        for (var j = 0; j < arr.length; j++) args.push(arr[j]);
      } else {
        args.push(v);
      }
      (outlet as Function).apply(this, args);
    } catch (e) {
      post("m4l-jweb: watch resend failed for " + w.key + " - " + (e as Error).message + "\n");
    }
  }
}
