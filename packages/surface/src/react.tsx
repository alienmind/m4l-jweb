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
import { JWEB_VARNAME } from "./index";
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
export function useNativePanel<P extends Record<string, ParamSpec>>(
  surface: Surface<P>,
): (mode: "web" | "native") => void {
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
