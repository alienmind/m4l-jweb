/**
 * core.ts - lifecycle, the message guard, and the self-extracting UI payload.
 *
 * This runs inside Max's [js]: an ES5-era interpreter with no modules, no
 * `console` (use `post`), and no `setTimeout` (use `Task`). It is compiled with
 * `target: "ES5"` and the build then re-parses the output with acorn at
 * `ecmaVersion: 5`, refusing to package on failure. One stray modern token
 * kills the whole script at load, with a one-line error and no stack.
 *
 * Outlets:
 *   0 - to [jweb]  ("url ...", "mode ...", "tick ...", "tempo ...", "build ...")
 *   1 - spare/aux  (a second consumer: another engine, a print, ...)
 */

autowatch = 1;
inlets = 1;
outlets = 2;

/**
 * Set from the object box: `js wrapper.js <mode>` (see patcher/devices.mjs).
 * Note jsarguments[0] is the SCRIPT NAME, not the first argument - the device
 * mode is at index 1. Reading index 0 gets you the string "wrapper.js" and a
 * mode comparison that is silently false forever.
 */
var MODE: string = jsarguments.length > 1 ? String(jsarguments[1]) : "midi";

post("m4l-jweb: wrapper loaded (build " + buildStamp() + ", mode " + MODE + ")\n");

/** The build this device instance actually is. Injected by the build. */
function buildStamp(): string {
  return typeof BUILD_STAMP !== "undefined" ? BUILD_STAMP : "dev";
}

/* ------------------------------------------------------------------ *
 * Lifecycle
 *
 * LiveAPI objects created in a patcher-loading context (loadbang) are DEAD:
 * they construct without error and then observe nothing, forever. Create every
 * observer from live.thisdevice's bang, which fires once the device is fully in
 * the Live set. Guard code like `if (obs) return` turns this bug permanent -
 * recreate unconditionally.
 *
 * loadbang does file work only.
 * ------------------------------------------------------------------ */

/** live.thisdevice -> the device is fully loaded. Everything LiveAPI starts here. */
function bang(): void {
  post("m4l-jweb: bang (device ready)\n");
  extractExtraPayloads();
  loadWebview();
  setupTempoObserver(); // liveapi.ts
  startTickPoll(); // liveapi.ts
  // A device's own wrapper/device.ts hooks in here: this is the ONLY safe place
  // to create LiveAPI objects (see the loadbang trap above).
  if (typeof onDeviceReady === "function") onDeviceReady();
}

/** Patcher loaded. File work is safe here; LiveAPI is NOT. */
function loadbang(): void {
  post("m4l-jweb: loadbang\n");
  extractExtraPayloads();
  loadWebview();
}

/** Manual re-init, handy while developing. */
function reload(): void {
  loadWebview();
  setupTempoObserver();
  startTickPoll();
}

/**
 * The [jweb] outlet can fan out to this [js] AND to other consumers, so
 * messages meant for someone else land here too. Swallow them instead of
 * logging "js: no function <name>" on every one.
 */
function anything(): void {}

/* ------------------------------------------------------------------ *
 * Who to answer
 *
 * A reply normally goes out outlet 0, to the device's OWN [jweb]. But a floating
 * window's [jweb] lives inside a subpatcher, so there is no cord to it - the
 * wrapper reaches it BY NAME, through its [r window-read-<id>] (see loadWindows).
 *
 * So a handler must not hard-code outlet(0): when it is answering a WINDOW it has
 * to route to that window's receiver instead. `window()` below sets replyWindow
 * for the duration of a window message's dispatch, and reply() honours it - so the
 * same get_state()/ui_ready() serve the device view AND any window, unchanged.
 * ------------------------------------------------------------------ */

/** The window a reply should go to, or null for the device's own [jweb] (outlet 0). */
var replyWindow: string | null = null;

/**
 * outlet(0, selector, value) that follows replyWindow - to a window's
 * [r window-read-<id>] when one is set, to the device's own [jweb] otherwise.
 *
 * It takes a FIXED (selector, value) rather than a rest arg, and that is
 * deliberate: `outlet` and `messnamed` are Max HOST functions, and calling
 * `.apply` on them is not reliable across Max builds - when it fails it fails
 * SILENTLY, and an exception here takes the whole ui_ready handshake (mode, build,
 * the state resend) down with it, with no symptom but a device that never fills in
 * its header. Every reply the wrapper sends is one selector and one value, so this
 * is all it ever needs.
 */
function reply(selector: string, value: unknown): void {
  if (replyWindow !== null) messnamed("window-read-" + replyWindow, selector, value);
  else outlet(0, selector, value);
}

/**
 * The UI announces it finished loading. The page loads asynchronously, so never
 * assume it was listening when state last changed - resend all of it.
 */
