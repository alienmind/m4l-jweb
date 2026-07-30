/**
 * liveapi.ts - everything that touches Live's object model.
 *
 * Concatenated after core.ts into a single ES5 script, so these functions are
 * visible to core's lifecycle (bang() calls startTickPoll() and
 * setupTempoObserver()) without any module system.
 *
 * If your device does not touch clips, the clip I/O half is dead weight but
 * harmless - Max only calls what the patcher routes to it.
 */

/* ------------------------------------------------------------------ *
 * Transport: "tick <playing> <beats>" at 20 Hz
 *
 * Polled from LiveAPI (live_set is_playing + current_song_time), NOT from a
 * [plugsync~] -> [snapshot~] signal chain: MIDI-effect devices do not reliably
 * run a DSP graph, and such a chain reads zero in the field. LiveAPI has no such
 * dependency and works in every device type. An engine's lookahead window
 * absorbs the 20 Hz poll rate.
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
    // A device with a second consumer (another engine on outlet 1) mirrors the
    // clock here rather than polling Live twice.
    if (typeof onTick === "function") onTick(playing, beats);
  } catch (e) {
    /* transient - the next poll retries */
  }
}

/* ------------------------------------------------------------------ *
 * Tempo: observed, not polled.
 *
 * The signal-domain alternative reports samples-per-beat, not BPM. The observer
 * callback fires once on attach and then on every change.
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
    if (typeof onTempoChange === "function") onTempoChange(Number(a[1]));
  }
}

/** The observer's first callback can beat the page's binding - ui_ready re-reads. */
function sendCurrentTempo(): void {
  try {
    var api = new LiveAPI("live_set");
    var t = parseFloat(String(api.get("tempo")));
    if (t > 0) {
      outlet(0, "tempo", t);
      if (typeof onTempoChange === "function") onTempoChange(t);
    }
  } catch (e) {
    post("m4l-jweb: tempo read failed - " + (e as Error).message + "\n");
  }
}

/* ------------------------------------------------------------------ *
 * Generic property observer
 *
 * Anything observable in Live (scale, track name, selected scene...) reaches
 * the UI the same way: attach, forward on change. Call this from bang(), never
 * from loadbang().
 * ------------------------------------------------------------------ */

/**
 * observeProperty("live_set", "scale_name", "scale") forwards every change to
 * the UI as `scale <value>`. Returns the LiveAPI object so you can keep it
 * alive; drop it and the observer dies with it.
 *
 * The value is the property's FIRST atom - a watch is scalar (a tempo, a
 * numerator, a name), which is every real Live property one wants to observe.
 * That is not a shortcut: it is forced by how `outlet` must be called. `outlet`
 * is a Max HOST function, and `.apply`-ing it to spread a variadic message is
 * unreliable - it errors "jsliveapi: bad outlet index 0" from inside a LiveAPI
 * callback in Live, killing the notification. So the value goes out fixed-arity,
 * exactly as the tempo observer's `outlet(0, "tempo", a[1])` does - the one shape
 * that works. A property with several atoms forwards its first.
 */
