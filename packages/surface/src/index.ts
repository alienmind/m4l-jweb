/**
 * @m4l-jweb/surface - declare a device's Live parameters once, as code.
 *
 * A device has TWO surfaces, and they are not competing - they are different
 * projections of the same state:
 *
 *   the Surface (Max)                  the App (Chromium)
 *   real Live parameters               your React UI
 *   automatable, MIDI-mappable         canvas, WebGL, whatever
 *   THE ONLY THING PUSH SEES           the deep editor on the laptop
 *
 * Push cannot see your React UI. Not yours, not anyone's - it reads Live
 * parameters and nothing else. So every musically meaningful control has to
 * exist as a `live.dial` / `live.toggle` / `live.menu` with `parameter_enable`
 * on, which until now meant maintaining the same control in four places: the
 * Max object, the patcher wiring, the app's protocol, and the app's state.
 * Change a range and three of the four silently disagree.
 *
 * This file is the one declaration all four are derived from.
 *
 * STATUS. The Max side is generated: the build imports this declaration and emits
 * the `live.*` objects and their wiring in both directions (`applySurface()` in
 * @m4l-jweb/build). Declaring a parameter here makes a dial appear in Live, and
 * `patcher/devices.mjs` has no `parameters` field any more.
 *
 * The APP side is not generated yet - `useParam()` / `useSurface()` and the
 * generated protocol selectors are Stages 2.2 and 2.3 of doc/TODO.md - so a
 * device still names its parameters in its own `protocol.ts` and sends `set_<id>`
 * through the bridge itself. Push banks are deferred (3.3); until then Live falls
 * back to declaration order, and Push shows every parameter.
 */

/* ------------------------------------------------------------------ *
 * Parameter kinds
 * ------------------------------------------------------------------ */

/**
 * The units Live knows how to print. Anything else is a CUSTOM unit: Live shows
 * the number and appends your string, and a sprintf pattern works too
 * (`"%0.2f Bogons"`).
 *
 * Declaring one is not decoration. With no unit, a float parameter is printed
 * with Max's default unit style, which is INTEGER - so a 0-1 cutoff reads "0" or
 * "1" on a Push while sweeping perfectly smoothly underneath. Say `unit: "Hz"`
 * and the same parameter reads "7.3 kHz".
 */
export type Unit = "Hz" | "dB" | "ms" | "%" | "st" | "pan" | "midi" | (string & {});

export interface DialSpec {
  kind: "dial";
  /**
   * [min, max], IN REAL UNITS. Live needs a bounded range; there is no unbounded
   * parameter.
   *
   * Declare the range the parameter actually has - `[40, 18000]` for a cutoff,
   * not `[0, 1]` with the mapping hidden in a chain. Live's automation lane, Push
   * and your app then all read Hz, and the DSP takes the value directly.
   */
  range: [number, number];
  default: number;
  /** `step: 1` makes it an integer parameter (Max parameter_type 1). */
  step?: number;
  /** What Live prints. Omit only for a bare number. See {@link Unit}. */
  unit?: Unit;
  /**
   * Bend the knob's travel: > 1 gives the BOTTOM of the range more of the sweep.
   *
   * Frequency and time want this, because hearing is logarithmic - a linear sweep
   * of 40 Hz to 18 kHz spends almost all its travel in the top octave, where you
   * cannot hear anything happening, and races through the bottom, where everything
   * does. It changes the mapping of rotation to value, never the value itself.
   */
  exponent?: number;
  /** Quantise the range into N settings. */
  steps?: number;
  /** What the dev harness and the Push preview print under the encoder. */
  format?: (v: number) => string;
  /** Push has ~8 characters per encoder label. Longer names are truncated. */
  short: string;
}

export interface ToggleSpec {
  kind: "toggle";
  default: boolean;
  short: string;
}

export interface MenuSpec<O extends string = string> {
  kind: "menu";
  options: readonly O[];
  default: O;
  short: string;
}

export type ParamSpec = DialSpec | ToggleSpec | MenuSpec;

/** The value type a given parameter carries. `useParam` will be typed by this. */
export type ParamValue<P extends ParamSpec> = P extends DialSpec ? number : P extends ToggleSpec ? boolean : P extends MenuSpec<infer O> ? O : never;