function ui_ready(): void {
  reply("mode", MODE);
  // The UI shows this next to its own baked-in version: a mismatch means a
  // mixed install (stale .amxd instance vs newer extracted UI, or vice versa).
  reply("build", buildStamp());
  sendCurrentTempo(); // liveapi.ts
  // The device resends its own state here. The page loads asynchronously, so
  // anything sent before it was listening is simply gone.
  if (typeof onUiReady === "function") onUiReady();
}

/* ------------------------------------------------------------------ *
 * State persistence
 *
 * A declared `state` slot is a named [dict] in the patcher with a [pattr] bound
 * to it (see applyPersistence in surface.mjs). The pattr is what SAVES: Live
 * stores a pattr's value in the set, and restores it before this script runs.
 * The dict is where the app's JSON lives while the set is open.
 *
 * The app never touches the dict directly - it cannot; it is in the patcher. It
 * asks for a slot (`get_state <id>`) and writes one (`sync_state <id> <json>`),
 * and BOTH selectors carry the id as an ARGUMENT, not in the selector name.
 * That matters: Max dispatches a message on its first word, so an app emitting
 * `sync_state_config` looks for a `function sync_state_config()` that no device
 * has, lands in anything(), and is silently swallowed. It did exactly that -
 * every write was dropped, and the read path worked, so the state looked like it
 * simply never persisted. The app side is @m4l-jweb/surface's stateStore().
 * ------------------------------------------------------------------ */

/** The app asks for a slot. Reply on the inlet it binds: `state_<id> <json>`. */
function get_state(id: string): void {
  try {
    var d = new Dict("obj-state-" + id);
    var json = d.stringify();
    // Logged, because this is the ONLY moment that can tell you whether Live actually
    // restored the slot: the app asks for it once the page is up, and what the dict
    // hands back is what came out of the set. An empty "{}" here after a reopen means
    // the [pattr] did not save - which is a failure with no other symptom.
    post("m4l-jweb: get_state " + id + " -> " + json + "\n");
    reply("state_" + id, json);
  } catch (e) {
    post("m4l-jweb: get_state error for " + id + " - " + (e as Error).message + "\n");
  }
}

/**
 * The app writes a slot: `sync_state <id> <json...>`.
 *
 * The JSON arrives SPLIT: Max parses a message into atoms on whitespace, so
 * anything the app stringified with spaces in it reaches us as several
 * arguments. Join them back before parsing.
 */
function sync_state(id: string): void {
  try {
    var jsonParts: string[] = [];
    for (var i = 1; i < arguments.length; i++) {
      jsonParts.push(String(arguments[i]));
    }
    var json = jsonParts.join(" ");
    var d = new Dict("obj-state-" + id);
    d.parse(json);
    // Read it straight back out. `parse` failing silently, or the dict box not
    // existing at all (it was emitted with an invalid maxclass for a while, so [pattr]
    // bound to nothing), both look exactly like a successful write from here. What the
    // dict says it holds is the only evidence.
    post("m4l-jweb: sync_state " + id + " <- " + json + " (dict now " + d.stringify() + ")\n");
    // BROADCAST the new value to every OTHER view - the device UI and any other
    // window - so a live edit in one page appears in the rest at once. Without this
    // a second page only sees a slot when it next asks for it (on load), which is
    // why an edit in the floating window never reached the device view. The WRITER
    // is skipped: it already applied the value optimistically, and echoing it back
    // could revert the control mid-typing (stateStore has no echo guard).
    broadcastState(id, d.stringify());
  } catch (e) {
    post("m4l-jweb: sync_state error for " + id + " - " + (e as Error).message + "\n");
  }
}

/**
 * Push `state_<id> <json>` to every view except the one that wrote it (replyWindow:
 * a window id, or null for the device view). A window is reached by name, the
 * device view by outlet 0 - the same two paths reply() chooses between.
 */
function broadcastState(id: string, json: string): void {
  if (replyWindow !== null) outlet(0, "state_" + id, json); // device view, unless it wrote
  var ids = listWindowIds();
  for (var i = 0; i < ids.length; i++) {
    if (ids[i] !== replyWindow) messnamed("window-read-" + ids[i], "state_" + id, json);
  }
}

/* ------------------------------------------------------------------ *
 * Native dial visibility (layout.native runtime show/hide) - SPIKE
 *
 * The app (useNativeVisibility) sends `native_show`/`native_hide <varname>` to hide a
 * native `live.*` object the current state does not use - the dynamic visibility a
 * static `presentation` attribute cannot give. We reach the object through the Maxobj
 * API (`this.patcher.getnamed`, the same `this.patcher` deviceFolder() uses) and set
 * its `hidden` flag, LOGGING what we find.
 *
 * The open question, and the whole point of the spike: whether `hidden` (or anything
 * reachable from here) makes a native object leave the M4L device PRESENTATION view
 * at runtime. A first attempt - a `[thispatcher]` running `script hide` - was tried
 * and did NOT work (script acts on the patching canvas, not the presentation). If
 * this one also fails, a frozen M4L device cannot hide a native object at runtime and
 * the fallback is a build-time choice. Watch the Max console for the lines below.
 * ------------------------------------------------------------------ */

