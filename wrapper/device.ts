/**
 * device.ts - the MAX CONFORMANCE CHECK.
 *
 * `tests/wrapper-max.test.mjs` runs the shipped wrapper against a FAKE Max and proves
 * the code still honours the contract. It cannot prove the contract: the fake is our
 * belief about Max, and a belief cannot falsify itself. If a Live update changes what
 * [maxurl] does, that suite passes and every device breaks.
 *
 * This is the other half, and the only half that can fail for the right reason. It
 * asserts, IN LIVE, the handful of Max behaviours the architecture actually rests on -
 * each one measured once, each one load-bearing, each one silent when it breaks. Drop
 * `hello-downloads` on a track, press the button, read the Max console (View -> Max
 * Console).
 *
 * RUN IT WHEN LIVE OR MAX IS UPDATED. That is the whole point of it existing.
 *
 * It is deliberately not automated: nothing can drive Live headlessly, and a check
 * that lies about having run is worse than one you have to press a button for.
 */

var CONFORMANCE_SRC = "";
var CONFORMANCE_DST = "";
/** The same source, named the way a SAVE names its staging file. */
var CONFORMANCE_PART = "";
var CONFORMANCE_PART_DST = "";
/** ...and the same again, written ACROSS MESSAGE TURNS, the way a save writes. */
var CONFORMANCE_TURNS = "";
var CONFORMANCE_TURNS_DST = "";
var conformancePass = 0;
var conformanceFail = 0;

/** One MB of known bytes: big enough that a slow copy would be visible. */
var CONFORMANCE_BYTES = 1048576;

function check(name: string, ok: boolean, detail: string): void {
  if (ok) conformancePass++;
  else conformanceFail++;
  post((ok ? "  PASS  " : "  FAIL  ") + name + " -> " + detail + "\n");
}

function conformanceFolder(): string | null {
  var fp: string = this.patcher.filepath;
  return fp && fp.length ? fp.replace(/\/[^\/]*$/, "") : null;
}

/** The app's button: `max_conformance`. */
function max_conformance(): void {
  var folder = conformanceFolder();
  if (!folder) {
    post("CONFORMANCE: the device is not saved - no folder to write in.\n");
    return;
  }
  CONFORMANCE_SRC = folder + "/conformance_source.bin";
  CONFORMANCE_DST = folder + "/conformance_dest.bin";
  CONFORMANCE_PART = folder + "/conformance_source.part";
  CONFORMANCE_PART_DST = folder + "/conformance_part_dest.bin";
  CONFORMANCE_TURNS = folder + "/conformance_turns.part";
  CONFORMANCE_TURNS_DST = folder + "/conformance_turns_dest.bin";
  conformancePass = 0;
  conformanceFail = 0;

  post("\n===== m4l-jweb: MAX CONFORMANCE =====\n");
  post("Asserting the Max behaviours this architecture depends on.\n");

  checkFileApi();
  checkFileWrite();
  checkMaxurlCopy(); // async: the verdict lands in onMaxurlReply()
}

/**
 * [js]'s `File` has NO rename and NO delete.
 *
 * The whole two-phase download exists because of this absence. If a future Max ADDS
 * one, this fails - and that failure is good news: it means `fetchToFile()` can drop
 * the file:// copy for a plain move. A check that only ever fails for bad reasons is a
 * check nobody reads.
 */
function checkFileApi(): void {
  var f = new File(CONFORMANCE_SRC, "write");
  var movers = ["rename", "move", "remove", "delete", "unlink", "copy"];
  var found: string[] = [];
  for (var i = 0; i < movers.length; i++) {
    if (typeof (f as any)[movers[i]] !== "undefined") found.push(movers[i]);
  }
  var hasBytes = typeof f.writebytes === "function" && typeof (f as any).readbytes === "function";
  if (f.isopen) f.close();

  check(
    "File has no way to move or delete a file",
    found.length === 0,
    found.length ? "FOUND: " + found.join(", ") + " - fetchToFile() can now be simplified!" : "as expected: open/close/read/write only",
  );
  check("File can read and write bytes", hasBytes, hasBytes ? "readbytes + writebytes present" : "MISSING - payload extraction cannot work");
}

