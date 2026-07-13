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
 * Pass an AUDIO file. The first cut of this spike pointed `replace` at the
 * wrapper's own extracted spike.html - chosen because it certainly exists - and
 * that was a mistake: buffer~ decodes audio, so an HTML file leaves it untouched
 * and the probe reports the buffer's declared size, which looks like a pass.
 * `jongly.aif` ships with Max and lives on its search path, so a bare filename
 * with no directory at all is the cleanest possible subject.
 *
 * NOTE the Buffer binding's exact API surface is PART of what this spike tests.
 * If `send` or `framecount` is not what Max's [js] exposes, the catch below is
 * the finding - post it and record it, do not work around it.
 *
 * buffer_load <path>   (an audio file: a bare `jongly.aif`, or any .wav on disk)
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
    // The baseline. The buffer~ is declared with no size, so this should be 0 -
    // and printing it is what stops a later non-zero reading from being the
    // buffer's own dimensions wearing the result's clothes.
    post("spike: buffer before replace frames=" + b.framecount() + "\n");
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

/**
 * Download a URL to a FILE on disk. See doc/SPIKES.md, spike 1.3.
 *
 * `url_send` above forwards raw words, and raw words turn out not to be enough:
 * per the maxurl reference, `get <url>` hands the BODY back through an outlet,
 * and the download-to-file form is not a flat message at all. It is a
 * `dictionary <name>` message carrying a dict whose `filename_out` key names the
 * output file. So [js] has to build the dict - nothing else in the patcher can -
 * and the Dict binding is therefore part of what this spike tests, exactly as
 * Buffer was for 1.2. See max.d.ts.
 *
 * Keys, from the reference and not from memory: url, http_method, filename_out,
 * overwrite_output_file, response_dict, headers, timeout.
 *
 * url_download <url> [dest]   dest defaults to spike_download.wav next to the .amxd
 */
function url_download(): void {
  var a = arrayfromargs(arguments);
  var url = a.length ? String(a[0]) : "";
  if (!url) {
    post("spike: url_download needs a url\n");
    return;
  }
  // Default the destination next to the .amxd, where the UI payload already
  // lands - a folder we know is writable, because the wrapper writes to it on
  // every load.
  var dest = a.length > 1 ? String(a[1]) : deviceFolder() + "/spike_download.wav";

  try {
    var d = new Dict("m4ljweb_spike_req");
    d.clear();
    d.set("url", url);
    d.set("http_method", "get");
    d.set("filename_out", dest);
    d.set("overwrite_output_file", 1);
    d.set("response_dict", "m4ljweb_spike_res");
    d.set("timeout", 30);
    post("spike: url_download req " + d.stringify() + "\n");

    // outlet 1 is the wrapper's spare outlet; the spike chain wires it to maxurl.
    outlet(1, "dictionary", "m4ljweb_spike_req");
    outlet(0, "download_path", dest);
    post("spike: url_download -> maxurl, dest " + dest + "\n");
  } catch (e) {
    post("spike: url_download FAILED - " + (e as Error).message + "\n");
    post("spike: ^ if that is about Dict, THAT is the finding. Record it.\n");
  }
}

/**
 * Does the file actually exist on disk, and how big is it?
 *
 * maxurl saying "done" is not the finding. The file is the finding. And this is
 * the project that already learned File.writebytes truncates silently past 16 KB,
 * so "a file appeared" is not the same as "the bytes are all there" - hence the
 * byte count, not just isopen.
 *
 * url_check <path>
 */
function url_check(): void {
  var a = arrayfromargs(arguments);
  var path = a.length ? String(a[0]) : "";
  if (!path) return;
  try {
    var f = new File(path, "read");
    if (!f.isopen) {
      post("spike: url_check NO FILE at " + path + "\n");
      outlet(0, "url_check_result", 0);
      return;
    }
    var bytes = f.eof;
    f.close();
    post("spike: url_check " + bytes + " bytes at " + path + "\n");
    outlet(0, "url_check_result", bytes);
  } catch (e) {
    post("spike: url_check FAILED - " + (e as Error).message + "\n");
    outlet(0, "url_check_result", -1);
  }
}

/**
 * Whatever [maxurl] replied, from WHICHEVER outlet - the chain prefixes the
 * outlet index, because "which outlet does completion arrive on" is one of the
 * things SPIKES.md says to find out and one of the things CLAUDE.md says never
 * to trust from memory.
 *
 * If the reply names a dictionary, dump it: maxurl's answer to a `dictionary`
 * request is itself a dict, and its contents (status code, error, headers) are
 * what tell an HTTP failure apart from a filesystem one.
 *
 * url_reply <outletIndex> <word> ...
 */
function url_reply(): void {
  var a = arrayfromargs(arguments);
  post("spike: <- maxurl " + a.join(" ") + "\n");

  for (var i = 0; i < a.length; i++) {
    if (String(a[i]) === "dictionary" && i + 1 < a.length) {
      try {
        var res = new Dict(String(a[i + 1]));
        post("spike: <- maxurl dict " + res.stringify() + "\n");
      } catch (e) {
        post("spike: could not read the reply dict - " + (e as Error).message + "\n");
      }
    }
  }

  (outlet as Function).apply(this, ([0, "url_result"] as unknown[]).concat(a));
}
