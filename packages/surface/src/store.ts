/**
 * store.ts - the parameter state behind useParam(), with no React in it.
 *
 * Separate from react.tsx on purpose. Everything subtle about a two-way parameter
 * binding lives here - the wire encoding, the echo guard - and none of it needs a
 * DOM, so all of it is testable (tests/surface-store.test.mjs). React gets a thin
 * useSyncExternalStore wrapper over this.
 *
 * ------------------------------------------------------------------------------
 * ONE STORE PER SURFACE, and it is not an optimisation.
 *
 * The bridge holds ONE handler per selector: a second `bindInlet("cutoff", ...)`
 * silently REPLACES the first. Two components each binding the parameter they
 * read would mean one of them never updates again, with no error anywhere. So a
 * surface binds each parameter exactly once, here, and fans out to subscribers.
 *
 * ------------------------------------------------------------------------------
 * THE ECHO GUARD, and what it is actually for.
 *
 * It is NOT for our own writes coming back. They do not: the patcher feeds the
 * live.* object a `set <value>`, which updates it without producing outlet output
 * (see surface.mjs). That is the defence at the source, and it is the load-bearing
 * one.
 *
 * This is the defence at the DESTINATION, against a different failure: a value
 * arriving *while the user is dragging*. Live sends one whenever it likes - an
 * automation lane is playing, someone turned the dial in Live, a Push encoder
 * moved - and applying it mid-drag makes the control jump backwards under the
 * mouse. So for a short window after a local write, an inbound value is dropped:
 * the user's hand wins, and the next value after the window lands normally.
 */
import { bindInlet, outlet } from "@m4l-jweb/bridge";
import { defaults, type ParamSpec, type StateSpec, type Surface } from "./index";

/** How long the user's hand beats an inbound value: long enough to cover the gaps between drag events, short enough to be imperceptible. */
export const GUARD_MS = 120;

/** Floats do not survive a round trip exactly. Anything closer than this is the same value. */
const EPSILON = 1e-6;

/** Max stores every parameter as a NUMBER. A menu is an index into its options; a toggle is 0/1. */
export function toWire(spec: ParamSpec, value: unknown): number {
  if (spec.kind === "toggle" || spec.kind === "button") return value ? 1 : 0;
  if (spec.kind === "menu") {
    const i = spec.options.indexOf(String(value));
    return i < 0 ? 0 : i;
  }
  return Number(value);
}

/** ...and back. An out-of-range menu index falls back to the default rather than `undefined`. */
export function fromWire(spec: ParamSpec, wire: number): unknown {
  if (spec.kind === "toggle" || spec.kind === "button") return wire >= 0.5;
  if (spec.kind === "menu") return spec.options[Math.round(wire)] ?? spec.default;
  return wire;
}

export type Values = Record<string, unknown>;

export interface ParamStore {
  get(): Values;
  subscribe(fn: () => void): () => void;
  write(id: string, value: unknown): void;
}

const stores = new WeakMap<object, ParamStore>();

/**
 * The store for a surface - created once, never torn down. The bridge's bindings
 * are process-wide, so tearing one down would unbind a parameter another component
 * still reads.
 */
