/**
 * controls.ts - the CONTROL SURFACE half of the wrapper: discovery, the grab, the
 * focus policy, and the frame buffer that decides what the hardware is told.
 *
 * Concatenated after liveapi.ts. What to claim is injected by the build as
 * CONTROLS_SPEC, from the device's `defineControls()` - this file is generic and a
 * device that declared no controls ships an undefined spec and does nothing.
 *
 * ------------------------------------------------------------------------------
 * EVERY RULE BELOW IS A MEASUREMENT. doc/MAX-FACTS.md, "Grabbing a Push control",
 * on a Push 3 in Live 12. Four of them contradict the obvious guess and all four
 * fail SILENTLY, which is why they are restated at the code that depends on them:
 *
 *   - A control is grabbed BY NAME. A bare id is rejected outright; the two-atom
 *     `id <n>` works and buys nothing. The id is wanted only to point the chain's
 *     `[live.observer]` at the control.
 *   - `LiveAPI.call` DOES NOT THROW when Live refuses. It posts a console line and
 *     returns normally, so `try/catch` catches nothing and there is no success to
 *     branch on. Nothing here may claim it verified a grab.
 *   - Y COUNTS FROM THE TOP in `send_value` and in the `value` payload. The flip to
 *     the API's bottom-up orientation lives in the PAGE (pads.ts), in one place;
 *     this file is entirely in hardware coordinates and never flips anything.
 *   - THE FIRST FRAME AFTER A GRAB IS LOST. Live's own surface script repaints the
 *     matrix just after handing it over, so the first paint is deferred and until it
 *     runs the hardware's state is treated as unknown.
 *
 *   ...and one that makes the rest shippable: giving a control back is safe by three
 *   routes - an explicit release, deleting the device without one, and reinstalling
 *   the .amxd while an instance is loaded. A device cannot strand the hardware, so it
 *   only has to release when it stops WANTING the grid.
 * ------------------------------------------------------------------------------
 */

/** The control-surface classes this library knows how to talk to. */
var CONTROLS_SURFACE_TYPES = ["Push", "Push2", "Push3", "Move"];

/**
 * How long to wait before the first paint after a grab, in ms.
 *
 * Measured: a paint issued in the grab's own message turn does not appear, and the
 * same paint 400 ms later does. It is Live's surface script redrawing the matrix as
 * it hands it over; there is nothing to wait ON, so this is a delay and not a
 * handshake.
 */
var CONTROLS_FIRST_FRAME_MS = 400;

/** The Push (or Move) we resolved, and what Live calls its class. */
var controlsSurface: LiveAPI | null = null;
var controlsSurfaceType = "";
/** `live_app`, observing `control_surfaces` - a Push can be plugged in mid-set. */
var controlsApp: LiveAPI | null = null;

/** Per declared key: the resolved control, its LOM id, and the name that resolved. */
var controlsObjects: { [key: string]: LiveAPI | null } = {};
var controlsIds: { [key: string]: number } = {};
var controlsNames: { [key: string]: string } = {};

/** Per key: the last frame the PAGE asked for, and the last frame the HARDWARE was told. */
var controlsWanted: { [key: string]: number[] } = {};
var controlsShown: { [key: string]: number[] | null } = {};

/**
 * Has setupControls() finished?
 *
 * Two things fire before it does and neither may act on a half-built picture: an
 * observer calls back once while it is being CREATED, and Live restores this device's
 * saved parameters during patcher load - which is a context where LiveAPI objects are
 * born dead (hard rule 4), so a grab decided there would be decided against nothing.
 */
var controlsStarted = false;

/** Has the `focus` PARAMETER told us its value? If so it outranks the declared default. */
var controlsFocusSeen = false;

/** Are we holding the declared controls right now? */
var controlsHeld = false;
/** The `takeover` parameter, and the `focus` menu index. */
var controlsEnabled = false;
var controlsFocus = 0;
/** FOCUS_OPTIONS in @m4l-jweb/surface: the menu's value is its index. */
var CONTROLS_FOCUS_DEVICE = 0;
var CONTROLS_FOCUS_TRACK = 1;
var CONTROLS_FOCUS_ALWAYS = 2;

