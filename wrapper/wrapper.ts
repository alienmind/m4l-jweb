/**
 * wrapper.ts - the Max-side glue for the device (NOT the web app).
 *
 * This is the one file that needs LiveAPI, so it is the one file that must run
 * inside Max's [js]: an ES5-era interpreter with no modules, no `console` (use
 * `post`), and no `setTimeout` (use `Task`). It is written in TypeScript and
 * compiled with `target: "ES5"` by scripts/build-wrapper.mjs; the build then
 * re-parses the output with acorn at `ecmaVersion: 5` and REFUSES to package
 * on failure - one stray modern token kills the whole script at load, with a
 * one-line error and no stack.
 *
 * Responsibilities, in order of how much they matter:
 *   1. Extract the embedded UI payload to disk and point [jweb] at it.
 *   2. Poll the transport and observe tempo; push both to the UI.
 *   3. Answer the UI's `ui_ready` handshake with the current state.
 *   4. Optional clip I/O helpers (write_clip / read_notes).
 *
 * Outlets:
 *   0 - to [jweb]      ("url ...", "mode ...", "tick ...", "tempo ...", "build ...")
 *   1 - spare/aux      (a second consumer: another engine, a print, ...)
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

/** The build this device instance actually is. See buildStamp(). */
post("wrapper.js loaded (build " + buildStamp() + ", mode " + MODE + ")\n");

function buildStamp(): string {
	return typeof BUILD_STAMP !== "undefined" ? BUILD_STAMP : "dev";
}

/* ------------------------------------------------------------------ *
 * Lifecycle
 *
 * LiveAPI objects created in a patcher-loading context (loadbang) are DEAD:
 * they construct without error and then observe nothing, forever. Create every
 * observer from live.thisdevice's bang, which fires once the device is fully
 * in the Live set. Guard code like `if (obs) return` turns this bug permanent -
 * recreate unconditionally.
 *
 * loadbang does file work only.
 * ------------------------------------------------------------------ */

/** live.thisdevice -> the device is fully loaded. Everything LiveAPI starts here. */
function bang(): void {
	post("m4l-jweb: bang (device ready)\n");
	loadWebview();
	setupTempoObserver();
	startTickPoll();
}