/* ------------------------------------------------------------------ *
 * Windows and State
 * ------------------------------------------------------------------ */

/**
 * A floating window: a SECOND page, in a window of its own.
 *
 * The device view in Live is a fixed ~169 px tall and does not scroll, so a UI
 * that needs room (a pattern editor, a waveform) has nowhere to grow inside it.
 * A declared window compiles to a subpatcher holding its own [jweb], and
 * `useWindow()` opens it.
 *
 * `entry` names the component to bundle, from the device's own folder -
 * `entry: "Window"` is `src/app/<device>/Window.tsx`. It is a separate BUNDLE, so
 * it shares no React state with the device view: two pages, two Chromium
 * contexts, talking only through Max.
 */
export interface WindowSpec {
  kind: "window";
  title: string;
  width: number;
  height: number;
  entry: string;
}

/**
 * A slot of JSON that survives a save - persisted in the LIVE SET, per instance.
 *
 * Not a parameter: Live never looks inside it, it does not automate, and it is not
 * on Push. That is exactly what makes it the right home for the things a parameter
 * cannot hold - a pattern, a preset, a grid of steps.
 */
export interface StateSpec<T = unknown> {
  kind: "state";
  default: T;
}

/** The value type a state slot carries, so `useStateSync` is typed from the declaration. */
export type StateValue<S extends StateSpec> = S extends StateSpec<infer T> ? T : never;

export const window = (spec: Omit<WindowSpec, "kind">): WindowSpec => ({
  kind: "window",
  ...spec,
});

/**
 * The default is the TYPE. `state({ default: { voices: 4 } })` makes the slot
 * `{ voices: number }` everywhere - in `useStateSync`, and in the setter that
 * writes it back - with no type argument to pass and no `as` to remember.
 */
export const state = <T>(spec: Omit<StateSpec<T>, "kind">): StateSpec<T> => ({
  kind: "state",
  ...spec,
});

export const dial = (spec: Omit<DialSpec, "kind">): DialSpec => ({
  kind: "dial",
  ...spec,
});
export const toggle = (spec: Omit<ToggleSpec, "kind">): ToggleSpec => ({
  kind: "toggle",
  ...spec,
});
/**
 * The options are spelled out rather than written as `Omit<MenuSpec<O>, "kind">`,
 * and that is not a style choice: TypeScript cannot infer `O` THROUGH an `Omit`,
 * so it falls back to the constraint and every menu's value type widens to
 * `string`. The whole point of a menu is that `useParam(surface, "rate")` gives
 * you `"off" | "1/4" | ...` and a typo fails the build, so the inference is the
 * feature.
 */
export const menu = <const O extends string>(spec: { options: readonly O[]; default: O; short: string }): MenuSpec<O> => ({
  kind: "menu",
  ...spec,
});

/* ------------------------------------------------------------------ *
 * The surface
 * ------------------------------------------------------------------ */

/** Push renders parameters in banks of eight. A bank is a page. */
export interface Bank<K extends string> {
  name: string;
  /** At most 8 - Push has eight encoders, and a ninth is silently dropped. */
  params: readonly K[];
}

/**
 * Which parameters render as NATIVE `live.*` objects in the device view, and how
 * they are laid out.
 *
 * The compiler ALREADY generates a `live.dial` / `live.toggle` / `live.menu` for
 * every declared parameter; they are invisible today only because they carry no
 * `presentation` attribute, and Live shows the presentation view. Naming a
 * parameter here makes the SAME object visible - a presentation overlay on codegen
 * that already exists, with no wiring change: it is the same parameter, the same
 * fan-out graph, `useParam()` still reads it, now drawn by Max instead of React.
 */
