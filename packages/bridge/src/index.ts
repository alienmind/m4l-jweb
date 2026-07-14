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
  /** samples -> UI: `buffer_ready <slot> <sampleRate> <ms> <channels>` - what actually loaded. */
  buffer_ready: "buffer_ready",
} as const;

/** Selectors the packaged chains RECEIVE from the UI. Requires the `midiout` chain. */
export const CHAIN_OUT = {
  /** UI -> midiout: `midinote <pitch> <vel> <durMs> <chan> <delayMs>`. */
  midinote: "midinote",
  /** UI -> midiout: release every hanging note. */
  flush: "flush",
  /** UI -> download: `fetch_to_file <requestId> <url> <destPath>`. */
  fetch_to_file: "fetch_to_file",
  /** UI -> samples: `buffer_load <slot> <path>` - read a file into that slot's [buffer~]. */
  buffer_load: "buffer_load",
  /** UI -> samples: `buffer_play <slot>` - preview it through the track. */
  buffer_play: "buffer_play",
  /** UI -> samples: `buffer_stop` - stop the preview. */
  buffer_stop: "buffer_stop",
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

/** Bind incoming MIDI. Note-offs are filtered out: `makenote` already owns the release. */
export function onNote(fn: (pitch: number, velocity: number) => void): void {
  bindInlet(CHAIN_IN.notein, (pitch, velocity) => {
    const v = Number(velocity);
    if (v === 0) return;
    fn(Number(pitch), v);
  });
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

/* ------------------------------------------------------------------ *
 * Samples - the `samples` chain
 * ------------------------------------------------------------------ */

/** What a slot actually holds, once the read completed. Reported by [info~], not assumed. */
export interface LoadedSample {
  /** The FILE's sample rate, which need not be Live's. */
  sampleRate: number;
  durationMs: number;
  /** The file's channel count. `replace` adopts it - a slot is not mono by wishing. */
  channels: number;
  /** Derived from the two above. Nobody counted them. */
  frames: number;
}

const sampleResolvers = new Map<string, { resolve: (s: LoadedSample) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
let samplesBound = false;

/**
 * Read a file from disk into a slot's [buffer~], and resolve with WHAT LANDED.
 *
 * Requires the `samples` chain, and the file must already be on disk - that is what
 * `fetchToFile()` is for. The bytes never cross the bridge in either direction: Max
 * reads the file, and what comes back is a description of it.
 *
 * The resolved value is measured, not assumed. `replace` adopts the file's channel
 * count and sample rate, so a stereo file in a slot you think of as mono is a stereo
 * slot - and a frame count is not proof of a read, because a FAILED read leaves the
 * previous contents of the buffer exactly where they were. The chain only replies
 * when [buffer~] says the read completed; a file Max cannot read produces an error in
 * the Max console and NO reply at all, which is what the timeout below is for. There
 * is no bang for failure to bind to.
 */
export function loadSample(slot: string, path: string, timeoutMs = 10_000): Promise<LoadedSample> {
  if (!samplesBound) {
    samplesBound = true;
    bindInlet(CHAIN_IN.buffer_ready, (id, sampleRate, ms, channels) => {
      const p = sampleResolvers.get(String(id));
      if (!p) return;
      sampleResolvers.delete(String(id));
      clearTimeout(p.timer);
      const sr = Number(sampleRate);
      const durationMs = Number(ms);
      const chans = Number(channels);
      // An empty buffer is a read that "worked" and gave us nothing. Do not hand the
      // app a slot it will play in silence and blame itself for.
      if (!(sr > 0) || !(durationMs > 0) || !(chans > 0)) {
        p.reject(new Error(`slot "${id}" loaded empty: ${durationMs} ms, ${chans} channels at ${sr} Hz`));
        return;
      }
      p.resolve({ sampleRate: sr, durationMs, channels: chans, frames: Math.round((durationMs / 1000) * sr) });
    });
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      sampleResolvers.delete(slot);
      reject(new Error(`slot "${slot}": [buffer~] never reported a completed read of "${path}" (${timeoutMs} ms). See the Max console.`));
    }, timeoutMs);
    sampleResolvers.set(slot, { resolve, reject, timer });
    outlet(CHAIN_OUT.buffer_load, slot, path);
  });
}

/**
 * Play a loaded slot, once, from the beginning - THROUGH THE TRACK.
 *
 * That last part is the whole reason this exists. Audio a page plays for itself goes
 * to the OS output device: [jweb] has no signal outlets, so it bypasses the track,
 * the fader and the monitor cue. A preview Live can hear has to be [buffer~] in the
 * patcher, which is this.
 */
export function playSample(slot: string): void {
  outlet(CHAIN_OUT.buffer_play, slot);
}

/** Stop the preview. One voice, so this stops whichever slot is sounding. */
export function stopSample(): void {
  outlet(CHAIN_OUT.buffer_stop);
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