function native_show(varname: string): void {
  setNativeHidden(varname, 0);
}
function native_hide(varname: string): void {
  setNativeHidden(varname, 1);
}

function setNativeHidden(varname: string, hidden: number): void {
  try {
    // `this.patcher` is the device patcher (Max's global object IS the jsthis, so a
    // plainly-called function still sees it - deviceFolder() relies on the same).
    var obj = this.patcher.getnamed(varname);
    if (!obj) {
      post("m4l-jweb: native " + varname + " -> getnamed() null (no such scripting name)\n");
      return;
    }
    // `hidden` is the documented Maxobj visibility toggle. CONFIRMED in Live: it
    // reaches the M4L PRESENTATION view, so a native object vanishes from the device
    // view - which is what the two-screen panel flip (useNativePanel) rides on.
    //
    // Reposition/resize does NOT work the same way: setting `presentation_rect` at
    // runtime is accepted but never redrawn in a frozen M4L device (measured). So
    // there is no `native_rect` here - the panel LAYERS views and hides one, rather
    // than reflowing objects, because hide/show is the only thing that takes.
    obj.hidden = hidden;
  } catch (e) {
    post("m4l-jweb: native " + varname + " error: " + (e as Error).message + "\n");
  }
}

/* ------------------------------------------------------------------ *
 * Parameter LOM ids - what the `remote` chain binds to
 *
 * `get_param_id <id>` from the app; `param_id <id> <lomId>` back, 0 if unresolved.
 *
 * WHY THE WRAPPER AND NOT THE APP. A live.remote~ is bound by LOM id, and only [js]
 * can ask Live for one. The app knows the NAME of the parameter it declared; the LOM
 * knows ids and a `name` per DeviceParameter. This is the one place that can join
 * those, because the build wrote `parameter_longname: <id>` from the same surface
 * declaration the app imports - so a surface id IS the Live parameter's name, and the
 * match needs no second table anyone has to keep in step.
 *
 * WHY IT IS ASKED FOR, NOT PUSHED. LOM ids are handles into the running set and are
 * NOT stable across reloads, so there is no moment at which a list of them could be
 * cached and trusted. The app asks when it binds, and asks again on the next load;
 * anything else persists an id, which is the documented way to modulate the wrong
 * parameter after a set reopens.
 *
 * THE REPLY GOES TO THE DEVICE VIEW, not to a window, and it is `outlet(0, ...)` for
 * the same reason `buffer_error` and `fetch_done` are: reply() carries ONE value by
 * fixed arity (a Max host function will not take .apply - it fails silently in Live,
 * which is how the whole ui_ready handshake was once lost), and this answer is a pair.
 * A window is an editor, not an engine - `tick` never reaches one either, and it is the
 * tick that a bound slot is streamed on.
 * ------------------------------------------------------------------ */

function get_param_id(id: string): void {
  // `this_device` resolves to the device this [js] lives in. Its `parameters` are the
  // live.* objects the surface generated, in the order they were created - but ORDER
  // IS NOT A CONTRACT (add a dial and every index shifts), so match on the name.
  var found = 0;
  try {
    var dev = new LiveAPI("this_device");
    if (!dev || !dev.id) {
      post("m4l-jweb: get_param_id " + id + " -> no this_device (called during load?)\n");
      outlet(0, "param_id", id, 0);
      return;
    }
    var n = dev.getcount("parameters");
    for (var i = 0; i < n; i++) {
      var p = new LiveAPI("this_device parameters " + i);
      if (!p || !p.id) continue;
      // `parameter_longname` is what the build set from the surface id, and it comes
      // back as the DeviceParameter's `name`.
      if (String(p.get("name")) === id) {
        found = p.id;
        break;
      }
    }
    if (!found) post("m4l-jweb: get_param_id " + id + " -> no parameter of that name on this device\n");
  } catch (e) {
    post("m4l-jweb: get_param_id " + id + " error: " + (e as Error).message + "\n");
  }
  outlet(0, "param_id", id, found);
}