/** This device and its track, for the focus comparison. */
var controlsThisDeviceId = 0;
var controlsThisTrackId = 0;
/** What Live currently has selected. */
var controlsSelectedTrackId = 0;
var controlsSelectedDeviceId = 0;
/** The focus observers, held so they stay alive. Dropping the reference kills the observer. */
var controlsTrackObs: LiveAPI | null = null;
var controlsDeviceObs: LiveAPI | null = null;
/** The deferred first frame, and the deferred rebuild of the device observer. */
var controlsFirstFrameTask: Task | null = null;
var controlsDeviceObsTask: Task | null = null;

/**
 * The retry that exists because resolving on load is a RACE.
 *
 * A device loads when Live loads the set, and Live's own Push script initialises on its
 * own schedule. Ask too early and `control_surfaces` is empty, or the surface is there and
 * `get_control` answers 0 for every name - so every role comes back unresolved and the
 * device never grabs anything. Re-adding the device by hand fixes it, because the second
 * load happens after Push is ready. That is exactly the shape of the bug reported against
 * this: intermittent, unrelated to any other device, and cured by a re-drag.
 *
 * The `control_surfaces` observer does not cover it. It fires on CHANGE, and a Push that
 * was plugged in all along never changes - it just was not ready yet.
 *
 * So: if nothing resolved, ask again, a few times, and stop as soon as something does.
 */
var controlsRetryTask: Task | null = null;
var controlsRetriesLeft = 0;
var CONTROLS_RETRY_MS = 1000;
var CONTROLS_RETRIES = 12;

/** Is this build a device that declared controls at all? */
function controlsDeclared(): boolean {
  return typeof CONTROLS_SPEC !== "undefined" && !!CONTROLS_SPEC && !!CONTROLS_SPEC.controls.length;
}

/**
 * Attach everything. Called from bang(), never loadbang - a LiveAPI object created
 * in a patcher-loading context is DEAD, and recreating unconditionally (no
 * `if (obs) return` guard) is what stops that bug being permanent.
 */
function setupControls(): void {
  if (!controlsDeclared()) return;

  // Nothing an ATTACHING observer fires may act. Every LiveAPI observer here calls
  // back once, immediately, while it is being created - so `control_surfaces` was
  // resolving the roles before this function had worked out which track the device is
  // on, and announcing "not_focused - this track 0 vs selected 0" on the way past. The
  // callbacks still RECORD what they are handed; they just do not decide anything
  // until the picture is whole.
  controlsStarted = false;

  controlsObjects = {};
  controlsIds = {};
  controlsNames = {};
  controlsShown = {};
  controlsHeld = false;
  controlsSurface = null;
  controlsSurfaceType = "";

  /**
   * Seed `focus` from the DECLARATION - but only if the PARAMETER has not already
   * spoken.
   *
   * Live restores a saved parameter during patcher load, so `controls_focus` arrives
   * before this runs, carrying what the user actually chose. Overwriting it with the
   * declared default is how a set saved with `Always` comes back as `Track` - the
   * device works, differently, and nothing says why. The seed is for the case the
   * parameter never announces itself at all, which is the one it exists for.
   */
  if (!controlsFocusSeen) controlsFocus = CONTROLS_SPEC!.focus;

  // The device's own identity FIRST, before anything can observe and ask about it.
  controlsIdentify();
  controlsWatchSurfaces();
  controlsWatchFocus();
  controlsResolve();

  // One line saying what was actually found, every load. Everything downstream of
  // here is silent when it fails - Live refuses a grab by posting and returning
  // normally - so this is the only place a person can check that the surface was
  // seen at all, and that this instance knows which track it is on.
  post(
    "m4l-jweb: controls on " +
      (controlsSurfaceType || "NO SURFACE") +
      ", track " +
      controlsThisTrackId +
      ", device " +
      controlsThisDeviceId +
      ", focus " +
      controlsFocus +
      "\n",
  );

  // Announce unconditionally on setup: `controlsApply` only speaks when the reason
  // CHANGES, and after a reload the reason is usually the same one as before.
  controlsStarted = true;
  controlsReason = "";
  controlsApply();

  // ...and if the answer was "nothing is there", it may simply be too early. See
  // controlsRetryTask.
  controlsScheduleRetry(CONTROLS_RETRIES);
}