/** `File.writebytes` truncates silently past ~16 KB, so the wrapper writes in 4 KB slices. */
function checkFileWrite(): void {
  var f = new File(CONFORMANCE_SRC, "write");
  if (!f.isopen) f.open();
  f.eof = 0;
  var slice: number[] = [];
  for (var i = 0; i < 4096; i++) slice.push(i % 256);
  for (var w = 0; w < CONFORMANCE_BYTES / 4096; w++) f.writebytes(slice);
  f.close();

  var v = new File(CONFORMANCE_SRC);
  var n = v.isopen ? v.eof : -1;
  if (v.isopen) v.close();
  check("File.writebytes in 4 KB slices writes every byte", n === CONFORMANCE_BYTES, n + " bytes written, expected " + CONFORMANCE_BYTES);

  // ...and `eof = 0` is the only "delete" [js] has. The wrapper zeroes its .part files
  // with it, because it cannot unlink them.
  var t = new File(CONFORMANCE_SRC + ".tmp", "write");
  if (!t.isopen) t.open();
  t.writestring("some content");
  t.eof = 0;
  t.close();
  var tv = new File(CONFORMANCE_SRC + ".tmp");
  var tn = tv.isopen ? tv.eof : -1;
  if (tv.isopen) tv.close();
  check("assigning eof = 0 truncates a file", tn === 0, tn + " bytes left, expected 0");
}

/**
 * THE ONE THAT MAKES `fetchToFile()` SAFE: [maxurl] copies a `file://` URL.
 *
 * A download goes to `<dest>.part` and is only copied over `<dest>` once it has been
 * validated - and libcurl does that copy, because [js] cannot move a file. If this
 * ever stops working, a 404 goes back to destroying good cached files.
 */
function checkMaxurlCopy(): void {
  placeCopy(CONFORMANCE_SRC, CONFORMANCE_DST, "m4ljweb_conformance_response");
}

/** One place request. The two checks differ in the SOURCE FILENAME and nothing else. */
function placeCopy(src: string, dst: string, responseDict: string): void {
  var d = new Dict();
  d.set("url", encodeURI("file:///" + src));
  d.set("http_method", "get");
  d.set("filename_out", dst); // NOT "downloadfilename" - an unknown key is ignored
  d.set("overwrite_output_file", 1); // ...defaults to 0: it would copy exactly once
  d.set("response_dict", responseDict);
  outlet(1, "maxurl", "dictionary", d.name);
}

/**
 * The same place, from a source whose only difference is the EXTENSION.
 *
 * `saveToFile()` stages into `m4l-jweb-save.part` and its place fails with
 * `Couldn't read a file:// file`, while this check's `.bin` in the same folder, written
 * by the same `File` recipe, places fine. A download's `<dest>.part` also places fine -
 * but maxurl wrote that one. So `.part` written by [js] is the untested corner, and
 * this is the one property varied on its own.
 */
function checkMaxurlCopyPart(): void {
  var f = new File(CONFORMANCE_PART, "write");
  if (!f.isopen) f.open();
  f.eof = 0;
  var slice: number[] = [];
  for (var i = 0; i < 4096; i++) slice.push(i % 256);
  for (var w = 0; w < CONFORMANCE_BYTES / 4096; w++) f.writebytes(slice);
  f.close();

  var v = new File(CONFORMANCE_PART);
  var n = v.isopen ? v.eof : -1;
  if (v.isopen) v.close();
  check("a .part source is on disk before the place", n === CONFORMANCE_BYTES, n + " bytes at " + CONFORMANCE_PART);

  placeCopy(CONFORMANCE_PART, CONFORMANCE_PART_DST, "m4ljweb_conformance_part_response");
}

var turnsFile: File | null = null;
var turnsWritten = 0;
var turnsTask: Task | null = null;
var TURNS = 8;