/* ------------------------------------------------------------------ *
 * Floating-window messages
 *
 * A window's page uses the ORDINARY bridge (`outlet(sel, ...)`), so it emits bare
 * selectors just like the device view. They cannot arrive here bare, though: this
 * [js] already has a get_state/ui_ready/etc, and a window's must not be mistaken
 * for the device view's. So the subpatcher TAGS them - `[prepend window <id>]` on
 * the window's [jweb] outlet (see applyWindows in surface.mjs) - and they land
 * here as `window <id> <selector> <args...>`, dispatched on the first word.
 *
 * We then dispatch the INNER selector through the very same handlers, with
 * replyWindow set so any reply routes back to the window and not the device view.
 * That is what gives a window access to the device's state: `get_state`/
 * `sync_state` reach the shared [dict], and `state_<id>` comes back to the window.
 * Anything the library does not know goes to the device's own onWindowMessage().
 * ------------------------------------------------------------------ */

function window(id: string): void {
  var selector = String(arguments[1]);
  var args: unknown[] = [];
  for (var i = 2; i < arguments.length; i++) args.push(arguments[i]);

  var prev = replyWindow;
  replyWindow = id;
  try {
    if (selector === "ui_ready") ui_ready();
    else if (selector === "get_state") get_state(String(args[0]));
    else if (selector === "sync_state") (sync_state as any).apply(null, args);
    else if (typeof onWindowMessage === "function") (onWindowMessage as any).apply(null, [id, selector].concat(args as any[]));
    else post("m4l-jweb: window " + id + " sent unhandled '" + selector + "'\n");
  } finally {
    replyWindow = prev;
  }
}

/* ------------------------------------------------------------------ *
 * The self-extracting UI payload
 *
 * Chromium (jweb) cannot read Max's frozen virtual filesystem, so a frozen
 * dependency is invisible to it - you cannot ship a UI inside your own device
 * and then open it. But THIS script always runs. So the build appends the UI
 * html to it as base64 (UI_PAYLOAD_B64 / _BYTES / _NAME), and we write it to a
 * real file next to the .amxd on first load and point jweb at that file:// URL.
 * ------------------------------------------------------------------ */

function loadWebview(): void {
  try {
    var url = resolveUiUrl();
    if (!url) return;
    outlet(0, "url", url);
    post("m4l-jweb: sent url " + url + "\n");

    loadWindows();
  } catch (e) {
    post("m4l-jweb: loadWebview error " + (e as Error).message + "\n");
  }
}

/**
 * Point every floating window's [jweb] at its own extracted page.
 *
 * A window's [jweb] lives inside a subpatcher, so there is no cord from this
 * [js] to it. `messnamed` reaches the [r window-read-<id>] the build put next to
 * it - naming the receiver instead of the cord. The ids come from listWindowIds().
 */
function loadWindows(): void {
  var folder = deviceFolder();
  if (!folder) return;

  var ids = listWindowIds();
  var prefix = windowPrefix();
  for (var i = 0; i < ids.length; i++) {
    var winId = ids[i];
    var winUrl = encodeURI("file:///" + folder + "/" + prefix + winId + ".html") + "?v=" + encodeURIComponent(buildStamp());
    messnamed("window-read-" + winId, "url", winUrl);
    post("m4l-jweb: window " + winId + " -> " + winUrl + "\n");
  }
}

/** The `<device>_` prefix a window payload's name carries, so the device's own UI is not one. */
function windowPrefix(): string {
  return typeof UI_PAYLOAD_NAME !== "undefined" ? UI_PAYLOAD_NAME.replace(/\.html$/, "") + "_" : "";
}

/**
 * The id of every floating window this device has, from its extracted payloads.
 *
 * Strip the `<device>_` prefix EXPLICITLY: a regex like /^.*_/ is greedy, so a
 * window id with an underscore in it - `edit_grid` - would come back as `grid`.
 */
function listWindowIds(): string[] {
  var ids: string[] = [];
  if (typeof EXTRA_PAYLOAD_NAMES === "undefined") return ids;
  var prefix = windowPrefix();
  for (var i = 0; i < EXTRA_PAYLOAD_NAMES.length; i++) {
    var name = EXTRA_PAYLOAD_NAMES[i];
    if (name.slice(-5) !== ".html") continue; // a sample, a preset, ...: not a window
    if (prefix && name.slice(0, prefix.length) !== prefix) continue;
    ids.push(name.slice(prefix.length, name.length - 5));
  }
  return ids;
}

function resolveUiUrl(): string | null {
  var folder = deviceFolder();
  if (!folder) {
    post("m4l-jweb: patcher not saved yet - UI path unknown\n");
    return null;
  }
  var name = typeof UI_PAYLOAD_NAME !== "undefined" ? UI_PAYLOAD_NAME : "ui.html";
  var target = folder + "/" + name;

  if (typeof UI_PAYLOAD_B64 !== "undefined" && typeof UI_PAYLOAD_BYTES !== "undefined") {
    extractPayload(target, UI_PAYLOAD_B64, UI_PAYLOAD_BYTES);
  } else {
    post("m4l-jweb: no embedded payload (dev build) - using " + target + "\n");
  }
  // Cache-buster: the URL changes per build, so Chromium can never serve a page
  // it cached from a previous build of the same file path.
  return encodeURI("file:///" + target) + "?v=" + encodeURIComponent(buildStamp());
}

