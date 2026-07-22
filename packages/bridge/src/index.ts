/**
 * @m4l-jweb/bridge - the entire API surface between your web app and the device.
 *
 * jweb exposes exactly two calls to the embedded page:
 *   window.max.bindInlet(name, handler)  - receive a Max message
 *   window.max.outlet(...args)           - send a Max message
 *
 * That is it. Everything else in this package is ergonomics on top: the
 * `ui_ready` handshake, base64 helpers for structured payloads, and a dev shim
 * so the same code runs in a plain browser with hot reload.
 *
 * Zero dependencies, by design - this is the one piece that ships inside a
 * Chromium view embedded in a DAW.
 */

/**
 * Max message arguments are untyped on the wire (numbers, symbols, lists), so
 * handler params arrive as `unknown` and you narrow them at the edge:
 *   bindInlet("tempo", (bpm) => setTempo(Number(bpm)))
 */
type InletHandler = (...args: unknown[]) => void;

interface MaxGlobal {
  bindInlet: (name: string, fn: InletHandler) => void;
  outlet: (...args: unknown[]) => void;
}

declare global {
  interface Window {
    max?: MaxGlobal;
    maxSimulate?: (name: string, ...args: unknown[]) => void;
  }
}

const handlers = new Map<string, InletHandler>();

/** True inside a real [jweb] view; false in the browser dev shim. */
export const inJweb: boolean = typeof window !== "undefined" && !!window.max;

/* ------------------------------------------------------------------ *
 * The message tap
 *
 * The bridge is the ONLY channel between the two halves of a device, which
 * makes it the one place worth observing: tap it and you see the device's
 * entire contract, live, in both directions. The dev harness renders this as a
 * message log (see @m4l-jweb/surface/dev).
 *
 * It stays in the shipped bundle deliberately - an empty listener set costs a
 * branch per message, and a device in Live can be inspected by binding a tap
 * from the console. The harness UI is what gets tree-shaken out, not this.
 * ------------------------------------------------------------------ */

/** One message crossing the bridge. `in` = device -> UI, `out` = UI -> device. */
export interface BridgeMessage {
  direction: "in" | "out";
  selector: string;
  args: unknown[];
  /** performance.now() at the moment it crossed. */
  at: number;
}

type Tap = (m: BridgeMessage) => void;
const taps = new Set<Tap>();

/** Observe every message crossing the bridge. Returns an unsubscribe function. */
export function tapMessages(fn: Tap): () => void {
  taps.add(fn);
  return () => taps.delete(fn);
}

function emit(direction: "in" | "out", selector: string, args: unknown[]): void {
  if (!taps.size) return;
  const at = typeof performance !== "undefined" ? performance.now() : Date.now();
  for (const t of taps) t({ direction, selector, args, at });
}

/**
 * Handle the Max message `name`. Bind every selector your device receives, and
 * keep the names in one `protocol.ts` so both sides of the bridge agree.
 */
export function bindInlet(name: string, fn: InletHandler): void {
  // Wrap rather than register `fn` directly: the tap has to see inbound
  // messages in a real [jweb] too, where Max calls the handler we hand it.
  const tapped: InletHandler = (...args) => {
    emit("in", name, args);
    fn(...args);
  };
  handlers.set(name, tapped);
  if (typeof window !== "undefined" && window.max) {
    window.max.bindInlet(name, tapped);
  }
}

/** Send a Max message: a selector word followed by its arguments. */
export function outlet(...args: unknown[]): void {
  emit("out", String(args[0]), args.slice(1));
  if (typeof window !== "undefined" && window.max) {
    window.max.outlet(...args);
  } else {
    console.debug("[m4l-jweb:outlet]", ...args);
  }
}

/**
 * Deliver a message to the bound handlers as if the device had sent it.
 *
 * This is what `window.maxSimulate` calls, exported so the dev harness can
 * drive a device programmatically (a mock transport emitting `tick`/`tempo`).
 * In a real [jweb] it still works - it does not reach Max, it only fakes an
 * inbound message - so keep it to dev paths.
 */
