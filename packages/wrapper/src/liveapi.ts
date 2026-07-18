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
 * read_notes - pick a clip on this device's TRACK (the playing one, else the first
 * found), read its notes and send them to the UI as
 * "notes <loopEnd> <n> <pitch start duration> ...".
 *
 * This ignores the Live SELECTION on purpose: a device that reads/writes its own
 * track's pattern (m4l-strudel) wants its track's clip, not wherever the cursor
 * happens to be. For the selection-driven case use read_selected_clip below.
 */
function read_notes(): void {
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
