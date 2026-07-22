/**
 * @m4l-jweb/surface/react - bind a declared parameter to React, in both directions.
 *
 *   const [cutoff, setCutoff] = useParam(surface, "cutoff");
 *
 * That is a two-way binding to a REAL Live parameter, typed from the declaration:
 * `number` for a dial, `boolean` for a toggle, the union of the options for a
 * menu. Turning a Push encoder moves the React state; moving the React control
 * moves the Live parameter, so automation, MIDI mapping and Push all follow.
 *
 * The component names no selectors. `cutoff` and `set_cutoff` are derived from the
 * declaration, exactly as the patcher's `[prepend cutoff]` and `[route set_cutoff]`
 * are - one declaration, one name, both sides. `tests/protocol.test.mjs` fails if a
 * device re-declares one by hand.
 *
 * The state itself, the wire encoding and the echo guard live in `store.ts`, which
 * has no React in it and is tested without a DOM. This file is the hook.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { describeParam, onParamRange, outlet } from "@m4l-jweb/bridge";
import type { ParamSpec, ParamValue, StateSpec, StateValue, Surface, Watch, WatchSpec, WatchValue, WindowSpec } from "./index";
import { JWEB_VARNAME } from "./index";
import { paramStore, stateStore, watchStore } from "./store";

/**
 * A two-way binding to one Live parameter. `[value, setValue]`, like useState -
 * except the state lives in Live, and so do automation, MIDI mapping and Push.
 */
export function useParam<P extends Record<string, ParamSpec>, K extends Extract<keyof P, string>>(
  surface: Surface<P>,
  id: K,
): [ParamValue<P[K]>, (value: ParamValue<P[K]>) => void] {
  const store = useMemo(() => paramStore(surface), [surface]);
  const values = useSyncExternalStore(store.subscribe, store.get, store.get);
  const set = useCallback((value: ParamValue<P[K]>) => store.write(id, value), [store, id]);
  return [values[id] as ParamValue<P[K]>, set];
}

/** Every parameter at once, for the component that wants the whole bag - the dev harness's panel, say. */
export function useSurface<P extends Record<string, ParamSpec>>(
  surface: Surface<P>,
): [{ [K in keyof P]: ParamValue<P[K]> }, <K extends Extract<keyof P, string>>(id: K, value: ParamValue<P[K]>) => void] {
  const store = useMemo(() => paramStore(surface), [surface]);
  const values = useSyncExternalStore(store.subscribe, store.get, store.get);
  const set = useCallback(<K extends Extract<keyof P, string>>(id: K, value: ParamValue<P[K]>) => store.write(id, value), [store]);
  return [values as { [K in keyof P]: ParamValue<P[K]> }, set];
}

/**
 * Open and close a declared floating window.
 *
 * The selectors are DERIVED from the declaration, exactly as the patcher's
 * `[route window_<id>_open ...]` is - so the window id is typed against the
 * surface and a typo is a build error, not a button that does nothing.
 */
export function useWindow<
  P extends Record<string, ParamSpec>,
  S extends Record<string, StateSpec>,
  W extends Record<string, WindowSpec>,
  K extends Extract<keyof W, string>,
>(_surface: Surface<P, S, W>, id: K): { open: () => void; close: () => void } {
  return useMemo(
    () => ({
      open: () => outlet(`window_${id}_open`, 1),
      close: () => outlet(`window_${id}_close`, 1),
    }),
    [id],
  );
}

/**
 * Show or hide a NATIVE dial in the device view at runtime.
 *
 * `layout.native` makes a parameter a native `live.*` object, but its presentation
 * is STATIC - the dial is always visible. This is the runtime override: the app says
 * which native params should be shown, and a `[thispatcher]` runs `script show`/
 * `script hide` on the object by its scripting name (`param-<id>`, see
 * `applyNativeControl` in @m4l-jweb/build). The parameter itself is untouched - a
 * hidden dial still automates, MIDI-maps and reaches Push; only visibility changes.
 *
 * Returns a stable `(id, visible) => void`. Drive it from an effect that mirrors the
 * app's own "which stages are active" state, e.g. `useEffect` over the shown set.
 */
export function useNativeVisibility<P extends Record<string, ParamSpec>>(
  _surface: Surface<P>,
): (id: Extract<keyof P, string>, visible: boolean) => void {
  return useCallback((id: Extract<keyof P, string>, visible: boolean) => {
    // The varname applySurface() gave the object is `param-<id>`. Keep this prefix
    // in step with that codegen - it is the one string both sides must agree on.
    outlet(visible ? "native_show" : "native_hide", `param-${id}`);
  }, []);
}