export function simulate(name: string, ...args: unknown[]): void {
  const fn = handlers.get(name);
  if (fn) fn(...args);
  else console.warn(`[m4l-jweb] no handler bound for "${name}"`);
}

/**
 * Announce that the page has finished loading, so the wrapper can send back the
 * current state (mode, build stamp, tempo, parameters).
 *
 * This is NOT optional. The page loads asynchronously: anything the device sent
 * before your handlers were bound is simply gone. Call this once, after
 * binding, and treat the reply as the source of truth.
 */
export function uiReady(): void {
  outlet("ui_ready");
}

/**
 * Send a message to the page in another of this device's windows.
 *
 * Two pages of one device are two Chromium contexts: no shared globals, no
 * shared memory, no events between them. They talk through Max, and this is the
 * message that does not persist - the receiving page gets `<selector> <value>` on
 * the inlet it bound with `bindInlet`, and nothing is written to the Live set.
 *
 * Use a STATE SLOT instead for anything that must survive a save (the pattern,
 * a preset). Use this for what is happening NOW: a transport change, a knob
 * position, a nudge to re-read something.
 */
export function sendToWindow(windowId: string, selector: string, value: unknown): void {
  outlet("window_send", windowId, selector, value);
}

/* ------------------------------------------------------------------ *
 * The chain contract
 *
 * A chain in @m4l-jweb/build is library code, but until now the selectors for
 * ADDRESSING one were not: every device re-declared `midinote` and `notein` by
 * hand in its own protocol.ts, and a typo produced no error - just a message
 * falling on the floor.
 *
 * These are the selectors the packaged chains own. Spread them into your
 * device's protocol.ts so the name you send and the name the generated [route]
 * matches come from ONE definition:
 *
 *   export const IN  = { ...CHAIN_IN,  mode: "mode", build: "build" } as const;
 *   export const OUT = { ...CHAIN_OUT, ui_ready: "ui_ready" } as const;
 * ------------------------------------------------------------------ */

/**
 * Selectors the packaged WRAPPER sends to every device, always. Spread these in
 * too - they are not optional, and they are not yours to rename.
 */
export const DEVICE_IN = {
  /** wrapper -> UI: the run mode, from the [js] object-box argument. */
  mode: "mode",
  /** wrapper -> UI: the build stamp, for the stale-install check. */
  build: "build",
  /** wrapper -> UI: transport state. args: `<playing 0|1> <beats>`. */
  tick: "tick",
  /** wrapper -> UI: Live's tempo in BPM. args: `<bpm>`. */
  tempo: "tempo",
} as const;

/** Selectors the packaged chains SEND to the UI. Requires the `midiin` chain. */
export const CHAIN_IN = {
  /** midiin -> UI: `notein <pitch> <velocity>`. Velocity 0 is a note-off. */
  notein: "notein",
  /** download -> UI: `fetch_done <requestId> <bytes>`. */
  fetch_done: "fetch_done",
  /** download -> UI: `fetch_error <requestId> <msg>`. */
  fetch_error: "fetch_error",
  /** download -> UI: `fetch_progress <requestId> <downloaded> <total>`. */
  fetch_progress: "fetch_progress",
  /** download -> UI: `save_done <requestId> <bytes>` - the file is written and verified. */
  save_done: "save_done",
  /** download -> UI: `save_error <requestId> <msg>` - the write or atomic place failed. */
  save_error: "save_error",
} as const;

/** Selectors the packaged chains RECEIVE from the UI. Requires the `midiout` chain. */
export const CHAIN_OUT = {
  /** UI -> midiout: `midinote <pitch> <vel> <durMs> <chan> <delayMs>`. */
  midinote: "midinote",
  /** UI -> midiout: release every hanging note. */
  flush: "flush",
  /** UI -> download: `fetch_to_file <requestId> <url> <destPath>`. */
  fetch_to_file: "fetch_to_file",
  /** UI -> remote: `remote_bind <slot> <lomId>` - point a live.remote~ at a Live parameter. */
  remote_bind: "remote_bind",
  /** UI -> remote: `remote_val <slot> <value>` - the next value for that slot, ramped. */
  remote_val: "remote_val",
  /** UI -> download: `save_begin <requestId> <destPath> <byteCount>` - open a .part file. */
  save_begin: "save_begin",
  /** UI -> download: `save_chunk <requestId> <base64>` - one slice of the payload. */
  save_chunk: "save_chunk",
  /** UI -> download: `save_end <requestId>` - close, verify size, atomic place. */
  save_end: "save_end",
} as const;

