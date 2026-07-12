/**
 * wrapper/device.ts - extra [js] message handlers for THIS device repo.
 *
 * Compiled as part of the same TypeScript program as the packaged wrapper
 * sources and concatenated after them, so everything in core.ts and liveapi.ts
 * is visible here (post, outlet, buildStamp, deviceFolder...) with no imports.
 *
 * ES5 ONLY. No let/const, no arrow functions, no template literals, no
 * promises. The build re-parses the emitted output with acorn at ecmaVersion 5
 * and refuses to package on failure - so you cannot ship this bug, but you can
 * waste an afternoon on it. Use `var` and `function`.
 *
 * Everything below serves the Stage 1 SPIKES (doc/SPIKES.md). Delete it once
 * the answers are recorded.
 */

/**
 * The spike device's UI asks for a buffer~ load. See doc/SPIKES.md, spike 1.2.
 *
 * The question: can [js] tell a [buffer~] to read a real file off disk, and
 * confirm it actually landed? If yes, "disk is the audio transport" holds, and
 * an instrument device never has to push a single sample through the Max
 * message bridge.
 *
 * NOTE the Buffer binding's exact API surface is PART of what this spike tests.
 * If `send` or `framecount` is not what Max's [js] exposes, the catch below is
 * the finding - post it and record it, do not work around it.
 *
 * buffer_load <path>   (a real path; the wrapper's own extracted ui.html will do)
 */
function buffer_load(): void {
  var a = arrayfromargs(arguments);
  var path = a.length ? String(a[0]) : "";
  if (!path) {
    post("spike: buffer_load needs a path\n");
    return;
  }
  try {
    var b = new Buffer("m4ljweb_spike");
    // `replace` reads the file and RESIZES the buffer to fit it; `read` keeps
    // the declared size. replace is what a sample player wants.
    b.send("replace", path);
    post("spike: buffer_load sent replace " + path + "\n");
    // The read is asynchronous - the buffer will not have the file yet. Come
    // back on the scheduler and report what actually landed.
    var probe = new Task(function () {
      try {
        var frames = b.framecount();
        var chans = b.channelcount();
        // A non-zero sample proves bytes arrived, not just that a buffer exists.
        var mid = frames > 2 ? b.peek(1, Math.floor(frames / 2), 1) : 0;
        post("spike: buffer frames=" + frames + " channels=" + chans + " midsample=" + mid + "\n");
        outlet(0, "buffer_result", frames, chans, mid);
      } catch (e2) {
        post("spike: buffer probe FAILED - " + (e2 as Error).message + "\n");
        outlet(0, "buffer_result", -1, -1, 0);
      }
    }, this);
    probe.schedule(500);
  } catch (e) {
    post("spike: buffer_load FAILED - " + (e as Error).message + "\n");
    outlet(0, "buffer_result", -1, -1, 0);
  }
}

/**
 * The path of the UI payload the wrapper already extracted - a real file,
 * guaranteed to exist on disk next to the .amxd.
 *
 * UI_PAYLOAD_NAME, not a hard-coded "ui.html": each device's payload is named
 * after the device (`spike.html`), because every device in a repo extracts into
 * the same folder and a shared name would have them overwrite each other.
 */
function buffer_probe_path(): void {
  var folder = deviceFolder();
  var name = typeof UI_PAYLOAD_NAME !== "undefined" ? UI_PAYLOAD_NAME : "ui.html";
  outlet(0, "probe_path", folder ? folder + "/" + name : "");
}

/**
 * Send raw words to [maxurl] on the spare outlet. See doc/SPIKES.md, spike 1.3.
 *
 * Deliberately NOT a typed helper. Nobody here has confirmed maxurl's message
 * vocabulary inside Live, so guessing one in code would just bake the guess in.
 * The UI sends whatever you type; you watch what comes back. That is what a
 * spike is for.
 *
 * url_send <word> <word> ...    e.g. `url_send download <url> <path>`
 */
function url_send(): void {
  var a = arrayfromargs(arguments);
  if (!a.length) return;
  // outlet 1 is the wrapper's spare/aux outlet; the spike chain wires it to maxurl.
  (outlet as Function).apply(this, ([1] as unknown[]).concat(a));
  post("spike: -> maxurl " + a.join(" ") + "\n");
}

/** Whatever [maxurl] replied. Straight to the UI's message log, verbatim. */
function url_reply(): void {
  var a = arrayfromargs(arguments);
  post("spike: <- maxurl " + a.join(" ") + "\n");
  (outlet as Function).apply(this, ([0, "url_result"] as unknown[]).concat(a));
}