/** The folder the .amxd lives in, derived from the patcher's own path. */
function deviceFolder(): string | null {
  var fp: string = this.patcher.filepath;
  return fp && fp.length ? fp.replace(/\/[^\/]*$/, "") : null;
}

/**
 * Write every non-UI payload the build embedded (manifest `payloads`) next to
 * the .amxd. Same reason as the UI: anything that is not a Max-native object is
 * blind to the frozen virtual filesystem, so it needs a real file.
 *
 * Idempotent, and cheap after the first load: extractPayload() skips a file whose
 * size and build stamp already match.
 */
function extractExtraPayloads(): void {
  // The build emits all three together or none at all; bind them locally so the
  // compiler can see that too.
  if (typeof EXTRA_PAYLOAD_NAMES === "undefined" || typeof EXTRA_PAYLOAD_B64 === "undefined" || typeof EXTRA_PAYLOAD_BYTES === "undefined") {
    return;
  }
  var names = EXTRA_PAYLOAD_NAMES;
  var blobs = EXTRA_PAYLOAD_B64;
  var sizes = EXTRA_PAYLOAD_BYTES;

  var folder = deviceFolder();
  if (!folder) {
    post("m4l-jweb: patcher path unknown - cannot extract payloads\n");
    return;
  }
  for (var i = 0; i < names.length; i++) {
    extractPayload(folder + "/" + names[i], blobs[i], sizes[i]);
  }
}

/**
 * Write an embedded base64 payload to targetPath.
 *
 * Skipped only when BOTH the size matches AND a sidecar .stamp file records the
 * same build - size alone proved too weak, since different builds can collide
 * and leave a stale file that no longer matches the wrapper driving it.
 */
function extractPayload(targetPath: string, b64chunks: string[], byteCount: number): void {
  try {
    var existing = new File(targetPath);
    if (existing.isopen) {
      var sameSize = existing.eof === byteCount;
      existing.close();
      if (sameSize && readTextFile(targetPath + ".stamp") === buildStamp()) return;
    }
  } catch (e) {
    /* fall through and (re)write */
  }
  try {
    var out = new File(targetPath, "write");
    if (!out.isopen) out.open();
    if (!out.isopen) {
      post("m4l-jweb: cannot write " + targetPath + "\n");
      return;
    }
    out.eof = 0;
    // File.writebytes silently truncates large calls (observed ~16 KB cap), so
    // write in small slices and verify the byte count afterwards.
    var SLICE = 4096;
    for (var i = 0; i < b64chunks.length; i++) {
      var bytes = b64decode(b64chunks[i]);
      for (var off = 0; off < bytes.length; off += SLICE) {
        out.writebytes(bytes.slice(off, off + SLICE));
      }
    }
    out.close();

    var check = new File(targetPath);
    var written = check.isopen ? check.eof : -1;
    if (check.isopen) check.close();
    if (written === byteCount) {
      post("m4l-jweb: extracted " + written + " bytes to " + targetPath + "\n");
      writeTextFile(targetPath + ".stamp", buildStamp());
    } else {
      post("m4l-jweb: extract SIZE MISMATCH - wrote " + written + ", expected " + byteCount + "\n");
    }
  } catch (e2) {
    post("m4l-jweb: extract failed - " + (e2 as Error).message + "\n");
  }
}

function readTextFile(p: string): string | null {
  try {
    var f = new File(p);
    if (!f.isopen) return null;
    var s = f.readstring(Math.min(f.eof, 256));
    f.close();
    return s;
  } catch (e) {
    return null;
  }
}

function writeTextFile(p: string, s: string): void {
  try {
    var f = new File(p, "write");
    if (!f.isopen) f.open();
    if (!f.isopen) return;
    f.eof = 0;
    f.writestring(s);
    f.close();
  } catch (e) {
    /* non-fatal */
  }
}

var B64CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
var b64lookup: { [c: string]: number } | null = null;