/**
 * Selectors the WRAPPER handles for a device that declares `state` in its surface.
 *
 * THE SLOT ID IS AN ARGUMENT, NOT PART OF THE SELECTOR. `sync_state <id> <json>`,
 * never `sync_state_<id>`: Max dispatches a message on its first word, so an id
 * baked into the selector goes looking for a handler no device has and is swallowed
 * without a word. That shipped, and every write to a state slot was dropped.
 *
 * The reply comes back the other way (`state_<id> <json>`), because the BRIDGE
 * dispatches on the selector too - one binding per slot means the app never unpacks
 * an id. Two dispatchers, two conventions; the id sits on whichever side is doing
 * the looking up. `useStateSync()` handles both, and neither name is yours to type.
 */
export const STATE_OUT = {
  /** UI -> wrapper: send me slot `<id>`; reply on `state_<id>`. */
  get_state: "get_state",
  /** UI -> wrapper: `sync_state <id> <json>` - persist this slot in the Live set. */
  sync_state: "sync_state",
} as const;

/** Selectors the WRAPPER answers about this device's own Live parameters. */
export const PARAM_OUT = {
  /** UI -> wrapper: `get_param_id <id>` - what is this parameter's LOM id? Reply on `param_id`. */
  get_param_id: "get_param_id",
} as const;

/** ...and the reply. */
export const PARAM_IN = {
  /** wrapper -> UI: `param_id <id> <lomId>` - 0 means no parameter of that name resolved. */
  param_id: "param_id",
} as const;

/**
 * Selectors the WRAPPER handles for reading and writing the CLIP on this device's
 * track (`read_notes`/`write_clip` in liveapi.ts). Wrapper-owned, like DEVICE_IN -
 * no chain is involved, so a device that reads clips needs `unmatchedTo: "js"` so the
 * bare selector reaches `[js]`. `readClip()` / `writeClip()` below are the shaped API.
 */
export const CLIP_OUT = {
  /** UI -> wrapper: read this TRACK's playing (else first) clip, ignoring the selection. Reply on `notes`. */
  read_notes: "read_notes",
  /** UI -> wrapper: read the clip the CURSOR is on (Live's highlighted slot). Reply on `notes`. */
  read_selected_clip: "read_selected_clip",
  /** UI -> wrapper: `write_clip <lengthBeats> <n> <pitch start duration velocity> ...` - fill the first empty slot. */
  write_clip: "write_clip",
} as const;

/** ...and the reply from a read. */
export const CLIP_IN = {
  /** wrapper -> UI: `notes <loopEndBeats> <n> <pitch start duration> ...`. Velocity is not read back. */
  notes: "notes",
  /** wrapper -> UI: there was no clip on this track to read. */
  read_error: "read_error",
} as const;

/** A note handed to the `midiout` chain. Max does the placing; you do the timing. */
export interface Note {
  /** MIDI pitch, 0-127. */
  pitch: number;
  /** 1-127. Velocity 0 would be a note-off, which `makenote` already owns. */
  velocity: number;
  /** How long the note is held, in milliseconds. */
  durationMs: number;
  /** MIDI channel, 1-16. Default 1. */
  channel?: number;
  /** Lookahead: how far in the future to place the note. Default 0 (now). */
  delayMs?: number;
}

/**
 * Send one note to the `midiout` chain.
 *
 * Your app computes WHEN; Max places it. `delayMs` is the whole point: a
 * sequencer decides on a 20 Hz transport tick that a note falls 80 ms from now,
 * sends it with `delayMs: 80`, and [pipe] releases it on the scheduler at the
 * right moment. The note lands with Max's timing, not the browser's.
 *
 * Named fields rather than five positional ints, because
 * `outlet("midinote", 60, 100, 250, 1, 0)` is trivially easy to get subtly wrong
 * and produces no error when you do.
 */