/**
 * Re-send what a freshly loaded page could not have heard.
 *
 * Called from ui_ready(). The page loads asynchronously and long after bang()
 * resolved the roles, so every one of these messages was sent to nobody.
 */
function resendControls(): void {
  if (!controlsDeclared()) return;
  var specs = CONTROLS_SPEC!.controls;
  for (var i = 0; i < specs.length; i++) {
    outlet(0, "controls_role", specs[i].key, controlsIds[specs[i].key] ? 1 : 0);
  }
  outlet(0, "controls_held", controlsHeld ? 1 : 0, controlsReason || controlsHoldReason());
}

/**
 * Watch for a Push being plugged in or unplugged mid-set.
 *
 * `control_surfaces` is a flat list of `id N` pairs WITH EMPTY SLOTS (`id 0`) for
 * every unconfigured control-surface slot in Live's preferences, so most of it is
 * nothing. The callback only re-resolves; it does no LOM work of its own, because a
 * notification is not a safe place to change the set.
 */
function controlsWatchSurfaces(): void {
  controlsApp = null;
  try {
    controlsApp = new LiveAPI(function (a: unknown[]) {
      // The attach callback is not news - setupControls resolves right after this.
      if (!controlsStarted) return;
      if (a && a[0] == "control_surfaces") {
        post("m4l-jweb: control surfaces changed - re-resolving\n");
        controlsResolve();
        controlsApply();
        // A Push just arrived, or just left. Either way the retry's question is answered.
        controlsScheduleRetry(CONTROLS_RETRIES);
      }
    }, "live_app");
    controlsApp.property = "control_surfaces";
  } catch (e) {
    post("m4l-jweb: cannot observe control_surfaces - " + (e as Error).message + "\n");
  }
}

/** The first Push or Move in Live's control-surface slots. */
function controlsFindSurface(): void {
  controlsSurface = null;
  controlsSurfaceType = "";
  var app = new LiveAPI("live_app");
  if (!app.id) return;
  var flat = controlsAtoms(app.get("control_surfaces"));
  for (var i = 0; i < flat.length; i++) {
    if (String(flat[i]) === "id") continue; // the list alternates "id" and the number
    var id = Number(flat[i]);
    if (!id) continue; // an empty preferences slot
    var cs = new LiveAPI("id " + id);
    if (!cs.id) continue;
    var type = String(cs.type);
    for (var t = 0; t < CONTROLS_SURFACE_TYPES.length; t++) {
      if (type === CONTROLS_SURFACE_TYPES[t]) {
        controlsSurface = cs;
        controlsSurfaceType = type;
        return;
      }
    }
  }
}

/**
 * Resolve every declared role against the hardware that is actually plugged in.
 *
 * A Push 3 answers `get_control_names` with 176 names and they are NOT the Push 2
 * set, so a role is a CANDIDATE LIST and the first candidate the hardware admits to
 * having is the one used. Checking the list first is what turns "Live rejects the
 * call and says nothing" into a `controls_role <key> 0` the page can show: a name
 * that is not there is never called.
 */
function controlsResolve(): void {
  var specs = CONTROLS_SPEC!.controls;
  controlsFindSurface();

  if (!controlsSurface) {
    for (var n = 0; n < specs.length; n++) {
      controlsObjects[specs[n].key] = null;
      controlsIds[specs[n].key] = 0;
      outlet(0, "controls_role", specs[n].key, 0);
      outlet(1, "tk_" + specs[n].key, "id", 0); // id 0 = no object; the observer goes quiet
    }
    post("m4l-jweb: no Push or Move connected - the declared controls resolve to nothing\n");
    return;
  }

  var available = controlsControlNames();
  for (var i = 0; i < specs.length; i++) {
    var spec = specs[i];
    var name = "";
    for (var c = 0; c < spec.names.length; c++) {
      if (controlsHasName(available, spec.names[c])) {
        name = spec.names[c];
        break;
      }
    }

    var id = 0;
    if (name) id = controlsIdOf(controlsSurface.call("get_control", name));

    controlsNames[spec.key] = name;
    controlsIds[spec.key] = id;
    controlsObjects[spec.key] = id ? new LiveAPI("id " + id) : null;
    // The observer lives in the PATCHER (the `takeover` chain), so a press reaches
    // the page without passing through [js]. All it needs from here is the id, and
    // `[route tk_<key>]` strips the selector before it reaches the right inlet.
    outlet(1, "tk_" + spec.key, "id", id);
    outlet(0, "controls_role", spec.key, id ? 1 : 0);

    if (!id) {
      post(
        'm4l-jweb: role "' +
          spec.role +
          '" (' +
          spec.key +
          ") is not on this " +
          (controlsSurfaceType || "surface") +
          " - tried " +
          spec.names.join(", ") +
          "\n",
      );
    }
  }
}