/**
 * The last property that separates a save from a copy that works: TIME.
 *
 * Every passing place writes its source inside a single message turn. A save does not
 * - `save_begin` opens the file, N `save_chunk` messages write it, and `save_end`
 * closes it, each a separate turn of the Max scheduler, with the File object held open
 * across all of them. If a handle opened in one turn is not truly free in a later one,
 * this check fails while the one above it passes, and everything else is identical.
 */
function checkMaxurlCopyTurns(): void {
  turnsFile = new File(CONFORMANCE_TURNS, "write");
  if (!turnsFile.isopen) turnsFile.open();
  turnsFile.eof = 0;
  turnsWritten = 0;
  turnsTask = new Task(writeOneTurn, this);
  turnsTask.interval = 10;
  turnsTask.repeat(TURNS);
}

/** One turn's worth of the source. 32 slices of 4 KB, because writebytes truncates. */
function writeOneTurn(): void {
  if (!turnsFile) return;
  var slice: number[] = [];
  for (var i = 0; i < 4096; i++) slice.push(i % 256);
  var per = CONFORMANCE_BYTES / 4096 / TURNS;
  for (var w = 0; w < per; w++) turnsFile.writebytes(slice);
  turnsWritten++;
  if (turnsWritten < TURNS) return;

  if (turnsFile.isopen) turnsFile.close();
  turnsFile = null;

  var v = new File(CONFORMANCE_TURNS);
  var n = v.isopen ? v.eof : -1;
  if (v.isopen) v.close();
  check("a .part written across message turns is on disk", n === CONFORMANCE_BYTES, n + " bytes, expected " + CONFORMANCE_BYTES);

  placeCopy(CONFORMANCE_TURNS, CONFORMANCE_TURNS_DST, "m4ljweb_conformance_turns_response");
}

/**
 * The wrapper offers us [maxurl]'s reply before it assumes the reply is its own.
 * Return true when it was ours.
 */
function onMaxurlReply(dictName: string): boolean {
  if (dictName === "m4ljweb_conformance_part_response") {
    var pd = new Dict(dictName);
    var perr = pd.get("error");
    var pplaced = new File(CONFORMANCE_PART_DST);
    var pn = pplaced.isopen ? pplaced.eof : -1;
    if (pplaced.isopen) pplaced.close();
    check(
      "...and copies one whose source is named .part",
      pn === CONFORMANCE_BYTES,
      pn + " bytes at the destination" + (perr ? ", error: " + String(perr) : ""),
    );
    checkMaxurlCopyTurns();
    return true;
  }
  if (dictName === "m4ljweb_conformance_turns_response") {
    var td = new Dict(dictName);
    var terr = td.get("error");
    var tplaced = new File(CONFORMANCE_TURNS_DST);
    var tn = tplaced.isopen ? tplaced.eof : -1;
    if (tplaced.isopen) tplaced.close();
    check(
      "...and copies one written across message turns",
      tn === CONFORMANCE_BYTES,
      tn + " bytes at the destination" + (terr ? ", error: " + String(terr) : ""),
    );
    finishConformance();
    return true;
  }
  if (dictName !== "m4ljweb_conformance_response") return false;

  var d = new Dict(dictName);
  var status = Number(d.get("status"));
  var err = d.get("error");
  var placed = new File(CONFORMANCE_DST);
  var n = placed.isopen ? placed.eof : -1;
  if (placed.isopen) placed.close();

  check("[maxurl] copies a file:// URL to filename_out", n === CONFORMANCE_BYTES, n + " bytes at the destination, expected " + CONFORMANCE_BYTES);
  // Measured: a local copy reports status 0, because no HTTP happened. finishPlace()
  // validates on BYTES for exactly this reason - a 2xx check here would reject a good
  // copy. If Max starts returning 200, that is fine; if it starts returning an ERROR,
  // the copy is broken and the two-phase download has lost its mover.
  check("...and reports no error doing it", !err, err ? "error: " + String(err) : "no error key (status " + status + ")");

  // The verdict waits for the .part variant - it is the same copy, one property apart.
  checkMaxurlCopyPart();
  return true;
}