/** Patcher loaded. File work is safe here; LiveAPI is NOT. */
function loadbang(): void {
	post("m4l-jweb: loadbang\n");
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
 * Handshake
 * ------------------------------------------------------------------ */

/**
 * The UI announces it finished loading. The page loads asynchronously, so
 * never assume it was listening when state last changed - resend all of it.
 */
function ui_ready(): void {
	outlet(0, "mode", MODE);
	// The UI shows this next to its own baked-in version: a mismatch means a
	// mixed install (stale .amxd instance vs newer extracted UI, or vice versa).
	outlet(0, "build", buildStamp());
	sendCurrentTempo();
}

/* ------------------------------------------------------------------ *
 * Transport: "tick <playing> <beats>" at 20 Hz
 *
 * Polled from LiveAPI (live_set is_playing + current_song_time), NOT from a
 * [plugsync~] -> [snapshot~] signal chain: MIDI-effect devices do not reliably
 * run a DSP graph, and such a chain reads zero in the field. LiveAPI has no
 * such dependency and works in every device type.
 * ------------------------------------------------------------------ */

var tickPoll = new Task(pollTransport, this);
var liveSetApi: LiveAPI | null = null;

function startTickPoll(): void {
	try {
		liveSetApi = new LiveAPI("live_set");
	} catch (e) {
		post("m4l-jweb: tick poll unavailable - " + (e as Error).message + "\n");
		return;
	}
	tickPoll.cancel();
	tickPoll.interval = 50;
	tickPoll.repeat();
	post("m4l-jweb: transport poll on\n");
}

function pollTransport(): void {
	if (!liveSetApi) return;
	try {
		var playing = parseInt(String(liveSetApi.get("is_playing")), 10);
		var beats = parseFloat(String(liveSetApi.get("current_song_time")));
		outlet(0, "tick", playing, beats);
	} catch (e) {
		/* transient - the next poll retries */
	}
}

/* ------------------------------------------------------------------ *
 * Tempo: observed, not polled.
 *
 * The signal-domain alternative reports samples-per-beat, not BPM. The
 * observer callback fires once on attach and then on every change.
 * ------------------------------------------------------------------ */

var tempoObs: LiveAPI | null = null;

function setupTempoObserver(): void {
	// Recreate unconditionally: an object left over from a loading context is
	// dead and must not block the real one.
	try {
		tempoObs = new LiveAPI(onTempo, "live_set");
		tempoObs.property = "tempo";
		post("m4l-jweb: tempo observer on (current " + tempoObs.get("tempo") + ")\n");
	} catch (e) {
		post("m4l-jweb: tempo observer unavailable - " + (e as Error).message + "\n");
	}
}

function onTempo(a: unknown[]): void {
	if (a && a[0] == "tempo") {
		outlet(0, "tempo", a[1]);
	}
}

/** The observer's first callback can beat the page's binding - ui_ready re-reads. */
function sendCurrentTempo(): void {
	try {
		var api = new LiveAPI("live_set");
		var t = parseFloat(String(api.get("tempo")));
		if (t > 0) outlet(0, "tempo", t);
	} catch (e) {
		post("m4l-jweb: tempo read failed - " + (e as Error).message + "\n");
	}
}

/* ------------------------------------------------------------------ *
 * The self-extracting UI payload
 *
 * Chromium (jweb) cannot read Max's frozen virtual filesystem, so a frozen
 * dependency is invisible to it. But THIS script always runs - so the build
 * appends the UI html to it as base64 (UI_PAYLOAD_B64 / _BYTES / _NAME, see
 * scripts/build-amxd.mjs), and we write it to a real file next to the .amxd on
 * first load and point jweb at that file:// URL.
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
	// Cache-buster: the URL changes per build, so Chromium can never serve a
	// page it cached from a previous build of the same file path.
	return encodeURI("file:///" + target) + "?v=" + encodeURIComponent(buildStamp());
}

/** The folder the .amxd lives in, derived from the patcher's own path. */
function deviceFolder(): string | null {
	var fp: string = this.patcher.filepath;
	return fp && fp.length ? fp.replace(/\/[^\/]*$/, "") : null;
}

/**
 * Write an embedded base64 payload to targetPath.
 *
 * Skipped only when BOTH the size matches AND a sidecar .stamp file records
 * the same build - size alone proved too weak, since different builds can
 * collide and leave a stale file that no longer matches the wrapper driving it.
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
		// File.writebytes silently truncates large calls (observed ~16 KB cap),
		// so write in small slices and verify the byte count afterwards.
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
 * Clip I/O (optional - delete if your device does not touch clips)
 * ------------------------------------------------------------------ */

/** The LiveAPI for the track this device sits on. */
function ownTrack(): LiveAPI {
	return new LiveAPI("this_device canonical_parent");
}

/**
 * write_clip <lengthBeats> <n> <pitch start duration velocity> ...
 * Creates a clip in the first empty slot on this device's track and fills it.
 */
function write_clip(): void {
	var a = arrayfromargs(arguments);
	if (a.length < 2) return;
	var lengthBeats = a[0];
	var n = Number(a[1]);

	var slot = firstEmptySlot();
	if (!slot) {
		post("m4l-jweb: no empty clip slot on this track\n");
		return;
	}
	slot.call("create_clip", lengthBeats);
	var clip = new LiveAPI(slot.unquotedpath + " clip");

	var notes: LiveNote[] = [];
	for (var k = 0; k < n; k++) {
		var o = 2 + k * 4;
		notes.push({
			pitch: Number(a[o]),
			start_time: Number(a[o + 1]),
			duration: Number(a[o + 2]),
			velocity: Number(a[o + 3]),
			mute: 0,
		});
	}
	try {
		clip.call("add_new_notes", { notes: notes });
	} catch (e) {
		post("m4l-jweb: add_new_notes failed - " + (e as Error).message + "\n");
		return;
	}
	post("m4l-jweb: wrote " + n + " notes over " + lengthBeats + " beats\n");
}

function firstEmptySlot(): LiveAPI | null {
	try {
		var track = ownTrack();
		var count = parseInt(String(track.getcount("clip_slots")), 10);
		for (var i = 0; i < count; i++) {
			var s = new LiveAPI(track.unquotedpath + " clip_slots " + i);
			if (parseInt(String(s.get("has_clip")), 10) === 0) return s;
		}
		return null;
	} catch (e) {
		post("m4l-jweb: firstEmptySlot error " + (e as Error).message + "\n");
		return null;
	}
}

/**
 * read_notes - pick a clip on this device's track (the playing one, else the
 * first found), read its notes and send them to the UI as
 * "notes <loopEnd> <n> <pitch start duration> ...".
 */
function read_notes(): void {
	var clip = pickClip();
	if (!clip) {
		post("m4l-jweb: no clip found on this track\n");
		outlet(0, "read_error", "no_clip");
		return;
	}
	var loopEnd = parseFloat(String(clip.get("loop_end")));
	var notes = getNotes(clip, loopEnd);
	if (!notes) return;

	var out: unknown[] = ["notes", loopEnd, notes.length];
	for (var i = 0; i < notes.length; i++) {
		out.push(notes[i].pitch, notes[i].start_time, notes[i].duration);
	}
	// A note list is variadic, so the message has to be spread with apply().
	// outlet()'s typed signature cannot express that; go through Function.
	(outlet as Function).apply(this, ([0] as unknown[]).concat(out));
	post("m4l-jweb: read " + notes.length + " notes (loop_end " + loopEnd + ")\n");
}

function pickClip(): LiveAPI | null {
	try {
		var track = ownTrack();
		var count = parseInt(String(track.getcount("clip_slots")), 10);
		var firstWithClip: LiveAPI | null = null;
		for (var i = 0; i < count; i++) {
			var s = new LiveAPI(track.unquotedpath + " clip_slots " + i);
			if (parseInt(String(s.get("has_clip")), 10) === 1) {
				var c = new LiveAPI(s.unquotedpath + " clip");
				if (parseInt(String(c.get("is_playing")), 10) === 1) return c;
				if (!firstWithClip) firstWithClip = c;
			}
		}
		return firstWithClip;
	} catch (e) {
		post("m4l-jweb: pickClip error " + (e as Error).message + "\n");
		return null;
	}
}

interface LiveNote {
	pitch: number;
	start_time: number;
	duration: number;
	velocity: number;
	mute?: number;
}

function getNotes(clip: LiveAPI, loopEnd: number): LiveNote[] | null {
	// Live 11+: get_notes_extended returns a JSON string.
	try {
		var d = clip.call("get_notes_extended", 0, 128, 0, loopEnd);
		var obj = typeof d === "string" ? JSON.parse(d) : d;
		if (obj && obj.notes) return obj.notes;
	} catch (e) {
		post("m4l-jweb: get_notes_extended failed - " + (e as Error).message + "\n");
	}
	return null;
}