/**
 * The connected surface's control vocabulary, as a lowercase lookup.
 *
 * The reply is MAX-FORMATTED: the selector, the count, then `control <name>` pairs,
 * then `done`. Nothing here depends on that layout - every atom goes in the set and
 * a name is looked up by value, so `control` and `done` are simply names no role
 * asks for.
 */
function controlsControlNames(): { [name: string]: boolean } {
  var out: { [name: string]: boolean } = {};
  try {
    var atoms = controlsAtoms(controlsSurface!.call("get_control_names"));
    for (var i = 0; i < atoms.length; i++) out[String(atoms[i]).toLowerCase()] = true;
  } catch (e) {
    post("m4l-jweb: get_control_names failed - " + (e as Error).message + "\n");
  }
  return out;
}

function controlsHasName(available: { [name: string]: boolean }, name: string): boolean {
  return available[String(name).toLowerCase()] === true;
}

/** A LOM reply as a plain array, whatever shape Max handed over. */
function controlsAtoms(v: unknown): unknown[] {
  if (v === null || typeof v === "undefined") return [];
  if (typeof v === "string") return [v];
  var list = v as { length?: number; [i: number]: unknown };
  if (typeof list.length !== "number") return [v];
  var out: unknown[] = [];
  for (var i = 0; i < list.length; i++) out.push(list[i]);
  return out;
}