function finishConformance(): void {
  post("===== " + conformancePass + " passed, " + conformanceFail + " failed =====\n");
  if (conformanceFail > 0) {
    post("A FAILURE HERE MEANS MAX CHANGED. The unit tests cannot see it: they run\n");
    post("against a fake Max built from these very assumptions. Fix the wrapper, then\n");
    post("update doc/MAX-FACTS.md - 'What Max actually does' - and the fake in\n");
    post("tests/wrapper-max.test.mjs, in that order.\n");
  }
  post("\n");
}

/* ==================================================================== *
 * push-probe - THE SPIKE BEHIND doc/PUSH-USECASES.md (and MAX-FACTS.md, "Grabbing a Push control").
 *
 * The questions U1-U6 are ANSWERED and written up in doc/MAX-FACTS.md,
 * "Grabbing a Push control". What is left here is the machinery that answering
 * them proved correct, plus the parts still asking something:
 *
 *   scan / names        resolve the surface and the control vocabulary
 *   grab / release      BY NAME - the one addressing Live accepts
 *   paint / clear       send_value, and the deferred first frame
 *   palette             still open: the colour NAMES are not derived yet
 *   other <name>        still open: what Mpe_Pitch_Bend_Elements and the
 *                       *_Press_Event_Matrix controls carry
 *
 * DELETED, because each answered its question and a spike that keeps its
 * scaffolding stops being readable: the four grab strategies (only by-name and the
 * two-atom `id <n>` work, and by-name needs no id at all), the four release
 * strategies, the corner paints (the grab gates output; a palette shows it better),
 * `info` (the dump is in the fact), `bench` (2.6 ms per full frame, flat), and
 * `encoders` (grabbable, and therefore refused by the library).
 *
 * IT RUNS IN ONE DEVICE ONLY. `wrapper/device.ts` is concatenated into EVERY
 * device this repo builds, so each entry point refuses unless the [js] object-box
 * argument says `probe` (`mode: "probe"` in patcher/devices.mjs).
 * ==================================================================== */

/** The [js] object-box argument that says this build is the probe. */
var PROBE_MODE = "probe";

/** live_app, observing `control_surfaces` - a Push can be plugged in mid-set. */
var probeApp: LiveAPI | null = null;
/** The control surface we picked, and what Live calls its class. */
var probeSurface: LiveAPI | null = null;
var probeSurfaceType = "";
/** The 8x8 grid: ONE control, one id - not sixty-four. */
var probeMatrix: LiveAPI | null = null;
var probeMatrixId = 0;
/** The value observer. Dropping this reference kills the observer with it. */
var probeValueObs: LiveAPI | null = null;
/** The observer for whatever probe_other last grabbed. */
var probeOtherObs: LiveAPI | null = null;
/** The first atom of each event probe_other saw, for the delta-or-absolute verdict. */
var probeOtherValues: number[] = [];
/** How many more raw callback payloads to dump. Bounded so a held pad cannot flood. */
var probeRawLeft = 0;
/** The deferred first frame after a grab - see probe_grab. */
var probeFirstFrameTask: Task | null = null;

/**
 * Every line goes to BOTH consoles: Max's, which is the record, and the device
 * view, which is what you can read while looking at Push.
 *
 * Commas and semicolons are stripped because Max splits a MESSAGE on them - a log
 * line containing one would arrive at [jweb] as two messages, the second of which
 * is a selector nobody handles. Spaces are left alone: they split the SYMBOL into
 * atoms, and the page joins them back.
 */
function probeLog(text: string): void {
  var clean = String(text).replace(/[,;]/g, " ");
  post("probe: " + clean + "\n");
  outlet(0, "probe_log", clean);
}

/** The guard every entry point opens with: are we the probe, and is Live there? */
function probeReady(what: string): boolean {
  if (MODE !== PROBE_MODE) return false;
  if (!probeSurface || !probeSurface.id) {
    probeLog(what + ": no control surface yet - press Scan (and plug a Push in)");
    return false;
  }
  return true;
}

