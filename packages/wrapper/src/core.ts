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

/**
 * The UI announces it finished loading. The page loads asynchronously, so never
 * assume it was listening when state last changed - resend all of it.
 */
function ui_ready(): void {
  outlet(0, "mode", MODE);
  // The UI shows this next to its own baked-in version: a mismatch means a
  // mixed install (stale .amxd instance vs newer extracted UI, or vice versa).
  outlet(0, "build", buildStamp());
  sendCurrentTempo(); // liveapi.ts
  // The device resends its own state here. The page loads asynchronously, so
  // anything sent before it was listening is simply gone.
  if (typeof onUiReady === "function") onUiReady();
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
  } catch (e) {
    post("m4l-jweb: loadWebview error " + (e as Error).message + "\n");
  }
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