export interface NativeLayout<K extends string = string> {
  /**
   * In display order: fills rows top-to-bottom, then overflows into the next
   * column (column-major, so adding a parameter does not reshuffle the rest).
   */
  params: readonly K[];
  /**
   * Max rows per column. Default 3 - the device view is a fixed ~169 px tall and a
   * `live.dial` needs a 56 px pitch, so only 3 fit vertically.
   */
  rows?: number;
  /**
   * LAYERED "two screens" instead of side-by-side. When true, `[jweb]` is built
   * full-width and the dials OVERLAP its left, and the app flips between them with
   * `useNativePanel` (hide one layer, show the other) - because runtime reposition
   * of native objects does not work in a frozen M4L device, only hide/show does.
   * When false (the default), the dials sit BESIDE a right-shifted `[jweb]`, both
   * visible at once.
   */
  panel?: boolean;
}

/**
 * The declaration. `P`, `S` and `W` are inferred from what you write - they exist so
 * that `useParam`, `useStateSync` and `useWindow` are typed against THIS surface: a
 * parameter, slot or window that is not declared here is a build error at the call
 * site, not a control that silently does nothing.
 */
export interface SurfaceDef<
  P extends Record<string, ParamSpec>,
  S extends Record<string, StateSpec> = Record<string, StateSpec>,
  W extends Record<string, WindowSpec> = Record<string, WindowSpec>,
> {
  params: P;
  banks?: readonly Bank<Extract<keyof P, string>>[];
  windows?: W;
  state?: S;
  /** Which parameters render as native Max objects in the device view. */
  layout?: { native?: NativeLayout<Extract<keyof P, string>> };
}

export interface Surface<
  P extends Record<string, ParamSpec> = Record<string, ParamSpec>,
  S extends Record<string, StateSpec> = Record<string, StateSpec>,
  W extends Record<string, WindowSpec> = Record<string, WindowSpec>,
> extends SurfaceDef<P, S, W> {
  /** Declaration order. This is also the order Push falls back to without banks. */
  readonly ids: readonly Extract<keyof P, string>[];
}

/** Push has eight encoders per page. A ninth parameter in a bank is not an error in Max - it just never appears. */
export const BANK_SIZE = 8;

/**
 * Declare the parameter surface.
 *
 * `banks` may only name parameters that exist - that one is enforced by the
 * type system (`Extract<keyof P, string>`), so a renamed parameter breaks the
 * build at the point of the typo.
 *
 * Bank size, duplicate membership and default-in-range are checked HERE, at
 * call time, and throw. That is not a weaker guarantee than a type: the build
 * imports this module to generate the patcher, so a violation fails `pnpm
 * build` and fails CI. It is only a less pretty error message.
 */
export function defineSurface<
  const P extends Record<string, ParamSpec>,
  const S extends Record<string, StateSpec>,
  const W extends Record<string, WindowSpec>,
>(def: SurfaceDef<P, S, W>): Surface<P, S, W> {
  const ids = Object.keys(def.params) as Extract<keyof P, string>[];

  for (const id of ids) {
    const p = def.params[id];
    if (p.kind === "dial") {
      const [min, max] = p.range;
      if (!(min < max)) throw new Error(`surface: "${id}" has an empty range [${min}, ${max}]`);
      if (p.default < min || p.default > max) {
        throw new Error(`surface: "${id}" default ${p.default} is outside its range [${min}, ${max}]`);
      }
    }
    if (p.kind === "menu") {
      if (!p.options.length) throw new Error(`surface: menu "${id}" has no options`);
      if (!p.options.includes(p.default)) {
        throw new Error(`surface: menu "${id}" default "${p.default}" is not one of its options`);
      }
    }
    // Push truncates rather than errors, so a too-long short name is a silent
    // display bug. Catch it where it is cheap to fix.
    if (p.short.length > BANK_SIZE) {
      throw new Error(`surface: "${id}" short name "${p.short}" is longer than ${BANK_SIZE} chars - Push will truncate it`);
    }
  }

  const seen = new Set<string>();
  for (const bank of def.banks ?? []) {
    if (bank.params.length > BANK_SIZE) {
      throw new Error(`surface: bank "${bank.name}" holds ${bank.params.length} params - Push shows ${BANK_SIZE} per page, the rest never appear`);
    }
    for (const id of bank.params) {
      if (seen.has(id)) throw new Error(`surface: "${id}" appears in more than one bank`);
      seen.add(id);
    }
  }

  // A native layout may only name parameters that exist, and may not ask for more
  // rows than the device view holds. Both throw here, at build time, for the same
  // reason the bank checks do: a typo would otherwise generate a cord from a box
  // that never gets a presentation rect, or overflow a 169 px view silently.
  const native = def.layout?.native;
  if (native) {
    for (const id of native.params) {
      if (!def.params[id]) throw new Error(`surface: layout.native names "${id}", which is not a declared parameter`);
    }
    const rows = native.rows ?? 3;
    if (rows < 1 || rows > 3) throw new Error(`surface: layout.native.rows must be 1..3 - the device view is 169 px tall`);
  }

  return { ...def, ids };
}