/**
 * An id, however the LOM chose to hand it over: a bare number, "id 5", or
 * ["id", 5]. Take the last atom in all three shapes.
 *
 * Wanted for ONE thing - constructing the observer. Grab and release go by NAME,
 * because a bare id is rejected and the two-atom `id <n>` form buys nothing over
 * the name (MAX-FACTS).
 */
function probeIdOf(v: unknown): number {
  if (v === null || typeof v === "undefined") return 0;
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    var parts = v.split(" ");
    return Number(parts[parts.length - 1]);
  }
  var list = v as { length?: number; [i: number]: unknown };
  if (typeof list.length === "number" && list.length > 0) return Number(list[list.length - 1]);
  return 0;
}

/** A LOM list as a plain JS array, whatever Max handed us. */
function probeList(v: unknown): unknown[] {
  if (v === null || typeof v === "undefined") return [];
  if (typeof v === "string") return [v];
  var list = v as { length?: number; [i: number]: unknown };
  if (typeof list.length !== "number") return [v];
  var out: unknown[] = [];
  for (var i = 0; i < list.length; i++) out.push(list[i]);
  return out;
}

/**
 * Watch `control_surfaces` on live_app, from bang() - never loadbang (hard rule 4).
 *
 * Recreated unconditionally on every bang, with no `if (probeApp) return` guard:
 * that guard is what makes the dead-observer bug permanent.
 */
function probeAttach(): void {
  probeApp = null;
  try {
    probeApp = new LiveAPI(function (a: unknown[]) {
      // Fixed arity, never outlet.apply - it crashes the [js] engine (MAX-FACTS).
      if (a && a[0] == "control_surfaces") outlet(0, "probe_log", "control_surfaces changed - press Scan");
    }, "live_app");
    probeApp.property = "control_surfaces";
    probeLog("watching live_app control_surfaces");
  } catch (e) {
    probeLog("cannot observe control_surfaces - " + (e as Error).message);
  }
}

/**
 * What is plugged in.
 *
 * `control_surfaces` is a flat list of `id N` pairs WITH EMPTY SLOTS (`id 0`) for
 * every unconfigured control-surface slot in Live's preferences, so the position in
 * this list is the slot number and most of them are nothing.
 */
function probe_scan(): void {
  if (MODE !== PROBE_MODE) return;
  probeLog("--- scan ---");
  var app = new LiveAPI("live_app");
  if (!app.id) {
    probeLog("live_app did not resolve - is this running in Live at all?");
    return;
  }
  var flat = probeList(app.get("control_surfaces"));
  probeSurface = null;
  probeSurfaceType = "";

  var slot = 0;
  for (var i = 0; i < flat.length; i++) {
    if (String(flat[i]) === "id") continue; // the list alternates "id" and the number
    var id = Number(flat[i]);
    slot++;
    if (!id) continue; // an empty preferences slot; not worth a line each
    var cs = new LiveAPI("id " + id);
    var type = cs.id ? String(cs.type) : "unresolved";
    probeLog("slot " + slot + ": id " + id + " type " + type);
    if (!probeSurface && (type === "Push" || type === "Push2" || type === "Push3" || type === "Move")) {
      probeSurface = cs;
      probeSurfaceType = type;
    }
  }

  if (!probeSurface) {
    probeLog("no Push or Move found - the rest of the probe has nothing to talk to");
    return;
  }
  probeLog("using " + probeSurfaceType + " (id " + probeSurface.id + ")");
  probeResolveMatrix();
}

/**
 * The control vocabulary of whatever is plugged in.
 *
 * A Push 3 has no remote script on disk - its names are declared by the firmware at
 * runtime - so this call is the only source of truth, and the names are NOT the
 * Push 2 set (MAX-FACTS). Separate from `scan` because it is 45 lines of console
 * and you rarely want it twice.
 */
