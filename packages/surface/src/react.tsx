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
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { outlet } from "@m4l-jweb/bridge";
import type { ParamSpec, ParamValue, StateSpec, StateValue, Surface, WindowSpec } from "./index";
import { paramStore, stateStore } from "./store";

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