/**
 * Does this parameter render as a native Max object? App code uses it to stop
 * drawing an HTML control the device view now owns. Cheap and honest: a parameter
 * that is not in `layout.native` is still an HTML control, so `useParam()` stays
 * the source of truth either way.
 */
export const isNative = (surface: Surface, id: string): boolean => !!surface.layout?.native?.params.includes(id as never);

/**
 * Native object sizes and layout metrics. Shared by the BUILD (the initial static
 * layout, `computeNativeSlots` in @m4l-jweb/build) and the APP (runtime reflow,
 * `computeNativeLayout` below). Keep the two in step - they encode the same grid.
 */
export const NATIVE_METRICS = {
  /** The device view is a fixed ~169 px tall. */
  deviceH: 169,
  margin: 8,
  /** A live.dial is 48 px tall and wants air beneath its label. */
  pitchY: 56,
  /** The web view is built for 420 px and keeps that as its natural width. */
  jwebW: 420,
  /** Per-kind native sizes, from Max's own live.* defaults. */
  size: { dial: [44, 48], toggle: [44, 15], menu: [100, 15] } as Record<string, readonly [number, number]>,
};

/**
 * The scripting name the build gives `[jweb]` when a surface declares native
 * layout, so the app can reposition it at runtime (see `useNativeLayout`).
 */
export const JWEB_VARNAME = "obj-jweb";

/**
 * Column-major layout for a set of native params, computed at RUNTIME so the app
 * can REFLOW the visible dials as the state changes - packing them top-left with no
 * gaps where a hidden dial used to be. Mirrors the build's `computeNativeSlots`, but
 * over an arbitrary `visible` subset rather than every declared param.
 *
 * Returns each id's `[x, y, w, h]` presentation rect and the zone's total width
 * (how far `[jweb]` starts from the left).
 */
export function computeNativeLayout(
  surface: { params: Record<string, ParamSpec>; layout?: { native?: NativeLayout } },
  visible: readonly string[],
  rows: number = surface.layout?.native?.rows ?? 3,
): { rects: Record<string, [number, number, number, number]>; width: number } {
  const { margin, pitchY, size } = NATIVE_METRICS;
  const rects: Record<string, [number, number, number, number]> = {};
  let row = 0;
  let colW = 0;
  let x = margin;
  for (const id of visible) {
    const [w, h] = size[surface.params[id].kind];
    if (row >= rows) {
      row = 0;
      x += colW + margin;
      colW = 0;
    }
    rects[id] = [x, margin + row * pitchY, w, h];
    colW = Math.max(colW, w);
    row += 1;
  }
  return { rects, width: visible.length ? x + colW + margin : 0 };
}

/** The default value of every parameter. The app's initial state, before Live replies. */
export function defaults<P extends Record<string, ParamSpec>>(surface: Surface<P>): { [K in keyof P]: ParamValue<P[K]> } {
  const out = {} as { [K in keyof P]: ParamValue<P[K]> };
  for (const id of surface.ids) out[id] = surface.params[id].default as ParamValue<P[typeof id]>;
  return out;
}

/** How a value is displayed - the parameter's own `format`, or a sane default. */
export function formatValue(spec: ParamSpec, value: unknown): string {
  if (spec.kind === "toggle") return value ? "on" : "off";
  if (spec.kind === "menu") return String(value);
  if (spec.format) return spec.format(Number(value));
  const n = Number(value);
  const text = spec.step === 1 ? String(Math.round(n)) : n.toFixed(2);
  return spec.unit ? `${text}${spec.unit}` : text;
}