export function paramStore<P extends Record<string, ParamSpec>>(surface: Surface<P>): ParamStore {
  const existing = stores.get(surface);
  if (existing) return existing;

  // The app's state before Live has replied: the declared defaults, which are also
  // what the live.* objects load with.
  let values: Values = { ...(defaults(surface) as Values) };
  const listeners = new Set<() => void>();
  const pending = new Map<string, { wire: number; at: number }>();

  const notify = () => {
    for (const fn of listeners) fn();
  };
  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

  for (const id of surface.ids) {
    const spec = surface.params[id];
    // `<id> <value>` - out of the live.* object, via [prepend <id>].
    bindInlet(id, (raw) => {
      const wire = Number(raw);
      const p = pending.get(id);
      if (p) {
        // Our own value, come back around (Live CAN echo one: a `set` write is
        // silent, but a value we sent while automation was writing the same
        // parameter may still return). Nothing to apply, and clearing the guard
        // early lets the next genuine value through sooner.
        if (Math.abs(wire - p.wire) <= EPSILON) {
          pending.delete(id);
          return;
        }
        // A DIFFERENT value, arriving while the user is still moving the control.
        // Dropping it is the point - see the note at the top of this file.
        if (now() - p.at < GUARD_MS) return;
        pending.delete(id);
      }
      values = { ...values, [id]: fromWire(spec, wire) };
      notify();
    });
  }

  const store: ParamStore = {
    get: () => values,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    write(id, value) {
      const spec = surface.params[id];
      if (!spec) return;
      const wire = toWire(spec, value);
      // Optimistic: the control follows the hand at once rather than waiting for
      // Live - which, because the patcher writes with `set`, would never send this
      // value back anyway.
      values = { ...values, [id]: value };
      pending.set(id, { wire, at: now() });
      notify();
      outlet(`set_${id}`, wire);
    },
  };

  stores.set(surface, store);
  return store;
}

/* ------------------------------------------------------------------ *
 * The state store - the JSON behind useStateSync(), persisted in the Live SET.
 *
 * A parameter is a Live parameter: a number, automatable, on Push. A state slot is
 * none of those things - it is whatever JSON the app wants to survive a save (a
 * pattern, a preset, a grid of steps), and Live never looks inside it.
 *
 * ------------------------------------------------------------------------------
 * THE ID IS AN ARGUMENT, NOT PART OF THE SELECTOR - and getting that wrong is why
 * nothing this store wrote was ever saved.
 *
 * It used to emit `sync_state_<id> <json>`. Max dispatches a message on its FIRST
 * WORD, so `sync_state_config` went looking for a `function sync_state_config()`,
 * found none, and fell into the wrapper's anything() - which exists precisely to
 * swallow messages meant for somebody else, silently, by design. The read path
 * (`get_state <id>`, reply `state_<id> <json>`) had it right, so state loaded and
 * never saved: the failure mode that looks like Live losing your data.
 *
 * OUT: `get_state <id>`, `sync_state <id> <json>`   - one handler each, in the wrapper.
 * IN:  `state_<id> <json>`                          - one binding per slot, so the
 *      bridge can dispatch it without the app unpacking an id.
 *
 * ------------------------------------------------------------------------------
 * EVERY VALUE TRAVELS INSIDE AN ENVELOPE, because a Max [dict] IS a key/value map
 * and cannot hold anything else.
 *
 * The wrapper stores a slot by handing the JSON to `Dict.parse()`. A dict has KEYS;
 * that is what a dict is. So an OBJECT round-tripped fine and nothing else did:
 * `state<string>` sent `"c1 e1"` and `state<FxParam[]>` sent `["cutoff"]`, and
 * `parse()` had nowhere to put either. The dict stayed empty, `stringify()` gave back
 * `{}`, and the app read its own default forever.
 *
 * That one bug wore two disguises, and cost real debugging as both: a drum map (an
 * object) persisted while the pattern text (a string) silently did not - which looks
 * exactly like Live losing your work; and the fx device's `named` slot (an array) came
 * back `{}` on every load, which was written off as the state-DEFAULT seeding gap. That
 * gap is real, but it is not this: `named` had never persisted at all.
 *
 * So the wire format is `{"__value": <whatever>}`, always. The dict gets its key, and
 * `state<T>` means what it says for every T.
 * ------------------------------------------------------------------ */

/** The one key a [dict] carries, so that a scalar has somewhere to live. */
const ENVELOPE = "__value";

