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
  var d = new Dict();
  d.set("url", encodeURI("file:///" + CONFORMANCE_SRC));
  d.set("http_method", "get");
  d.set("filename_out", CONFORMANCE_DST); // NOT "downloadfilename" - an unknown key is ignored
  d.set("overwrite_output_file", 1); // ...defaults to 0: it would copy exactly once
  d.set("response_dict", "m4ljweb_conformance_response");
  outlet(1, "maxurl", "dictionary", d.name);
}

/**
 * The wrapper offers us [maxurl]'s reply before it assumes the reply is its own.
 * Return true when it was ours.
 */
function onMaxurlReply(dictName: string): boolean {
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

  post("===== " + conformancePass + " passed, " + conformanceFail + " failed =====\n");
  if (conformanceFail > 0) {
    post("A FAILURE HERE MEANS MAX CHANGED. The unit tests cannot see it: they run\n");
    post("against a fake Max built from these very assumptions. Fix the wrapper, then\n");
    post("update doc/ARCHITECTURE.md - 'What Max actually does' - and the fake in\n");
    post("tests/wrapper-max.test.mjs, in that order.\n");
  }
  post("\n");
  return true;
}
