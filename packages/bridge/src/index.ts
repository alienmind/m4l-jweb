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
} as const;

/** Selectors the packaged chains RECEIVE from the UI. Requires the `midiout` chain. */
export const CHAIN_OUT = {
  /** UI -> midiout: `midinote <pitch> <vel> <durMs> <chan> <delayMs>`. */
  midinote: "midinote",
  /** UI -> midiout: release every hanging note. */
  flush: "flush",
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