/** An id, however the LOM chose to hand it over: a number, "id 5", or ["id", 5]. */
function controlsIdOf(v: unknown): number {
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

/* ------------------------------------------------------------------ *
 * The focus policy
 * ------------------------------------------------------------------ */

/**
 * The id an OBSERVER callback carries, from the atoms after the property name.
 *
 * A property observer is handed `[<property>, ...value]`, and an OBJECT-valued
 * property's value is the TWO atoms `id <n>` - so the callback is
 * `["selected_track", "id", 5]` and `a[1]` is the symbol `id`, not a number.
 *
 * THAT IS THE BUG THIS EXISTS TO NAME. Reading `a[1]` gives `Number("id")` = NaN,
 * which is not equal to anything, including itself - so the focus test could never
 * be true, `takeover` looked switched on and nothing was ever grabbed, and there was
 * no error anywhere because NaN is a perfectly ordinary number to compare. Take the
 * LAST atom, which is the id in both the `id <n>` and the bare-number shapes.
 */
function controlsIdFromCallback(a: unknown[]): number {
  if (!a || a.length < 2) return 0;
  return controlsIdOf(a[a.length - 1]);
}

/**
 * Observe what Live has selected, so `focus` can decide whether THIS instance holds
 * the hardware.
 *
 * Two of these devices in one set is the normal case, not the edge, and `Always`
 * means the last one loaded wins the grid forever - which reads as the first one
 * being broken. The selected TRACK is one observer; the selected DEVICE is an
 * observer on the selected track's view, so it has to be rebuilt whenever the track
 * changes.
 */
function controlsIdentify(): void {
  var me = new LiveAPI("this_device");
  controlsThisDeviceId = me.id ? Number(me.id) : 0;
  // ownTrack() (liveapi.ts) CLIMBS to the Track. `this_device canonical_parent` is
  // the track only when the device sits directly on one; inside a Rack it is the
  // CHAIN, whose id equals no selected_track ever - so a device in a rack would never
  // hold the grid under Track focus, silently.
  var track = ownTrack();
  controlsThisTrackId = track && track.id ? Number(track.id) : 0;
}

function controlsWatchFocus(): void {
  controlsTrackObs = null;
  try {
    controlsTrackObs = new LiveAPI(function (a: unknown[]) {
      if (!a || a[0] != "selected_track") return;
      controlsSelectedTrackId = controlsIdFromCallback(a);
      // Rebuilding an observer from inside a notification is not something to do in
      // the notification's own turn - the Live API is explicit that the set must not
      // be modified there. A Task puts it in the next one.
      if (controlsDeviceObsTask) controlsDeviceObsTask.cancel();
      controlsDeviceObsTask = new Task(controlsWatchSelectedDevice, this);
      controlsDeviceObsTask.schedule(0);
      // The id above is RECORDED either way - it is the value this observer exists
      // for, and the attach callback is the only place the current one arrives.
      if (controlsStarted) controlsApply();
    }, "live_set view");
    controlsTrackObs.property = "selected_track";
  } catch (e) {
    post("m4l-jweb: cannot observe the selected track - " + (e as Error).message + "\n");
  }

  controlsWatchSelectedDevice();
}

/** ...and the selected DEVICE, on whichever track is selected now. */
function controlsWatchSelectedDevice(): void {
  controlsDeviceObs = null;
  try {
    controlsDeviceObs = new LiveAPI(function (a: unknown[]) {
      if (!a || a[0] != "selected_device") return;
      controlsSelectedDeviceId = controlsIdFromCallback(a);
      if (controlsStarted) controlsApply();
    }, "live_set view selected_track view");
    controlsDeviceObs.property = "selected_device";
  } catch (e) {
    // A device-focused takeover then behaves like a track-focused one. Say so: the
    // alternative is a device that never grabs and never explains why.
    post('m4l-jweb: cannot observe the selected device - focus "Device" will behave like "Track" - ' + (e as Error).message + "\n");
  }
}

/**
 * Should this instance be holding the hardware - and if not, WHY NOT?
 *
 * It answers a reason rather than a boolean because "the pads did not light up" has
 * four completely different causes that look identical on a dark Push, and a rejected
 * LiveAPI call reports nothing at all. `held` means take it; anything else is the
 * reason, and it goes to the Max console and to the device view.
 *
 *   off         `takeover` is off. The default, and the commonest answer.
 *   no_surface  no Push or Move in Live's control-surface slots.
 *   unresolved  a surface is there, but no declared role resolved on it.
 *   not_focused `focus` says another track or device has it.
 */
function controlsHoldReason(): string {
  if (!controlsEnabled) return "off";
  if (!controlsSurface) return "no_surface";
  if (!controlsAnyResolved()) return "unresolved";
  if (controlsFocus === CONTROLS_FOCUS_ALWAYS) return "held";

  var byTrack = controlsThisTrackId !== 0 && controlsThisTrackId === controlsSelectedTrackId;
  if (controlsFocus === CONTROLS_FOCUS_DEVICE) {
    // With no reachable selected-device observer this degenerates to the track test,
    // which is the conservative answer: it can be too generous, never too silent.
    if (!controlsDeviceObs) return byTrack ? "held" : "not_focused";
    return controlsThisDeviceId !== 0 && controlsThisDeviceId === controlsSelectedDeviceId ? "held" : "not_focused";
  }
  return byTrack ? "held" : "not_focused";
}

/**
 * Ask again in a second, up to `tries` times, unless something has already resolved.
 *
 * Cheap: `get_control_names` on a surface that is not ready costs a rejected call and a
 * console line, and twelve of them over twelve seconds is nothing next to a device that
 * silently never works until the user re-drags it.
 */
function controlsScheduleRetry(tries: number): void {
  if (controlsRetryTask) controlsRetryTask.cancel();
  controlsRetryTask = null;
  if (tries <= 0) return;
  if (controlsAnyResolved()) return;

  controlsRetriesLeft = tries;
  controlsRetryTask = new Task(controlsRetry, this);
  controlsRetryTask.interval = CONTROLS_RETRY_MS;
  controlsRetryTask.repeat(tries);
}

function controlsRetry(): void {
  controlsRetriesLeft--;
  if (controlsAnyResolved()) {
    if (controlsRetryTask) controlsRetryTask.cancel();
    controlsRetryTask = null;
    return;
  }
  controlsResolve();
  controlsApply();
  if (controlsAnyResolved()) {
    post("m4l-jweb: controls resolved on retry - Live's surface was not ready at device load\n");
    if (controlsRetryTask) controlsRetryTask.cancel();
    controlsRetryTask = null;
    return;
  }
  if (controlsRetriesLeft <= 0) {
    post(
      "m4l-jweb: controls still unresolved after " +
        CONTROLS_RETRIES +
        " tries - plug a Push in, or delete and re-drag the device\n",
    );
  }
}

/** Did ANY declared role resolve? A surface with none of them is not a surface we can use. */
function controlsAnyResolved(): boolean {
  var specs = CONTROLS_SPEC!.controls;
  for (var i = 0; i < specs.length; i++) if (controlsIds[specs[i].key]) return true;
  return false;
}

/* ------------------------------------------------------------------ *
 * The grab
 * ------------------------------------------------------------------ */

/** The last reason announced, so a re-check that changed nothing says nothing. */
var controlsReason = "";

/** Take or give back the declared controls, so that reality matches the policy. */
function controlsApply(): void {
  if (!controlsDeclared() || !controlsStarted) return;
  var reason = controlsHoldReason();
  var want = reason === "held";
  if (want !== controlsHeld) {
    if (want) controlsGrab();
    else controlsRelease();
  }
  if (reason === controlsReason) return;
  controlsReason = reason;
  // The one line that answers "I turned Takeovr on and nothing happened". There is no
  // other channel: Live refuses a grab by posting and returning normally, so this is
  // the wrapper saying what it DECIDED, which is the half it does know.
  post("m4l-jweb: controls " + (want ? "HELD" : "not held") + " (" + reason + ")" + controlsFocusDetail(reason) + "\n");
  outlet(0, "controls_held", want ? 1 : 0, reason);
}

/** The ids behind a `not_focused`, because that is the one whose cause is invisible. */
function controlsFocusDetail(reason: string): string {
  if (reason !== "not_focused") return "";
  return (
    " - this track " +
    controlsThisTrackId +
    " vs selected " +
    controlsSelectedTrackId +
    ", this device " +
    controlsThisDeviceId +
    " vs selected " +
    controlsSelectedDeviceId
  );
}

function controlsGrab(): void {
  var specs = CONTROLS_SPEC!.controls;
  for (var i = 0; i < specs.length; i++) {
    var name = controlsNames[specs[i].key];
    if (!name || !controlsIds[specs[i].key]) continue;
    // BY NAME, on the SURFACE. A bare id is rejected and the two-atom `id <n>` form
    // buys nothing over this. There is no return value worth reading: a rejected
    // call posts to the Max console and returns normally.
    controlsSurface!.call("grab_control", name);
    // What is lit is now unknown - Live repaints the matrix as it hands it over.
    controlsShown[specs[i].key] = null;
  }
  controlsHeld = true;
  // The announcement is controlsApply's, not this function's: it is the one that
  // knows WHY, and a device view that only ever heard "held 0" could not tell the
  // four reasons apart.

  // THE FIRST FRAME AFTER A GRAB IS LOST, measured. Deferred, not handshaked: there
  // is nothing to wait on. A device that painted once here and then only on change
  // would come up blank and stay blank.
  if (controlsFirstFrameTask) controlsFirstFrameTask.cancel();
  controlsFirstFrameTask = new Task(controlsPaintAll, this);
  controlsFirstFrameTask.schedule(CONTROLS_FIRST_FRAME_MS);
}

function controlsRelease(): void {
  if (controlsFirstFrameTask) controlsFirstFrameTask.cancel();
  var specs = CONTROLS_SPEC!.controls;
  for (var i = 0; i < specs.length; i++) {
    var name = controlsNames[specs[i].key];
    // The surface can be GONE by now - a Push unplugged mid-set re-resolves to null,
    // and a release is exactly what we then want to do and cannot. Nothing is stranded
    // by skipping it: a grab belongs to the device context, and Live drops it.
    if (!name || !controlsIds[specs[i].key] || !controlsSurface) continue;
    controlsSurface.call("release_control", name);
    controlsShown[specs[i].key] = null;
  }
  controlsHeld = false;
}

/** The deferred first frame: everything the page has asked for, with nothing assumed lit. */
function controlsPaintAll(): void {
  if (!controlsHeld) return;
  var specs = CONTROLS_SPEC!.controls;
  for (var i = 0; i < specs.length; i++) {
    var key = specs[i].key;
    controlsShown[key] = null;
    controlsPaint(key, controlsWanted[key] || controlsBlank(specs[i]));
  }
}

/** A frame of nothing, so a control the page has not painted yet is dark rather than whatever Live left. */
function controlsBlank(spec: { rows: number; cols: number }): number[] {
  var cells: number[] = [];
  for (var i = 0; i < spec.rows * spec.cols; i++) cells.push(0);
  return cells;
}

/**
 * THE FRAME DIFF, and the only place `send_value` is called.
 *
 * The page sends the WHOLE grid; this decides what the hardware is actually told.
 * It is not the same diff the page does. The page's question is "did the device
 * change its mind"; this one is "does the pad already show this" - and after a grab
 * the answer is unknown for every cell, so `controlsShown` is null and everything
 * goes out.
 *
 * The budget is not a constraint: 64 `send_value` calls measured at ~2.6 ms, flat
 * across fifty consecutive full-grid frames, with no stutter in Live's UI. The diff
 * is here for the messages it does not send, not because the hardware could not keep
 * up.
 */
function controlsPaint(key: string, cells: number[]): void {
  var obj = controlsObjects[key];
  if (!obj || !controlsHeld) return;
  var spec = controlsSpecFor(key);
  if (!spec) return;

  var shown = controlsShown[key];
  var next: number[] = [];
  for (var i = 0; i < cells.length; i++) {
    var colour = Number(cells[i]) || 0;
    next.push(colour);
    if (shown && shown[i] === colour) continue;
    // Hardware coordinates throughout: row 0 is the TOP, which is the order the page
    // packed the frame in. Nothing in this file flips y.
    obj.call("send_value", i % spec.cols, Math.floor(i / spec.cols), colour);
  }
  controlsShown[key] = next;
}

function controlsSpecFor(key: string): { key: string; rows: number; cols: number } | null {
  var specs = CONTROLS_SPEC!.controls;
  for (var i = 0; i < specs.length; i++) if (specs[i].key === key) return specs[i];
  return null;
}

/* ------------------------------------------------------------------ *
 * The message handlers
 * ------------------------------------------------------------------ */

/**
 * The `takeover` parameter, tapped straight off the `live.toggle` by the chain.
 *
 * It does NOT come from the page, deliberately: a device whose grid dies because its
 * Chromium view was closed would fail exactly when the user is looking at the Push
 * instead of the screen.
 */
function controls_takeover(v: unknown): void {
  controlsEnabled = Number(v) >= 0.5;
  controlsApply();
}

/** The `focus` menu, as its index. See FOCUS_OPTIONS in @m4l-jweb/surface. */
function controls_focus(v: unknown): void {
  controlsFocus = Math.round(Number(v));
  controlsFocusSeen = true;
  controlsApply();
}

/**
 * `controls_frame <key> <c0> <c1> ...` - the whole grid, as palette indices, in
 * hardware order.
 *
 * Variadic, so it reads `arguments` rather than a fixed signature. It is stored even
 * when nothing is held: that is what makes the deferred first frame after a grab
 * show the picture the device already wanted rather than a blank grid.
 */
function controls_frame(): void {
  if (!controlsDeclared()) return;
  var args = arrayfromargs(arguments);
  if (!args.length) return;
  var key = String(args[0]);
  var cells: number[] = [];
  for (var i = 1; i < args.length; i++) cells.push(Number(args[i]) || 0);
  controlsWanted[key] = cells;
  controlsPaint(key, cells);
}

/** `controls_refresh` - forget what we believe is lit and repaint everything. */
function controls_refresh(): void {
  if (!controlsDeclared()) return;
  controlsPaintAll();
}