/**
 * Flip the device view between the WEB UI and a NATIVE control panel - the "two
 * screens" model. Runtime reposition/resize of presentation objects does NOT work in
 * a frozen M4L device (measured: `presentation_rect` writes are stored but never
 * redrawn), but `hidden` DOES. So instead of reflowing dials, we layer them:
 *
 *   "web"    - show [jweb] (full width), hide every native dial and the switch. The
 *              web UI paints its own switch button; the native one would only fight
 *              it for the same top-right spot.
 *   "native" - hide [jweb], show every native dial AND the switch - which is the way
 *              back, since the web UI is hidden here.
 *
 * Only `hidden` is used, so this actually works where reflow could not, and no layer
 * is ever visible at the same time as another - so z-order never matters.
 */
export function useNativePanel<P extends Record<string, ParamSpec>>(surface: Surface<P>): (mode: "web" | "native") => void {
  return useCallback(
    (mode: "web" | "native") => {
      const native = surface.layout?.native;
      if (!native) return;
      const web = mode === "web";
      const toggle = (varname: string) => outlet(web ? "native_hide" : "native_show", varname);
      outlet(web ? "native_show" : "native_hide", JWEB_VARNAME);
      for (const id of native.params as readonly string[]) toggle(`param-${id}`);
      if (native.switch) toggle(`param-${native.switch}`);
    },
    [surface],
  );
}

/**
 * A one-way binding to an observed Live property, declared with `defineWatch()`.
 *
 * Read-only, so it returns the value alone - no setter. The mirror of `useParam`:
 * a parameter the app both reads and writes; a watch it only reads. Turning the
 * tempo, changing the scale, selecting a track in Live moves this React state, and
 * the wrapper attaches every observer from `bang()` - the one place LiveAPI is
 * safe - so the trap of a dead loadbang observer is not one a device can fall into.
 *
 * The selector is DERIVED (`watch_<key>`), exactly as `useParam`'s is, so a key
 * that is not declared is a build error at the call site, not a value that never
 * arrives.
 */
export function useWatch<W extends Record<string, WatchSpec>, K extends Extract<keyof W, string>>(watch: Watch<W>, key: K): WatchValue<W[K]> {
  const store = useMemo(() => watchStore(watch), [watch]);
  const values = useSyncExternalStore(store.subscribe, store.get, store.get);
  return values[key] as WatchValue<W[K]>;
}

/**
 * A two-way binding to a JSON state slot, persisted in the Live SET.
 *
 * `[value, setValue]`, like useState - except the value survives saving, closing
 * and reopening the set, and each instance of the device keeps its own. The type
 * comes from the declaration's `default`, so there is nothing to cast.
 */
export function useStateSync<
  P extends Record<string, ParamSpec>,
  S extends Record<string, StateSpec>,
  W extends Record<string, WindowSpec>,
  K extends Extract<keyof S, string>,
>(surface: Surface<P, S, W>, id: K): [StateValue<S[K]>, (value: StateValue<S[K]>) => void] {
  const store = useMemo(() => stateStore(surface), [surface]);
  const values = useSyncExternalStore(store.subscribe, store.get, store.get);
  const set = useCallback((value: StateValue<S[K]>) => store.write(id, value), [store, id]);
  return [values[id] as StateValue<S[K]>, set];
}

/* ------------------------------------------------------------------ *
 * Borrowing from a native knob pool
 * ------------------------------------------------------------------ */

/** A control a device wants on a native dial, described as well as it can. */
export interface BorrowedControl {
  /** What to call it - the user's own term where the device can infer one. */
  name: string;
  /** Its real travel. The dial is declared 0..1; this is what the value means. */
  min: number;
  max: number;
  /** How Live should print it ("Hz", "dB", "%"...). Optional; see describeParam. */
  unit?: string;
  /** Where it starts, in real units, the first time it takes a slot. */
  value?: number;
}

/** A borrowed control, wired to the dial that is carrying it. */
export interface PooledControl extends BorrowedControl {
  /** Position 0..1, for drawing a fader. */
  norm: number;
  /** The value the device should use, in the control's own units. */
  raw: number;
  /** Move it, from a 0..1 position. */
  set: (norm: number) => void;
  /** Which pool slot it landed on (1-based), for a tooltip. */
  slot: number;
  /** The parameter id behind it, for anything that needs to name it. */
  param: string;
}