export function sendNote(note: Note): void {
  outlet(CHAIN_OUT.midinote, note.pitch, note.velocity, note.durationMs, note.channel ?? 1, note.delayMs ?? 0);
}

/* ------------------------------------------------------------------ *
 * Incoming MIDI notes
 *
 * `bindInlet` keeps ONE handler per selector - a second bind REPLACES the first. So
 * `onNote` and `onNoteOff` must not each call it: whichever ran last would win and the
 * other's events would vanish. (They did, and a synth that bound both went deaf to
 * every note-on.) Instead ONE `notein` binding fans out to two subscriber sets, which
 * also means two `onNote` callers no longer silently clobber each other.
 * ------------------------------------------------------------------ */

const noteOnHandlers = new Set<(pitch: number, velocity: number) => void>();
const noteOffHandlers = new Set<(pitch: number) => void>();
let noteinBound = false;

function bindNotein(): void {
  if (noteinBound) return;
  noteinBound = true;
  bindInlet(CHAIN_IN.notein, (pitch, velocity) => {
    const p = Number(pitch);
    // Max's `midiparse` reports a release as velocity ZERO, not as a distinct message.
    if (Number(velocity) === 0) for (const fn of noteOffHandlers) fn(p);
    else for (const fn of noteOnHandlers) fn(p, Number(velocity));
  });
}

/**
 * Bind incoming MIDI note-ONS. Note-offs are filtered out, which is what a one-shot
 * wants: a struck sample (a piano, a drum) decays on its own and a release message
 * would only cut it short. A SUSTAINING voice needs the other half - see `onNoteOff`.
 *
 * Requires the `midiin` chain, and therefore a device of type "instrument" (an audio
 * effect has no MIDI ports).
 */
export function onNote(fn: (pitch: number, velocity: number) => void): void {
  noteOnHandlers.add(fn);
  bindNotein();
}

/**
 * Bind incoming MIDI note-OFFS - the releases `onNote` drops.
 *
 * Bind this when the voice you start SUSTAINS: an oscillator held open by a note-on
 * rings forever unless something tells it the key came up. Safe to use alongside
 * `onNote` - they share one binding and split the stream by velocity.
 */
export function onNoteOff(fn: (pitch: number) => void): void {
  noteOffHandlers.add(fn);
  bindNotein();
}

/**
 * Release every note the chain is currently holding.
 *
 * Call this when your device stops. Notes are held by [makenote] on the Max
 * side, so a UI that simply stops sending leaves them sounding forever.
 */
export function flushNotes(): void {
  outlet(CHAIN_OUT.flush);
}

const fetchResolvers = new Map<
  string,
  {
    resolve: (val: { bytes: number }) => void;
    reject: (err: Error) => void;
    onProgress?: (downloaded: number, total: number) => void;
  }
>();
let fetchBound = false;

/**
 * Fetch a URL and save it directly to disk via Max's [maxurl].
 * Requires the `download` chain in the device manifest.
 *
 * @param url The URL to download
 * @param destPath The absolute path to save the file
 * @param onProgress Optional callback for progress updates
 * @returns A promise resolving to the downloaded file size in bytes
 */
export function fetchToFile(url: string, destPath: string, onProgress?: (downloaded: number, total: number) => void): Promise<{ bytes: number }> {
  if (!fetchBound) {
    fetchBound = true;
    bindInlet(CHAIN_IN.fetch_done, (id, bytes) => {
      const p = fetchResolvers.get(String(id));
      if (p) {
        p.resolve({ bytes: Number(bytes) });
        fetchResolvers.delete(String(id));
      }
    });
    bindInlet(CHAIN_IN.fetch_error, (id, msg) => {
      const p = fetchResolvers.get(String(id));
      if (p) {
        p.reject(new Error(String(msg)));
        fetchResolvers.delete(String(id));
      }
    });
    bindInlet(CHAIN_IN.fetch_progress, (id, downloaded, total) => {
      const p = fetchResolvers.get(String(id));
      if (p && p.onProgress) p.onProgress(Number(downloaded), Number(total));
    });
  }

  return new Promise((resolve, reject) => {
    const requestId = Math.random().toString(36).substring(2, 10);
    fetchResolvers.set(requestId, { resolve, reject, onProgress });
    outlet(CHAIN_OUT.fetch_to_file, requestId, url, destPath);
  });
}