function probe_names(): void {
  if (!probeReady("names")) return;
  var names = probeList(probeSurface!.call("get_control_names"));
  probeLog("get_control_names: " + names.length + " atoms");
  // The reply is Max-formatted: the selector, the count, then `control <name>`
  // pairs, then `done`. Four to a line keeps it readable.
  for (var i = 0; i < names.length; i += 4) probeLog("  " + names.slice(i, i + 4).join(" "));
}

/** `get_control Button_Matrix` -> the id the OBSERVER needs. The grab uses the name. */
function probeResolveMatrix(): void {
  probeMatrix = null;
  probeMatrixId = probeIdOf(probeSurface!.call("get_control", "Button_Matrix"));
  if (!probeMatrixId) {
    probeLog("get_control Button_Matrix returned nothing usable");
    return;
  }
  probeMatrix = new LiveAPI("id " + probeMatrixId);
  probeLog("Button_Matrix -> id " + probeMatrixId + " type " + (probeMatrix.id ? String(probeMatrix.type) : "unresolved"));
}

/**
 * Grab the grid and observe its `value`.
 *
 * BY NAME - the only addressing that needs no id, and one of only two Live accepts
 * (a bare id is rejected; the ControlProxy's own `id` property is not an address).
 *
 * A REJECTED CALL DOES NOT THROW, IT POSTS. There is no try/catch here because
 * there is nothing to catch: watch the Max console for a `jsliveapi:` line, and
 * watch the hardware. That is the only verification this API offers.
 */
function probe_grab(): void {
  if (!probeReady("grab")) return;
  if (!probeMatrix || !probeMatrixId) {
    probeLog("grab: no Button_Matrix - press Scan first");
    return;
  }
  probeSurface!.call("grab_control", "Button_Matrix");
  outlet(0, "probe_state", 1);
  probeLog("grabbed Button_Matrix");

  probeRawLeft = 16;
  probeValueObs = null;
  try {
    probeValueObs = new LiveAPI(function (a: unknown[]) {
      if (!a || a[0] != "value") return;
      if (probeRawLeft > 0) {
        probeRawLeft--;
        var raw = "value cb: " + a.length + " atoms";
        for (var k = 0; k < a.length; k++) raw += " [" + k + "]=" + String(a[k]);
        probeLog(raw);
      }
      // THE ATTACH NOTIFICATION IS NOT AN EVENT: observing `value` fires once
      // immediately with `value bang` - two atoms, no coordinates. Forwarded, it is
      // a press at (undefined, undefined) that no device asked for.
      if (a.length < 5) return;
      // MEASURED: value <velocity> <x> <y-from-the-TOP> <1>. Passed on positionally
      // and unflipped; the page names them and flips y. Fixed arity - never
      // outlet.apply, it crashes Live.
      outlet(0, "probe_pad", a[1], a[2], a[3], a[4], new Date().getTime());
    }, "id " + probeMatrixId);
    probeValueObs.property = "value";
  } catch (e) {
    probeLog("cannot observe value - " + (e as Error).message);
  }

  // THE FIRST FRAME AFTER A GRAB IS LOST. Live's own surface script redraws the
  // matrix just after handing it over, so a paint issued in this message turn never
  // appears - measured, and the reason the takeover chain will have to defer too.
  // Blanking the grid here is what gives the page's latch a known starting state.
  if (probeFirstFrameTask) probeFirstFrameTask.cancel();
  probeFirstFrameTask = new Task(probeBlank, this);
  probeFirstFrameTask.schedule(400);
}

/** The deferred first frame. Task, never setTimeout - there is none in [js]. */
function probeBlank(): void {
  if (!probeMatrix) return;
  for (var y = 0; y < 8; y++) for (var x = 0; x < 8; x++) probeMatrix.call("send_value", x, y, 0);
  outlet(0, "probe_blanked", 1);
  probeLog("grid blanked (deferred 400 ms - an immediate paint is overwritten)");
}