/** Base64 -> array of byte values. Max's [js] has no atob. */
function b64decode(s: string): number[] {
  if (!b64lookup) {
    b64lookup = {};
    for (var i = 0; i < B64CHARS.length; i++) b64lookup[B64CHARS.charAt(i)] = i;
  }
  var out: number[] = [];
  var buffer = 0;
  var bits = 0;
  for (var j = 0; j < s.length; j++) {
    var c = s.charAt(j);
    if (c === "=") break;
    buffer = (buffer << 6) | b64lookup[c];
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Fetch-to-disk
 *
 * `fetchToFile(url, path)` in the app, [maxurl] in the patcher (the "download"
 * chain), and this, orchestrating between them. Bulk data must never cross the
 * Max message bridge, so the bytes go from libcurl STRAIGHT to disk and only the
 * result comes back as a message.
 *
 * ------------------------------------------------------------------------------
 * THE THREE THINGS THAT MADE THIS LOOK IMPOSSIBLE, all in maxurl's request dict:
 *
 *   1. THE KEY IS `filename_out`. It was `downloadfilename` here, which is not a
 *      key maxurl has - and an unknown key in a request dict is IGNORED, not
 *      rejected. So the request succeeded (HTTP 200, every time), the body went
 *      into the response dict, and nothing was ever written to disk. A perfect
 *      success and an empty folder. It is `filename_out` in Max's own reference
 *      (docs/refpages/max-ref/maxurl.maxref.xml, the `dictionary` message) and in
 *      the maxurl.maxhelp that ships with Live. Do not guess these names.
 *
 *   2. `overwrite_output_file` DEFAULTS TO 0. maxurl refuses to overwrite a file
 *      that already exists - so even with the right key, the download works once
 *      and then silently stops working. Set it to 1.
 *
 *   3. THE PATH IS AN OS PATH. maxurl is libcurl, not a Max file object: it does
 *      not know `~/`, and it does not know Max's `Desktop:/` style. It needs an
 *      absolute path, which is why a relative one is resolved against the device
 *      folder below.
 *
 * `response_dict` names the reply dict, so what comes back on maxurl's outlets is
 * identifiable rather than a dict called "output" shared with anyone else's request.
 *
 * ------------------------------------------------------------------------------
 * DOWNLOAD, THEN PLACE - why every fetch is TWO maxurl requests.
 *
 * A 404 is a RESPONSE, and maxurl writes it: point `filename_out` at a file you
 * already rely on and a missing URL replaces it with the error page. Measured, not
 * feared - see doc/ARCHITECTURE.md, where a 404 destroyed a good 1.2 MB cached .wav
 * and reported status 404 while doing it. `overwrite_output_file` does not care what
 * the status was.
 *
 * Everywhere else in computing the answer is "write to a temp path and move it into
 * place on success". Max's [js] cannot: its `File` object has open, close, and the
 * read/write family, and NOTHING ELSE. No rename. No delete. (Confirmed twice - in
 * Cycling '74's reference, and by asking the live object what members it has.)
 *
 * So MAXURL DOES THE MOVE. It is libcurl, and libcurl speaks `file://`: a GET of
 * `file:///<temp>` with `filename_out` set to the destination is a native, streaming
 * file copy, on maxurl's own thread, with not one byte passing through [js]. Measured
 * at 6 ms for 1 MB. The download therefore goes:
 *
 *   1. GET <url>          -> filename_out <dest>.part     (a bad response lands HERE)
 *   2. validate           status 2xx, no `error` key, bytes on disk > 0
 *   3. GET file://<part>  -> filename_out <dest>          (only now is <dest> touched)
 *
 * A failure at 1 or 2 leaves the destination UNTOUCHED, which is the entire point.
 *
 * TWO TRAPS IN STEP 3, both of which look like success:
 *
 *   - A file:// reply has NO HTTP STATUS. It comes back `status 0`, which the 2xx
 *     check in step 2 would reject as a failure. The copy is validated on BYTES - the
 *     destination is the same size as the part file - which is the honest check anyway
 *     and the only one that survives both schemes.
 *   - The .part file cannot be DELETED afterwards (no unlink, see above), so it is
 *     TRUNCATED to zero bytes instead. It costs an inode, not a megabyte, and the next
 *     fetch to the same destination overwrites it.
 * ------------------------------------------------------------------ */

/** The reply dicts. Named, so nothing else can be mistaken for them - and so the two phases cannot be mistaken for each other. */
var FETCH_RESPONSE_DICT = "m4ljweb_fetch_response";
var PLACE_RESPONSE_DICT = "m4ljweb_place_response";

/** Where a download lands before it has earned its destination. */
function partPath(destPath: string): string {
  return destPath + ".part";
}

interface ActiveFetch {
  requestId: string;
  url: string;
  destPath: string;
  /** Bytes in the .part file, carried from the download phase into the place phase. */
  partBytes: number;
}

// One at a time: [maxurl] can run several, but a queue keeps `currentFetch`
// unambiguous, and a device downloading its samples wants them in order anyway.
var fetchQueue: ActiveFetch[] = [];
var currentFetch: ActiveFetch | null = null;

/**
 * An absolute OS path for libcurl, from whatever the app asked for.
 *
 * A relative path is resolved against the DEVICE's folder - the one place a
 * device can always write, and the same folder the UI payload is extracted into.
 * An absolute path (POSIX `/...`, or Windows `C:/...`) is passed through.
 */
function resolveFetchPath(destPath: string): string {
  var isAbsolute = destPath.indexOf("/") === 0 || destPath.indexOf(":") === 1;
  if (isAbsolute) return destPath;
  var folder = deviceFolder();
  return folder ? folder + "/" + destPath : destPath;
}

/** PHASE 1: download the URL to `<dest>.part`. Nothing touches `<dest>` yet. */
function processNextFetch(): void {
  if (currentFetch || fetchQueue.length === 0) return;
  var next = fetchQueue.shift();
  if (!next) return;
  currentFetch = next;
  next.destPath = resolveFetchPath(next.destPath);

  var reqDict = new Dict();
  reqDict.set("url", next.url);
  reqDict.set("http_method", "get");
  reqDict.set("filename_out", partPath(next.destPath)); // NOT the destination - see above
  reqDict.set("overwrite_output_file", 1); // ...or it downloads exactly once, ever
  reqDict.set("response_dict", FETCH_RESPONSE_DICT);

  post("m4l-jweb: fetch " + next.url + " -> " + next.destPath + "\n");
  // Outlet 1 is the aux outlet; the "download" chain routes `maxurl` off it.
  outlet(1, "maxurl", "dictionary", reqDict.name);
}

/**
 * PHASE 3: ask libcurl to copy the validated .part file over the destination.
 *
 * This is the "move" that [js] cannot do. `file://` is a scheme libcurl handles, so
 * maxurl streams the file on its own thread and nothing crosses the message bridge.
 */
function placeFetch(fetched: ActiveFetch): void {
  var reqDict = new Dict();
  reqDict.set("url", encodeURI("file:///" + partPath(fetched.destPath)));
  reqDict.set("http_method", "get");
  reqDict.set("filename_out", fetched.destPath);
  reqDict.set("overwrite_output_file", 1);
  reqDict.set("response_dict", PLACE_RESPONSE_DICT);
  outlet(1, "maxurl", "dictionary", reqDict.name);
}

/* ------------------------------------------------------------------ *
 * Samples - the `samples` chain
 * ------------------------------------------------------------------ */

/**
 * The app: `buffer_load <slot> <path>` - read a file into that slot's [buffer~].
 *
 * WHY THIS GOES THROUGH [js] AT ALL, when the chain could route it straight to the
 * buffer: because the path the app wrote is not a path [buffer~] can open, and it
 * fails in the two ways this file exists to prevent.
 *
 * A RELATIVE path is resolved against the device's folder - the same resolution
 * `fetch_to_file` does, and it has to be the same one or the app downloads a file to
 * one place and loads it from another. [buffer~] does not resolve it that way: a bare
 * name is looked up in MAX's SEARCH PATH, which does not contain the device's folder,
 * so `preview.wav` - freshly downloaded, right there next to the .amxd - reports
 * "can't open" and the promise times out.
 *
 * ...and the resolved path CONTAINS SPACES on a normal Live install ("Ableton
 * Library", "Max For Live"). A message travelling through the patcher as text would
 * split there into three atoms and [buffer~] would open the first one. Handed out of
 * [js] as a string, it stays ONE symbol all the way to `replace`.
 *
 * The file is checked before the buffer is asked for it, because a missing file makes
 * [buffer~] print to the Max console and stay silent - there is no failure bang to
 * bind to, and the app would learn nothing until the timeout. `buffer_error` says so
 * at once.
 */
function buffer_load(slot: string, path: string): void {
  var resolved = resolveFetchPath(path); // the same folder the download wrote to
  var f: File | null = null;
  try {
    f = new File(resolved, "read");
  } catch (e) {
    f = null;
  }
  if (!f || !f.isopen) {
    outlet(0, "buffer_error", slot, "no file at " + resolved);
    return;
  }
  var bytes = f.eof;
  f.close();
  if (!bytes) {
    outlet(0, "buffer_error", slot, "empty file at " + resolved);
    return;
  }

  // Outlet 1 is the aux outlet; the `samples` chain routes `buffer_replace` off it,
  // exactly as the `download` chain routes `maxurl`. Outlet 0 belongs to [jweb].
  post("m4l-jweb: buffer_load " + slot + " -> " + resolved + "\n");
  outlet(1, "buffer_replace", slot, resolved);
}

/** The app: `fetch_to_file <requestId> <url> <destPath>`. */
function fetch_to_file(requestId: string, url: string, destPath: string): void {
  fetchQueue.push({ requestId: requestId, url: url, destPath: destPath, partBytes: 0 });
  processNextFetch();
}

/**
 * maxurl finished: `maxurl_done dictionary <name>` (outlet 0, via [prepend]).
 *
 * Both phases land here, told apart by the response dict they asked for.
 */
function maxurl_done(msgType: string, dictName: string): void {
  if (msgType !== "dictionary") return;
  // A device's own wrapper/device.ts may drive [maxurl] itself (a cache, a spike) and
  // its replies come back down this same cord. Offer it the reply first: without this
  // hook, a request the device made lands here, finds no `currentFetch`, and is
  // dropped in silence - which looks exactly like maxurl never answering.
  if (typeof onMaxurlReply === "function" && onMaxurlReply(dictName)) return;
  if (!currentFetch) return;
  var fetched = currentFetch;

  try {
    if (dictName === PLACE_RESPONSE_DICT) finishPlace(fetched);
    else finishDownload(fetched, dictName);
  } catch (e) {
    post("m4l-jweb: maxurl_done error - " + (e as Error).message + "\n");
    failFetch(fetched, "wrapper error: " + (e as Error).message);
  }
}

/**
 * PHASE 2: did the download earn its destination?
 *
 * All three checks, and all three are load-bearing: a filesystem failure comes back as
 * status 200 with an `error` key, and a `filename_out` maxurl ignored comes back as a
 * clean 200 with nothing on disk. Only the file itself proves the file.
 */
function finishDownload(fetched: ActiveFetch, dictName: string): void {
  var d = new Dict(dictName);
  var status = Number(d.get("status"));
  var errorMsg = d.get("error");
  var bytes = fileSize(partPath(fetched.destPath));

  if (errorMsg) return failFetch(fetched, String(errorMsg));
  if (status < 200 || status >= 300) return failFetch(fetched, "HTTP " + status);
  if (bytes <= 0) return failFetch(fetched, "HTTP " + status + " but nothing was written to disk");

  fetched.partBytes = bytes;
  placeFetch(fetched); // ...and only now does the destination get touched
}

/**
 * PHASE 3 (reply): validate the copy ON BYTES, not on status.
 *
 * A `file://` request has no HTTP status - it comes back as `status 0`, measured - so
 * the 2xx check that guards the download would reject a perfectly good copy here. The
 * size is the honest check for both schemes anyway.
 */
function finishPlace(fetched: ActiveFetch): void {
  var placed = fileSize(fetched.destPath);
  if (placed !== fetched.partBytes) {
    return failFetch(fetched, "could not place the download: " + placed + " bytes at the destination, expected " + fetched.partBytes);
  }
  truncate(partPath(fetched.destPath)); // [js] cannot DELETE it; zero it instead
  post("m4l-jweb: fetched " + placed + " bytes to " + fetched.destPath + "\n");
  outlet(0, "fetch_done", fetched.requestId, placed);
  currentFetch = null;
  processNextFetch();
}

/** The destination is untouched whenever this is called from phase 1 or 2. That is the point. */
function failFetch(fetched: ActiveFetch, message: string): void {
  post("m4l-jweb: fetch failed - " + message + "\n");
  outlet(0, "fetch_error", fetched.requestId, message);
  currentFetch = null;
  processNextFetch();
}

/** Bytes on disk, or -1 if there is no readable file there. */
function fileSize(p: string): number {
  try {
    var f = new File(p);
    if (!f.isopen) return -1;
    var n = f.eof;
    f.close();
    return n;
  } catch (e) {
    return -1;
  }
}

/** Zero a file. The closest thing to `delete` that [js] has - it has no unlink. */
function truncate(p: string): void {
  try {
    var f = new File(p, "write");
    if (!f.isopen) f.open();
    if (!f.isopen) return;
    f.eof = 0;
    f.close();
  } catch (e) {
    /* a leftover .part is untidy, not a failure */
  }
}

/**
 * maxurl's progress outlet, via [prepend maxurl_progress]:
 *
 *   maxurl_progress <response-dict-name> <dl total> <dl now> <ul total> <ul now>
 *
 * FIVE atoms, starting with the dict NAME - per the reference (outlet 1). This
 * used to be read as `(downloaded, total, percent)`, so the "bytes downloaded"
 * the UI showed was actually a symbol, and the total was the download total. And
 * note the reference's warning: not every server sends a content length, so the
 * TOTAL can legitimately be 0. Do not divide by it.
 */
function maxurl_progress(dictName: string, dlTotal: number, dlNow: number): void {
  if (!currentFetch) return;
  // The local file:// copy reports progress too. It is not the download, and a UI that
  // showed it would run its progress bar twice - the second time in a few milliseconds.
  if (dictName !== FETCH_RESPONSE_DICT) return;
  outlet(0, "fetch_progress", currentFetch.requestId, dlNow, dlTotal);
}