/**
 * Base64-encode raw bytes in slices, so a multi-megabyte buffer does not blow the
 * call stack (`String.fromCharCode(...hugeArray)` does). btoa wants a binary string;
 * we build it 32 KB at a time. No newlines, so the result is one safe Max symbol
 * once re-sliced by SAVE_B64_CHUNK.
 */
export function encodeBytesBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  const SLICE = 0x8000; // 32 KB per fromCharCode call
  let binary = "";
  for (let o = 0; o < view.length; o += SLICE) {
    binary += String.fromCharCode(...view.subarray(o, o + SLICE));
  }
  return btoa(binary);
}

const SAVE_B64_CHUNK = 8192; // base64 chars per message; well under Max atom limits

const saveResolvers = new Map<string, { resolve: (v: { bytes: number }) => void; reject: (e: Error) => void }>();
let saveBound = false;

/**
 * Write raw bytes straight to disk via the `download` chain's [js] wrapper.
 *
 * The inverse of `fetchToFile`: instead of Max pulling a URL, the UI hands the bytes
 * over base64 in slices and the wrapper writes them to a `.part` file, then atomically
 * places it at `destPath` via [maxurl] (the same move fetchToFile phase 2 uses). The
 * bytes travel base64 because Max splits messages on spaces/commas and base64 has
 * neither. Requires the `download` chain in the device manifest.
 *
 * @param destPath Absolute path (or device-relative, resolved wrapper-side) to write.
 * @param bytes The payload. A per-cycle WAV is ~350 KB => ~60 messages.
 * @returns Resolves with the verified byte count once the file is placed.
 */
export function saveToFile(destPath: string, bytes: ArrayBuffer): Promise<{ bytes: number }> {
  if (!saveBound) {
    saveBound = true;
    bindInlet(CHAIN_IN.save_done, (id, n) => {
      const p = saveResolvers.get(String(id));
      if (p) {
        p.resolve({ bytes: Number(n) });
        saveResolvers.delete(String(id));
      }
    });
    bindInlet(CHAIN_IN.save_error, (id, msg) => {
      const p = saveResolvers.get(String(id));
      if (p) {
        p.reject(new Error(String(msg)));
        saveResolvers.delete(String(id));
      }
    });
  }

  return new Promise((resolve, reject) => {
    const requestId = Math.random().toString(36).substring(2, 10);
    saveResolvers.set(requestId, { resolve, reject });
    const b64 = encodeBytesBase64(bytes);
    outlet(CHAIN_OUT.save_begin, requestId, destPath, bytes.byteLength);
    for (let o = 0; o < b64.length; o += SAVE_B64_CHUNK) {
      outlet(CHAIN_OUT.save_chunk, requestId, b64.slice(o, o + SAVE_B64_CHUNK));
    }
    outlet(CHAIN_OUT.save_end, requestId);
  });
}



/* ------------------------------------------------------------------ *
 * Remote - the `remote` chain (live.remote~ modulation)
 * ------------------------------------------------------------------ */

/**
 * Point a `remote` slot at a Live parameter, by LOM id.
 *
 * The slot is an index into the device's declared `remotes: <n>`; the id is a LiveAPI
 * object id for a `DeviceParameter` - `new LiveAPI(...).id`, whatever the app resolved
 * it from. Until a slot is bound it modulates nothing, which is the safe resting state.
 *
 * **Re-bind on every load, and never persist the id.** LOM ids are handles into the
 * running set, not names: they are not stable across a set reload, so an id saved
 * yesterday points at whatever occupies that slot today - or at nothing. Persist how
 * you FOUND the parameter (the device's position, the parameter's name) and resolve it
 * again. (Translate mode's reconciler followed the same rule; that mode was settled as
 * adopt-only, permanently - Live's Browser is unreachable from [js].)
 */
export function bindRemote(slot: number, lomId: number | string): void {
  outlet(CHAIN_OUT.remote_bind, slot, lomId);
}