function observeProperty(objectPath: string, property: string, selector: string): LiveAPI | null {
  try {
    var api = new LiveAPI(function (a: unknown[]) {
      // a = [property, value] for a scalar property. Fixed-arity, never outlet.apply.
      if (a && a[0] == property) outlet(0, selector, a[1]);
    }, objectPath);
    api.property = property;
    return api;
  } catch (e) {
    post("m4l-jweb: cannot observe " + objectPath + " " + property + " - " + (e as Error).message + "\n");
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Clip I/O
 * ------------------------------------------------------------------ */

interface LiveNote {
  pitch: number;
  start_time: number;
  duration: number;
  velocity: number;
  mute?: number;
}

/**
 * The LiveAPI for the TRACK this device sits on - clip I/O belongs to the track.
 *
 * `this_device canonical_parent` is the track ONLY when the device sits directly on
 * it. Inside a Rack it is the CHAIN the device is in, and a Chain has no `clip_slots` -
 * so `getcount("clip_slots")` on it throws "invalid property name" once a second (the
 * clip-availability poll), and clip read/write silently target the wrong object. So
 * climb the `canonical_parent` chain until a Track is reached, which handles a device
 * on a bare track (no climb), in a rack (one hop), and in a nested rack (several).
 */
function ownTrack(): LiveAPI {
  var api = new LiveAPI("this_device canonical_parent");
  var guard = 0;
  // id 0 is an unresolved path; stop rather than build "... canonical_parent" onto
  // nothing. The guard is a backstop against a parent cycle the LOM should never have.
  while (api && api.id && api.type !== "Track" && guard < 12) {
    api = new LiveAPI(api.unquotedpath + " canonical_parent");
    guard++;
  }
  return api;
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

  // No reachable Track is a STRUCTURAL failure (clip I/O is impossible here), distinct
  // from a track whose slots are all full. The UI disables clip export on the former
  // and only reports the latter, so `write_error` says which.
  var track = ownTrack();
  if (!track || !track.id || track.type !== "Track") {
    post("m4l-jweb: write_clip - no reachable track (device not on a track?)\n");
    outlet(0, "write_error", "no_track");
    return;
  }

  var slot = firstEmptySlot();
  if (!slot) {
    post("m4l-jweb: no empty clip slot on this track\n");
    outlet(0, "write_error", "no_slot");
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
    outlet(0, "write_error", "add_failed");
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
 * read_notes - pick a clip on this device's TRACK (the playing one, else the first
 * found), read its notes and send them to the UI as
 * "notes <loopEnd> <n> <pitch start duration> ...".
 *
 * This ignores the Live SELECTION on purpose: a device that reads/writes its own
 * track's pattern (m4l-strudel) wants its track's clip, not wherever the cursor
 * happens to be. For the selection-driven case use read_selected_clip below.
 */
function read_notes(): void {
  // Structural failure (no reachable track) is reported distinctly from "a track with
  // no clip", so the UI can disable clip import where it is impossible and merely say
  // "no clip" where it is not.
  var track = ownTrack();
  if (!track || !track.id || track.type !== "Track") {
    post("m4l-jweb: read_notes - no reachable track (device not on a track?)\n");
    outlet(0, "read_error", "no_track");
    return;
  }
  var clip = pickClip();
  if (!clip) {
    post("m4l-jweb: no clip found on this track\n");
    outlet(0, "read_error", "no_clip");
    return;
  }
  emitClipNotes(clip);
}

/**
 * read_selected_clip - read the clip the CURSOR is on (Live's highlighted clip slot),
 * whichever track and scene that is. An empty highlighted slot is "no clip", which is
 * what makes clicking an empty slot and reading report nothing rather than falling
 * back to some other clip on the track. Same reply shape as read_notes.
 */
function read_selected_clip(): void {
  var clip = selectedClip();
  if (!clip) {
    post("m4l-jweb: highlighted clip slot is empty (or none)\n");
    outlet(0, "read_error", "no_selection");
    return;
  }
  emitClipNotes(clip);
}

/** The clip in Live's highlighted clip slot, or null if that slot is empty. */
function selectedClip(): LiveAPI | null {
  try {
    var slot = new LiveAPI("live_set view highlighted_clip_slot");
    if (!slot || !slot.id || Number(slot.id) === 0) return null;
    if (parseInt(String(slot.get("has_clip")), 10) !== 1) return null;
    return new LiveAPI(slot.unquotedpath + " clip");
  } catch (e) {
    post("m4l-jweb: selectedClip error " + (e as Error).message + "\n");
    return null;
  }
}

/** Send a clip's notes to the UI: "notes <loopEnd> <n> <pitch start duration> ...". */
function emitClipNotes(clip: LiveAPI): void {
  var loopEnd = parseFloat(String(clip.get("loop_end")));
  var notes = getNotes(clip, loopEnd);
  if (!notes) return;

  var out: unknown[] = ["notes", loopEnd, notes.length];
  for (var i = 0; i < notes.length; i++) {
    out.push(notes[i].pitch, notes[i].start_time, notes[i].duration);
  }
  // A note list is variadic. Do NOT spread it with `outlet.apply` - `outlet` is a Max
  // HOST function, and calling `.apply` on it faults the [js] engine (js.mxe64) with an
  // access violation, taking Live down; "jsliveapi: bad outlet index 0" is its warning
  // shot. Max outputs an ARRAY passed as the single argument as a list, first atom the
  // selector - so `outlet(0, ["notes", ...])` sends the same message, no apply.
  outlet(0, out);
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

/* ------------------------------------------------------------------ *
 * A file on disk INTO an audio clip
 *
 * `create_audio_clip <requestId> <base64 spec>`; `clip_created <requestId>` or
 * `clip_error <requestId> <reason> <msg...>` back. `createAudioClip()` in the bridge is
 * the shaped API, and the spec is base64 JSON because a path and a clip name BOTH
 * contain spaces in practice - two variadic fields cannot be recovered from one flat
 * Max message.
 *
 * WHY THIS IS GATED ON A VERSION READ AND NOT ON A TRY/CATCH. `create_audio_clip` is
 * documented well before Live 12.0.5 and does nothing there - so the failure to design
 * around is a call that raises nothing and leaves the slot empty, which is
 * indistinguishable from a slot that was already empty. Ask Live what it is.
 *
 * WHAT THE TARGET MUST BE: an audio track, not frozen, not being recorded into. An
 * instrument device can never satisfy that from its own view - it sits on a MIDI track,
 * and the highlighted slot is always one of its own, because a device's UI is only on
 * screen while its track is selected. Hence `target: "new"`, and hence the audio-effect
 * flavour of a device that wants to bounce into the track it is already on.
 * ------------------------------------------------------------------ */

/** Live's version, read once. null when neither spelling of the getter answered. */
var liveVersionCache: number[] | null = null;
var liveVersionAsked = false;

/**
 * [major, minor, bugfix], or null.
 *
 * TWO SPELLINGS ARE TRIED, and that is not hedging: the LOM's Application functions are
 * `get_major_version` in Live's own documentation, and this repo has been wrong about a
 * name it never looked up more than once (see MAX-FACTS on names Max does not validate).
 * Whichever answers is posted, so the console says which one this Live has.
 */
function liveVersion(): number[] | null {
  if (liveVersionAsked) return liveVersionCache;
  liveVersionAsked = true;
  var spellings = [
    ["get_major_version", "get_minor_version", "get_bugfix_version"],
    ["get_version_major", "get_version_minor", "get_version_bugfix"],
  ];
  try {
    var app = new LiveAPI("live_app");
    for (var i = 0; i < spellings.length; i++) {
      try {
        var major = Number(app.call(spellings[i][0]));
        var minor = Number(app.call(spellings[i][1]));
        var bugfix = Number(app.call(spellings[i][2]));
        if (major > 0) {
          liveVersionCache = [major, minor, bugfix];
          post("m4l-jweb: Live " + major + "." + minor + "." + bugfix + " (via " + spellings[i][0] + ")\n");
          return liveVersionCache;
        }
      } catch (inner) {
        /* the other spelling gets its turn */
      }
    }
    post("m4l-jweb: could not read Live's version - neither get_major_version nor get_version_major answered\n");
  } catch (e) {
    post("m4l-jweb: live_app unavailable - " + (e as Error).message + "\n");
  }
  return null;
}

/** Is this Live new enough for create_audio_clip to DO anything? Unknown counts as yes. */
function hasAudioClipApi(): boolean {
  var v = liveVersion();
  if (!v) return true; // cannot tell: attempt, and report what the slot says afterwards
  if (v[0] > 12) return true;
  if (v[0] < 12) return false;
  if (v[1] > 0) return true;
  return v[2] >= 5;
}

/** base64 -> string, UTF-8 aware. b64decode (core.ts) gives bytes; this reads them. */
function b64ToString(b64: string): string {
  var bytes = b64decode(b64);
  var out = "";
  for (var i = 0; i < bytes.length; i++) {
    var c = bytes[i];
    if (c < 0x80) out += String.fromCharCode(c);
    else if (c < 0xe0) out += String.fromCharCode(((c & 0x1f) << 6) | (bytes[++i] & 0x3f));
    else if (c < 0xf0) out += String.fromCharCode(((c & 0x0f) << 12) | ((bytes[++i] & 0x3f) << 6) | (bytes[++i] & 0x3f));
    else {
      // Outside the BMP: rebuild the surrogate pair, or a name with an emoji in it
      // silently becomes garbage rather than the character the user typed.
      var cp = ((c & 0x07) << 18) | ((bytes[++i] & 0x3f) << 12) | ((bytes[++i] & 0x3f) << 6) | (bytes[++i] & 0x3f);
      cp -= 0x10000;
      out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
    }
  }
  return out;
}

interface AudioClipSpec {
  path: string;
  target: string;
  track?: number;
  slot?: number;
  name?: string;
  warp?: boolean;
  warpMode?: number;
  loopEnd?: number;
}

function clipError(requestId: string, reason: string, message: string): void {
  post("m4l-jweb: create_audio_clip " + reason + " - " + message + "\n");
  // Fixed arity, never outlet.apply - see emitClipNotes. The reason is its own atom so
  // the app can branch on it without parsing the human sentence beside it.
  outlet(0, "clip_error", requestId, reason, message);
}

function create_audio_clip(requestId: string, b64: string): void {
  var spec: AudioClipSpec;
  try {
    spec = JSON.parse(b64ToString(String(b64)));
  } catch (e) {
    return clipError(String(requestId), "failed", "could not read the request: " + (e as Error).message);
  }

  if (!hasAudioClipApi()) {
    var v = liveVersion();
    return clipError(
      String(requestId),
      "needs_live_1205",
      "this Live is " + (v ? v.join(".") : "older than 12.0.5") + "; ClipSlot.create_audio_clip does nothing before 12.0.5",
    );
  }

  // The same resolution a save uses, so a device passes back exactly the name it wrote.
  var path = resolveFetchPath(String(spec.path));
  if (path === null) {
    return clipError(String(requestId), "no_file", "the patcher is not saved, so a relative path resolves against nowhere");
  }
  // Ask the filesystem before asking Live. A missing file makes create_audio_clip fail in
  // a way that reads exactly like a wrong target, and this is one line.
  if (fileSize(path) <= 0) {
    return clipError(String(requestId), "no_file", "nothing on disk at " + path);
  }

  var slot = resolveClipSlot(spec);
  if (!slot || !slot.id) {
    return clipError(String(requestId), "no_slot", spec.target === "selected" ? "no clip slot is highlighted in Live" : "no clip slot at that index");
  }

  var track = new LiveAPI(slot.unquotedpath + " canonical_parent");
  if (Number(track.get("has_audio_input")) !== 1) {
    return clipError(
      String(requestId),
      "not_audio_track",
      "the target is not an audio track - an audio clip can only be created on one",
    );
  }
  if (Number(track.get("is_frozen")) === 1) {
    return clipError(String(requestId), "track_busy", "that track is frozen");
  }
  try {
    if (Number(slot.get("is_recording")) === 1) {
      return clipError(String(requestId), "track_busy", "that slot is being recorded into");
    }
  } catch (eRec) {
    /* an older ClipSlot may not carry is_recording; the call below still refuses */
  }

  post("m4l-jweb: create_audio_clip -> " + slot.unquotedpath + " <- " + path + "\n");
  try {
    slot.call("create_audio_clip", path);
  } catch (eCall) {
    return clipError(String(requestId), "failed", (eCall as Error).message);
  }

  // The slot is the evidence, not the call. A LOM method that declines prints to the Max
  // window and returns nothing, so "it did not throw" is not "there is a clip".
  if (Number(slot.get("has_clip")) !== 1) {
    return clipError(String(requestId), "failed", "the call ran and the slot is still empty - see the Max window for Live's own error");
  }

  setupAudioClip(new LiveAPI(slot.unquotedpath + " clip"), spec);
  post("m4l-jweb: created an audio clip in " + slot.unquotedpath + "\n");
  outlet(0, "clip_created", requestId);
}

/** The slot a spec names, creating a track for `target: "new"`. */
function resolveClipSlot(spec: AudioClipSpec): LiveAPI | null {
  try {
    if (spec.target === "new") {
      var song = new LiveAPI("live_set");
      // -1 appends. The new track is therefore the last one, and asking for the count
      // AFTER the call is what identifies it - there is no return value to trust.
      song.call("create_audio_track", -1);
      var last = song.getcount("tracks") - 1;
      if (last < 0) return null;
      // Select it, so the bounce is where the user is looking rather than somewhere
      // off the right edge of a wide set.
      try {
        new LiveAPI("live_set view").set("selected_track", "id " + new LiveAPI("live_set tracks " + last).id);
      } catch (eSel) {
        /* cosmetic */
      }
      return new LiveAPI("live_set tracks " + last + " clip_slots 0");
    }
    if (spec.target === "track") {
      return new LiveAPI("live_set tracks " + Number(spec.track) + " clip_slots " + Number(spec.slot));
    }
    return new LiveAPI("live_set view highlighted_clip_slot");
  } catch (e) {
    post("m4l-jweb: create_audio_clip target error - " + (e as Error).message + "\n");
    return null;
  }
}

/**
 * Name it, warp it, and give it the loop the render actually has.
 *
 * Every write is individually guarded and NONE of them fails the request: the clip is
 * already in the slot by the time this runs, and a bounce that landed under the wrong
 * name is not a bounce that failed. What did not take is posted.
 *
 * ORDER MATTERS. `warping` comes first - loop points on an unwarped clip are in seconds
 * of sample time, not beats - and the END markers are widened before the loop is set,
 * because Live clamps a loop to the markers it currently has.
 */
function setupAudioClip(clip: LiveAPI, spec: AudioClipSpec): void {
  if (!clip || !clip.id) return;
  var writes: unknown[][] = [];
  if (spec.warp !== false) writes.push(["warping", 1]);
  if (spec.warpMode !== undefined) writes.push(["warp_mode", Number(spec.warpMode)]);
  if (spec.loopEnd !== undefined && Number(spec.loopEnd) > 0) {
    writes.push(["end_marker", Number(spec.loopEnd)], ["loop_end", Number(spec.loopEnd)], ["start_marker", 0], ["loop_start", 0], ["looping", 1]);
  }
  // Last, so a name is not lost to an exception thrown by a loop point.
  if (spec.name) writes.push(["name", String(spec.name)]);

  for (var i = 0; i < writes.length; i++) {
    try {
      clip.set(String(writes[i][0]), writes[i][1]);
    } catch (e) {
      post("m4l-jweb: clip " + writes[i][0] + " = " + writes[i][1] + " did not take - " + (e as Error).message + "\n");
    }
  }
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