/**
 * Give it back.
 *
 * Safe by three routes, all measured: this, deleting the device without releasing,
 * and reinstalling the .amxd while an instance is loaded. So the hardware cannot be
 * stranded - but a device that means to stop should still say so.
 */
function probe_release(): void {
  if (!probeReady("release")) return;
  probeValueObs = null; // drop the reference: the observer dies with it
  probeSurface!.call("release_control", "Button_Matrix");
  outlet(0, "probe_state", 0);
  probeLog("released Button_Matrix");
}

/** One cell: `call send_value <x> <y> <colour>`, y counted from the TOP. */
function probe_paint(x: unknown, y: unknown, colour: unknown): void {
  if (MODE !== PROBE_MODE || !probeMatrix) return;
  probeMatrix.call("send_value", Number(x), Number(y), Number(colour));
}

/** Paint the whole grid off. */
function probe_clear(): void {
  if (!probeReady("clear")) return;
  if (!probeMatrix) return;
  for (var y = 0; y < 8; y++) for (var x = 0; x < 8; x++) probeMatrix.call("send_value", x, y, 0);
  probeLog("painted all 64 pads colour 0");
}

/**
 * The palette, in two photographs. STILL OPEN: the colour NAMES are not derived.
 *
 * Page 0 paints index `y*8 + x` on pad (x, y); page 1 paints `64 + y*8 + x`, with y
 * from the TOP. Two pictures and every one of the 128 indices is at a known pad,
 * which is what `defineControls` needs before it can offer names - a device that
 * writes `36` is a device nobody can read.
 */
function probe_palette(page: unknown): void {
  if (!probeReady("palette")) return;
  if (!probeMatrix) return;
  var base = Number(page) * 64;
  for (var y = 0; y < 8; y++) for (var x = 0; x < 8; x++) probeMatrix.call("send_value", x, y, base + y * 8 + x);
  probeLog("painted indices " + base + ".." + (base + 63) + " - pad (x y) carries " + base + " + y*8 + x");
}

/**
 * Grab ANY control by name and dump what its `value` carries. STILL OPEN.
 *
 * `get_control_names` lists four controls next to `Button_Matrix` that nobody has
 * looked at - `Mpe_Pitch_Bend_Elements`, `Double_Press_Matrix`,
 * `Single_Press_Event_Matrix`, `Double_Press_Event_Matrix` - and the first is the
 * obvious place for the per-pad expression the grabbed matrix does not carry.
 *
 * Nothing here assumes the payload has a shape: it prints the atoms, which is the
 * point. `probe_other <name> <1 grab | 0 release>`.
 */
function probe_other(name: unknown, hold: unknown): void {
  if (!probeReady("other")) return;
  var control = String(name);
  if (Number(hold) !== 1) {
    probeSurface!.call("release_control", control);
    probeOtherObs = null;
    // THE VERDICT ON RELEASE, not only when the dump fills. Sixty events is four seconds
    // of a jog wheel and half a second of a touch strip, so waiting for the counter to
    // reach zero meant the useful runs - a slow, deliberate turn - never printed one.
    if (probeOtherValues.length) probeOtherVerdict(control);
    probeLog("released " + control);
    return;
  }

  var id = probeIdOf(probeSurface!.call("get_control", control));
  probeLog("--- " + control + " -> id " + id + " ---");
  if (!id) {
    probeLog(control + " did not resolve");
    return;
  }
  probeSurface!.call("grab_control", control);
  // FAR MORE THAN THE MATRIX NEEDS, because the question here is different. A pad is
  // answered by four events - press, release, and their coordinates. A JOG WHEEL is
  // answered only by a TRACE: whether the numbers repeat around zero (a delta) or climb
  // (an absolute position) cannot be read off sixteen events that go past in half a
  // second. Sixty is about four seconds of slow turning.
  probeRawLeft = 60;
  probeOtherValues = [];
  probeOtherObs = null;
  try {
    probeOtherObs = new LiveAPI(function (a: unknown[]) {
      if (!a || a[0] != "value" || probeRawLeft <= 0) return;
      probeRawLeft--;
      var raw = control + " cb: " + a.length + " atoms";
      for (var k = 0; k < a.length; k++) raw += " [" + k + "]=" + String(a[k]);
      probeLog(raw);
      // Keep the first atom of each event, so the verdict below can be computed rather
      // than eyeballed off forty console lines.
      //
      // NUMBERS ONLY. Observing a property fires once immediately with `value bang`, and
      // `Number("bang")` is NaN - which is not equal to itself, so it counted as its own
      // distinct value AND made min/max NaN. The first run of this printed
      // "range NaN..NaN, 5 distinct values" for a control that has four.
      var v = Number(a[1]);
      if (a.length >= 2 && v === v) probeOtherValues.push(v);
      if (probeRawLeft === 0) probeOtherVerdict(control);
    }, "id " + id);
    probeOtherObs.property = "value";
    probeLog("observing " + control + " - now MOVE it: turn the wheel, or run a finger up the strip");
  } catch (e) {
    probeLog("cannot observe " + control + " - " + (e as Error).message);
  }
}