/**
 * What is this device's own parameter's LOM id? - the id `bindRemote` needs.
 *
 * `id` is a surface parameter id, the same name you passed to `useParam()`: the build
 * wrote it into the patcher as the Live parameter's `parameter_longname`, so the two
 * cannot drift. Resolves to 0 if no parameter of that name is on the device, which is
 * a programming error rather than a runtime condition - check it.
 *
 * ASK AGAIN AFTER EVERY LOAD, and never persist what comes back. A LOM id is a handle
 * into the running set: it is not stable across a set reload, and an id from last time
 * points at whatever occupies that slot now. This call is cheap; a stale binding is a
 * filter sweep on someone else's device.
 */
export function resolveParamId(id: string, timeoutMs = 2000): Promise<number> {
  if (!paramIdBound) {
    paramIdBound = true;
    bindInlet(PARAM_IN.param_id, (which, lomId) => {
      const p = paramIdResolvers.get(String(which));
      if (!p) return;
      paramIdResolvers.delete(String(which));
      clearTimeout(p.timer);
      p.resolve(Number(lomId));
    });
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      paramIdResolvers.delete(id);
      reject(new Error(`parameter "${id}": the wrapper never answered get_param_id (${timeoutMs} ms). See the Max console.`));
    }, timeoutMs);
    paramIdResolvers.set(id, { resolve, timer });
    outlet(PARAM_OUT.get_param_id, id);
  });
}

const paramIdResolvers = new Map<string, { resolve: (id: number) => void; timer: ReturnType<typeof setTimeout> }>();
let paramIdBound = false;

/**
 * Send a slot's next value. Ramped, not stepped.
 *
 * Call this on the transport tick with the pattern's value for that moment. The chain
 * ramps to it over ~20 ms (`REMOTE_RAMP_MS`) rather than jumping, so a control-rate
 * stream of values comes out of Max as continuous modulation - see the `remote` chain
 * for why that ramp is the whole point.
 *
 * THE VALUE IS NOT IN THE PARAMETER'S OWN UNITS - measured in Live, not read
 * anywhere. live.remote~ treats it as a LINEAR position across the parameter's
 * range and applies the knob's `exponent` curve on top, as if the number had
 * grabbed the dial by its travel. For an exponent-1 parameter the two notions
 * coincide and raw units work; for a curved one (a filter cutoff at exponent 4)
 * the app must pre-warp: aim the travel at norm(v)^(1/e) so Live's ^e lands on v.
 * See m4l-strudel's useModulation.toRemote for the worked inverse.
 */
export function writeRemote(slot: number, value: number): void {
  outlet(CHAIN_OUT.remote_val, slot, value);
}

/* ------------------------------------------------------------------ *
 * Clip I/O - read and write the MIDI clip on this device's track
 *
 * The wrapper does the LiveAPI work (`read_notes`/`write_clip` in liveapi.ts); these
 * are the shaped API over it. No chain and no `[node.script]` - a clip is note data,
 * which is control-plane, so it crosses the bridge as a message. Needs
 * `unmatchedTo: "js"` in the manifest so the bare selector reaches `[js]`.
 * ------------------------------------------------------------------ */

/** One note in a clip. Times are in BEATS, from the clip's start. */
export interface ClipNote {
  pitch: number;
  /** Start, in beats from the clip's start. */
  start: number;
  /** Length, in beats. */
  duration: number;
  /** 1-127. Only WRITTEN - a read does not return it. */
  velocity: number;
}

/** What a clip read returns: the loop length and the notes (velocity is not read back). */
export interface ReadClip {
  /** The clip's loop end, in beats - its musical length. */
  loopEnd: number;
  notes: Omit<ClipNote, "velocity">[];
}

const readClipResolvers: { resolve: (c: ReadClip) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }[] = [];
let clipReadBound = false;

