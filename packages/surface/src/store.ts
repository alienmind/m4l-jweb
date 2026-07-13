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
import { defaults, type ParamSpec, type Surface } from "./index";

/** How long the user's hand beats an inbound value: long enough to cover the gaps between drag events, short enough to be imperceptible. */
export const GUARD_MS = 120;

/** Floats do not survive a round trip exactly. Anything closer than this is the same value. */
const EPSILON = 1e-6;

/** Max stores every parameter as a NUMBER. A menu is an index into its options; a toggle is 0/1. */
export function toWire(spec: ParamSpec, value: unknown): number {
  if (spec.kind === "toggle") return value ? 1 : 0;
  if (spec.kind === "menu") {
    const i = spec.options.indexOf(String(value));
    return i < 0 ? 0 : i;
  }
  return Number(value);
}

/** ...and back. An out-of-range menu index falls back to the default rather than `undefined`. */
export function fromWire(spec: ParamSpec, wire: number): unknown {
  if (spec.kind === "toggle") return wire >= 0.5;
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