/**
 * The envelope, as JSON, with every literal space escaped - so it crosses as ONE atom.
 *
 * [jweb] hands each argument to Max, and Max SPLITS A SYMBOL ON WHITESPACE. The
 * wrapper has always papered over this by rejoining the pieces with a single space,
 * which works for exactly as long as the payload never contains meaningful whitespace.
 * `JSON.stringify` of an object is compact, so a drum map arrived in one piece and the
 * seam held.
 *
 * A PATTERN IS NOTHING BUT WHITESPACE. `"c1  e1"` would come back `"c1 e1"` - the run
 * of spaces rejoined as one, the user's text quietly reformatted - and a multi-line
 * pattern (which is the whole point of the Studio window) is worse.
 *
 * ` ` is JSON's own escape for a space, so the payload contains no literal spaces
 * at all: Max cannot split what is not there, the rejoin becomes a no-op, and the dict's
 * JSON parser turns the escapes back into the spaces the user typed. Newlines and tabs
 * need no help - `JSON.stringify` already escapes those as `\n` and `\t`.
 */
function stateToWire(value: unknown): string {
  return JSON.stringify({ [ENVELOPE]: value }).replace(/ /g, "\\u0020");
}

/**
 * Unwrap what came out of the dict.
 *
 * A missing envelope is not an error, and there are two innocent ways to get one: a
 * slot Live has never saved (a fresh, empty `{}`), or a value written by a build from
 * before the envelope - which could only ever have been an object, since nothing else
 * could be stored. Both are answered without blanking the app, so opening an old set
 * keeps its drum map.
 */
function unwrap(parsed: unknown, fallback: unknown): unknown {
  if (parsed && typeof parsed === "object" && ENVELOPE in (parsed as Record<string, unknown>)) {
    return (parsed as Record<string, unknown>)[ENVELOPE];
  }
  // An empty dict means "nothing saved yet" - the declared default is the honest answer.
  if (parsed && typeof parsed === "object" && Object.keys(parsed as object).length === 0) return fallback;
  return parsed ?? fallback;
}

export interface StateStore {
  get(): Values;
  subscribe(fn: () => void): () => void;
  write(id: string, value: unknown): void;
}

const stateStores = new WeakMap<object, StateStore>();

/**
 * One store per surface, for the same reason paramStore is: one binding per selector.
 *
 * It asks for the SLOTS, not for a `Surface<P, S>` - a store that named the
 * parameter types would make every caller prove theirs match, and it does not read
 * a single parameter. The hook keeps the types; this keeps the state.
 */
export function stateStore(surface: { state?: Record<string, StateSpec> }): StateStore {
  const existing = stateStores.get(surface);
  if (existing) return existing;

  const ids = surface.state ? Object.keys(surface.state) : [];

  // What the app shows before Live has replied: the declared defaults.
  let values: Values = {};
  for (const id of ids) values[id] = surface.state![id].default;

  const listeners = new Set<() => void>();
  const notify = () => {
    for (const fn of listeners) fn();
  };

  for (const id of ids) {
    bindInlet(`state_${id}`, (raw) => {
      try {
        // The dict hands back `{"__value": ...}` - see the envelope note above. An
        // empty dict and a pre-envelope value both resolve to something sane rather
        // than to nothing.
        values = { ...values, [id]: unwrap(JSON.parse(String(raw)), surface.state![id].default) };
        notify();
      } catch {
        // An empty dict stringifies to "{}" and parses fine; anything that does
        // not parse is a slot we have no value for, and the default already in
        // `values` is the honest answer. Keep it rather than blanking the app.
      }
    });
    // The page loads asynchronously and long after the device did, so nothing was
    // listening when Live restored the pattr. Ask for it.
    outlet("get_state", id);
  }

  const store: StateStore = {
    get: () => values,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    write(id, value) {
      values = { ...values, [id]: value };
      notify();
      // Enveloped, ALWAYS - a bare string or array has nowhere to live in a [dict] -
      // and space-escaped, so Max cannot split the payload on the way.
      outlet("sync_state", id, stateToWire(value));
    },
  };

  stateStores.set(surface, store);
  return store;
}