/**
 * Hand a device's dynamic controls to a fixed pool of native dials.
 *
 * A device whose controls come from the user's code - a pattern's `slider()`s, the
 * parameters of an effect just loaded - cannot declare them: a `live.dial` is
 * stamped into the frozen `.amxd` at build time. So it declares a POOL
 * (`knobPool(8)`) and borrows: control 1 takes the first slot, control 2 the
 * second, and a control that goes away returns its slot. Order is the mapping,
 * which means re-editing a line keeps the same knob on the same control.
 *
 * WHAT THIS OWNS, so no device has to:
 *
 * 1. The by-order borrowing, and seeding a freshly borrowed dial with the
 *    control's own starting value rather than leaving it at 0.
 * 2. Telling Live what each dial currently IS - name, unit, range - so the panel
 *    stops reading `S1` and the readout stops reading `0.44` for 600 Hz.
 * 3. THE SCALING, which is the part that bites. Live accepts a runtime range, and
 *    the parameter then reports IN THAT RANGE. A device that goes on normalizing
 *    0..1 would scale an already-scaled value and the knob would stick at its
 *    minimum - the bug that got an earlier attempt at this reverted. The wrapper
 *    answers whether each range took, and this hook scales exactly once either way.
 *
 * KNOWN LIMIT, measured in Live: the name reaches the DEVICE PANEL, not Live's
 * parameter registry or a Rack macro picker, which keep the pool's own `S1..S8`.
 * A frozen device cannot rename a parameter there. So render the name in your own
 * UI as well - never rely on the dial to carry it.
 */
export function useControls<P extends Record<string, ParamSpec>>(
  surface: Surface<P>,
  controls: readonly BorrowedControl[],
  poolIds: readonly Extract<keyof P, string>[],
): PooledControl[] {
  /* eslint-disable react-hooks/rules-of-hooks */
  // A pool is dials, so its values are numbers - but `P` is the whole surface and
  // the compiler cannot know the caller passed dial ids. Narrowed once, here,
  // rather than at every write below.
  const params = poolIds.map((id) => useParam(surface, id)) as unknown as [number, (v: number) => void][];
  /* eslint-enable react-hooks/rules-of-hooks */

  /** Which dials Live actually widened. Until it says so, the dial is 0..1. */
  const [real, setReal] = useState<boolean[]>([]);
  useEffect(() => {
    onParamRange((id, took) => {
      const i = poolIds.indexOf(id as Extract<keyof P, string>);
      if (i < 0) return;
      setReal((prev) => {
        if (prev[i] === took) return prev;
        const next = prev.slice();
        next[i] = took;
        return next;
      });
    });
    // The pool is a declaration; it does not change at runtime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Say what each slot is now carrying, on change only: describeParam writes Live
  // parameter attributes, and a device re-rendering is not news.
  const described = useRef<string[]>([]);
  useEffect(() => {
    for (let i = 0; i < poolIds.length; i++) {
      const c = controls[i];
      const key = c ? `${c.name} ${c.min} ${c.max} ${c.unit ?? ""}` : "";
      if (described.current[i] === key) continue;
      described.current[i] = key;
      // A slot nobody is borrowing goes back to its declared identity, or it would
      // keep the name of a control that is no longer there.
      if (c) describeParam(poolIds[i], { name: c.name, unit: c.unit, range: [c.min, c.max] });
      else describeParam(poolIds[i], { name: String(poolIds[i]).toUpperCase(), range: [0, 1] });
    }
  }, [controls, poolIds]);

  // Seed a slot the first time a given control takes it, so an untouched dial reads
  // what the control says rather than 0.
  const seeded = useRef<string[]>([]);
  useEffect(() => {
    controls.forEach((c, i) => {
      if (i >= poolIds.length || c.value === undefined) return;
      const key = `${c.name} ${c.min} ${c.max}`;
      if (seeded.current[i] === key) return;
      seeded.current[i] = key;
      const span = c.max - c.min || 1;
      params[i][1](real[i] ? c.value : (c.value - c.min) / span);
    });
    seeded.current.length = controls.length;
    // `params` is rebuilt every render by design; the seed is guarded by `seeded`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controls, real]);

  return controls.slice(0, poolIds.length).map((c, i) => {
    const span = c.max - c.min || 1;
    const held = Number(params[i][0] ?? 0);
    const norm = real[i] ? (held - c.min) / span : held;
    return {
      ...c,
      norm: Math.min(1, Math.max(0, norm)),
      raw: real[i] ? held : c.min + held * span,
      set: (n: number) => {
        const clamped = Math.min(1, Math.max(0, n));
        params[i][1](real[i] ? c.min + clamped * span : clamped);
      },
      slot: i + 1,
      param: String(poolIds[i]),
    };
  });
}