/** Bind the shared reply path once - both read paths answer on `notes` / `read_error`. */
function bindClipRead(): void {
  if (clipReadBound) return;
  clipReadBound = true;
  // One reply per outstanding read, in order - Live answers a read with one `notes`
  // (or one `read_error`), and reads are not interleaved in practice.
  bindInlet(CLIP_IN.notes, (...args) => {
    const p = readClipResolvers.shift();
    if (!p) return;
    clearTimeout(p.timer);
    const loopEnd = Number(args[0]);
    const n = Number(args[1]);
    const notes: Omit<ClipNote, "velocity">[] = [];
    for (let k = 0; k < n; k++) {
      const o = 2 + k * 3;
      notes.push({ pitch: Number(args[o]), start: Number(args[o + 1]), duration: Number(args[o + 2]) });
    }
    p.resolve({ loopEnd, notes });
  });
  bindInlet(CLIP_IN.read_error, (reason) => {
    const p = readClipResolvers.shift();
    if (!p) return;
    clearTimeout(p.timer);
    // The wrapper says WHY: "no_clip" (track has none) or "no_selection" (highlighted
    // slot is empty). Either way there is nothing to read.
    p.reject(new Error(String(reason) === "no_selection" ? "no clip in the highlighted slot - click a clip first" : "no clip on this track - create or play a MIDI clip first"));
  });
}

function requestClipRead(selector: string, timeoutMs: number): Promise<ReadClip> {
  bindClipRead();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const i = readClipResolvers.findIndex((r) => r.timer === timer);
      if (i >= 0) readClipResolvers.splice(i, 1);
      reject(new Error(`the wrapper never answered ${selector} (${timeoutMs} ms). See the Max console.`));
    }, timeoutMs);
    readClipResolvers.push({ resolve, reject, timer });
    outlet(selector);
  });
}

/**
 * Read the MIDI clip on this device's TRACK - the PLAYING one, or the first found,
 * regardless of the selection. Rejects if the track has no clip, or if the wrapper does
 * not answer inside `timeoutMs`. This is the right call for a device that operates on
 * its own track's pattern; for the clip the user has CLICKED, use `readSelectedClip()`.
 *
 * The bytes are notes, not audio, so unlike a sample they DO cross the bridge: the
 * wrapper reads them with LiveAPI's `get_notes_extended` and sends
 * `notes <loopEnd> <n> <pitch start duration> ...`.
 */
export function readClip(timeoutMs = 2000): Promise<ReadClip> {
  return requestClipRead(CLIP_OUT.read_notes, timeoutMs);
}

/**
 * Read the clip the CURSOR is on - Live's highlighted clip slot, whichever track and
 * scene. An empty highlighted slot rejects with "no clip in the highlighted slot", so
 * clicking an empty slot reads nothing rather than falling back to another clip. Same
 * resolved shape as `readClip()`.
 */
export function readSelectedClip(timeoutMs = 2000): Promise<ReadClip> {
  return requestClipRead(CLIP_OUT.read_selected_clip, timeoutMs);
}

/**
 * Write a clip into the first empty slot on this device's track.
 *
 * `lengthBeats` is the clip's length; the notes' `start`/`duration` are in beats
 * within it. The message is a flat list (`write_clip <lengthBeats> <n> <p s d v> ...`)
 * because Max has no nested arguments - the wrapper reads it back four atoms at a time.
 */
export function writeClip(lengthBeats: number, notes: readonly ClipNote[]): void {
  const flat: number[] = [lengthBeats, notes.length];
  for (const nt of notes) flat.push(nt.pitch, nt.start, nt.duration, nt.velocity);
  outlet(CLIP_OUT.write_clip, ...flat);
}

/**
 * Max splits messages on commas and semicolons, so any structured payload -
 * JSON, code, a filesystem path - must be encoded before it crosses the bridge.
 *
 * These are UTF-8 safe: btoa alone throws on anything outside latin1.
 */
export function encodeBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function decodeBase64(s: string): string {
  const binary = atob(s);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * Dev shim. Outside Max there is no window.max, so route messages straight into
 * the bound handlers and let the developer drive the device from the console:
 *
 *   maxSimulate("tempo", 128)
 *   maxSimulate("tick", 1, 4.25)
 */
if (typeof window !== "undefined" && !window.max) {
  window.maxSimulate = simulate;
  console.info("[m4l-jweb] running outside Max. Drive the device with: maxSimulate('tempo', 128)");
}
