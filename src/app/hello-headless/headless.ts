/**
 * headless.ts (hello-headless) - the device, with no browser anywhere in it.
 *
 * This file is to a headless device what `App.tsx` is to a jweb one: the thing it
 * actually does. It is compiled to ES5 and concatenated after the packaged wrapper, so
 * it runs inside Max's `[js]` and sees the wrapper's globals - `post`, `outlet`,
 * `Task`, `LiveAPI`, `MODE`.
 *
 * ------------------------------------------------------------------------------
 * HOW A PARAMETER REACHES IT, and how it writes one back.
 *
 * Exactly the way the page does, through the same generated boxes - only both ends are
 * now this script:
 *
 *   [live.dial rate] -> [prepend rate] -> [js]        `function rate(v)`, below
 *   [js] -> [route ... set_rate] -> [prepend set] -> [live.dial rate]
 *
 * So a declared parameter is a FUNCTION NAME here. That is the whole binding: no
 * `useParam`, no store, no handshake - the wrapper's dispatch is the binding, and Max
 * calls the function when the knob moves, when an automation lane plays, and when a
 * Push encoder is turned.
 *
 * ------------------------------------------------------------------------------
 * THE CLOCK IS A `Task`, AND THAT IS AN UPGRADE.
 *
 * A jweb device puts its clock in a Worker to dodge the throttling Chromium applies to
 * a hidden page - and a device view IS usually hidden, because the user is looking at
 * Live. There is no page here to throttle. `Task` is Max's own scheduler; it runs
 * whether or not anyone is looking at anything.
 *
 * `setTimeout` does not exist in [js] and `console` does not either (CLAUDE.md, hard
 * rule 2). `post()` and `Task`.
 * ------------------------------------------------------------------------------
 */

/** The parameter values, seeded with the same defaults the `live.*` objects load at. */
var arpRunning = false;
var arpRate = 6;
var arpSteps = 4;
var arpRoot = 48;

/** Where in the pattern we are, and the clock driving it. */
var arpStep = 0;
var arpTask: Task | null = null;

/** A major triad plus the octave, in semitones - four notes that sound like a chord. */
var ARP_INTERVALS = [0, 4, 7, 12, 14, 16, 19, 24];

/** Fixed at 100, because a device with a velocity dial and no way to play it is a demo. */
var ARP_VELOCITY = 100;
/** Short enough that consecutive steps do not overlap even at 16 Hz. */
var ARP_DURATION_MS = 55;

/**
 * The transport toggle. A generated parameter is a function name - see the header.
 *
 * Max hands a `live.toggle` over as 0 or 1, and `>= 0.5` rather than `=== 1` because
 * every parameter crosses as a float and an automation lane can land on 0.999999.
 */
function running(v: number): void {
  arpRunning = Number(v) >= 0.5;
  arpReschedule();
}

function rate(v: number): void {
  arpRate = Number(v);
  arpReschedule();
}

function steps(v: number): void {
  arpSteps = Math.max(2, Math.round(Number(v)));
  // Wrapping here rather than at the next tick keeps the pattern from playing one note
  // above the new top when the dial is turned down mid-run.
  if (arpStep >= arpSteps) arpStep = 0;
}

function root(v: number): void {
  arpRoot = Math.round(Number(v));
}

/**
 * Start, stop, or re-time the clock.
 *
 * A `Task` is recreated rather than re-intervalled: `interval` is read when the task is
 * scheduled, so turning the rate dial on a running task would not take effect until it
 * next fired - which at 1 Hz is a whole second of the dial appearing dead.
 */
function arpReschedule(): void {
  if (arpTask) arpTask.cancel();
  arpTask = null;
  if (!arpRunning) return;

  arpTask = new Task(arpTick, this);
  arpTask.interval = 1000 / Math.max(1, arpRate);
  arpTask.repeat();
}

/**
 * One step: a note out of the `midiout` chain.
 *
 * `midinote <pitch> <velocity> <durationMs> <channel> <delayMs>` is the chain's own
 * selector, and the chain is the same one a jweb device uses - the app endpoint moved,
 * the chain did not. Max places the note on its scheduler; this decides only WHEN.
 *
 * Fixed arity, never `outlet.apply`: calling a Max host function through `.apply` does
 * not fail, it CRASHES LIVE (doc/MAX-FACTS.md).
 */
function arpTick(): void {
  var pitch = arpRoot + ARP_INTERVALS[arpStep % ARP_INTERVALS.length];
  outlet(0, "midinote", pitch, ARP_VELOCITY, ARP_DURATION_MS, 1, 0);
  arpStep = (arpStep + 1) % arpSteps;
}

/**
 * live.thisdevice has fired: the device is fully in the Live set.
 *
 * NOT `onDeviceReady` - that hook belongs to the repo-wide `wrapper/device.ts`, and
 * everything here is concatenated into ONE [js] script, so a second definition would
 * replace it rather than extend it, silently, for every device in the repo.
 *
 * Nothing is started here. The parameters announce themselves as Live restores them,
 * and `running` defaults to off: a device that begins playing the moment it is dropped
 * on a track is a device people delete.
 */
function onHeadlessReady(): void {
  post("m4l-jweb: hello-headless ready - no [jweb] in this device at all\n");
}