/**
 * Say whether the trace looks like a DELTA or an ABSOLUTE POSITION.
 *
 * This is J1 and J2 from doc/TODO.md item 2a, and the answer decides whether the DJ
 * surface in PUSH-USECASES.md can be built at all. It is computed rather than eyeballed,
 * because forty console lines of numbers are exactly the kind of thing a person reads what
 * they expected into.
 *
 * The test is simple and hard to fool. A DELTA repeats a small alphabet - typically 1 and
 * -1, or 127 and 1 as two's-complement - no matter how far you turn, and its values do not
 * trend. An ABSOLUTE position sweeps a range and mostly moves one way while you do.
 */
function probeOtherVerdict(control: string): void {
  var n = probeOtherValues.length;
  if (n < 8) {
    probeLog(control + ": only " + n + " events - not enough to tell delta from absolute");
    return;
  }

  var lo = probeOtherValues[0];
  var hi = probeOtherValues[0];
  var distinct: { [v: string]: boolean } = {};
  var rising = 0;
  var falling = 0;
  for (var i = 0; i < n; i++) {
    var v = probeOtherValues[i];
    if (v < lo) lo = v;
    if (v > hi) hi = v;
    distinct[String(v)] = true;
    if (i > 0) {
      if (v > probeOtherValues[i - 1]) rising++;
      else if (v < probeOtherValues[i - 1]) falling++;
    }
  }
  var kinds = 0;
  for (var key in distinct) if (distinct.hasOwnProperty(key)) kinds++;

  probeLog(control + ": " + n + " events, range " + lo + ".." + hi + ", " + kinds + " distinct values, " + rising + " up / " + falling + " down");
  if (kinds <= 4) {
    probeLog(control + ": looks like a DELTA - it only ever reports " + kinds + " values, so it says CHANGE, not position");
    // A relative encoder sends its step as a signed 7-bit number, so one detent
    // anticlockwise arrives as 127 rather than -1. Saying so here saves the next person
    // the twenty minutes it took to work out the first time.
    if (distinct["127"] || distinct["1"]) probeLog(control + ": 1 and 127 are +1 and -1 - a signed 7-bit step, one per detent");
  } else if (kinds > n / 3) {
    probeLog(control + ": looks like an ABSOLUTE POSITION - " + kinds + " distinct values over a range of " + (hi - lo));
  } else {
    probeLog(control + ": inconclusive - turn it further in ONE direction and press the button again");
  }
  probeLog(control + ": resolution is the range above; under ~64 steps a crossfader reads as stepped");
}

/**
 * The one hook the probe needs: live.thisdevice has fired, so LiveAPI is finally
 * safe. An observer built during loadbang constructs without error and then
 * notifies nothing, forever (hard rule 4) - which for a probe would mean a device
 * that reports "no control surface" with a Push sitting right there.
 */
function onDeviceReady(): void {
  if (MODE !== PROBE_MODE) return;
  probeAttach();
}
