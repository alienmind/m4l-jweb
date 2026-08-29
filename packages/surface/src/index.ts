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
 * The APP side is generated too now: `useParam()` / `useSurface()` read a declared
 * parameter in React (@m4l-jweb/surface/react) and the selectors come from the
 * declaration, so a device does not retype `set_<id>` in its own `protocol.ts`. Push
 * banks ship as well - a surface that declares none falls back to declaration order,
 * and Push shows every parameter.
 */

import { FOCUS_OPTIONS, type Controls, type FocusPolicy } from "./controls";

/**
 * The CONTROL SURFACE declaration lives in its own file and is re-exported here, so
 * a device imports `defineSurface` and `defineControls` from one place. See
 * controls.ts - the hardware behaviour it is shaped around is measured, and five
 * parts of it contradict the obvious guess.
 */
export * from "./controls";

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

/**
 * A LABELLED toggle button - a `live.text` in toggle mode, which a bare
 * `live.toggle` cannot be: it carries visible text. The on/off value is the same as
 * a toggle; `label` is what the button reads. Handy as a native view switch (a
 * "Back" button) where the plain orange square of a toggle says nothing.
 */
export interface ButtonSpec {
  kind: "button";
  default: boolean;
  /** The text on the button. */
  label: string;
  short: string;
}

export type ParamSpec = DialSpec | ToggleSpec | MenuSpec | ButtonSpec;

/** The value type a given parameter carries. `useParam` will be typed by this. */
export type ParamValue<P extends ParamSpec> = P extends DialSpec
  ? number
  : P extends ToggleSpec
    ? boolean
    : P extends ButtonSpec
      ? boolean
      : P extends MenuSpec<infer O>
        ? O
        : never;

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
  /**
   * The component to bundle, from the device's own folder. Mutually exclusive
   * with `site`: a window's content is either one of our components or a
   * prebuilt directory, never both.
   */
  entry?: string;
  /**
   * The window's page is a SOUND SOURCE.
   *
   * It compiles to `[jweb~]` instead of `[jweb]`, and the page's L/R signal
   * outlets leave the subpatcher on a pair of `[outlet]`s and are summed into the
   * device's audio path at the same `[+~]` stage shape the `webaudio` chain uses.
   * The device must therefore be an `audio` or `instrument` device; a MIDI device
   * has no signal path and the build says so.
   *
   * A window that makes sound cannot wait to be opened before it loads: the page
   * is pulsed open-then-closed once at device load (`loadbang`), so its
   * AudioContext exists whether or not anyone ever looks at the window.
   *
   * The plain `[jweb]` window is untouched by this - `audio` ADDS a second
   * primitive rather than changing the first.
   */
  audio?: boolean;
  /**
   * Output latency of the sounding window's `[jweb~]`, in milliseconds - the ring
   * buffer between Chromium's audio thread and MSP. Max 9 documents 0 as the
   * minimum (~23 ms at 44.1kHz, ~21 ms at 48kHz), warns that the minimum "may
   * result in occasional drop-outs or distortion", and caps the maximum at three
   * times the minimum. Unset leaves the object's own default.
   *
   * Only meaningful with `audio: true`; ignored otherwise.
   */
  latency?: number;
  /**
   * The `rendermode` attribute stamped on the window's jweb object:
   * 0 = onscreen, 1 = offscreen. The Max reference notes offscreen "is slower".
   * Default is 1, which is what every generated window has shipped with so far.
   */
  rendermode?: 0 | 1;
  /**
   * Report interval of the window's level tap (`[peakamp~ N]`), in milliseconds.
   * Default 10, which is 100 float messages per second per channel into the
   * wrapper's [js]. Raise it to trade meter smoothness for message traffic.
   *
   * Only meaningful with `audio: true`; ignored otherwise.
   */
  levelInterval?: number;
  /**
   * Window content from a PREBUILT static directory rather than a component of
   * ours - a whole site, built by something else (its own Astro/vite build), and
   * delivered as a folder next to the `.amxd` instead of base64 inside it.
   *
   * The path is relative to the device repo root and must contain `index.html`.
   * Mutually exclusive with `entry`.
   */
  site?: string;
  /**
   * Keep the window in FRONT of Live, instead of behind it the moment Live is clicked.
   *
   * For a window you read WHILE working in Live - a reference, a cheatsheet - the
   * default behaviour makes it useless: clicking back into the device to type is
   * exactly what sends the window behind the main window. For a window you work IN (an
   * editor), the default is right and this should stay off.
   *
   * It compiles to `[thispatcher]` <- `window flags ... float, window exec`, which is
   * Max's documented route. **The flag list is a REPLACEMENT, not an addition** - that
   * is why the generated message names `grow`, `close` and `title` alongside `float`.
   * Send `float` alone and the window comes up with no close box.
   */
  alwaysOnTop?: boolean;
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

/**
 * A POOL of interchangeable native dials, for a device whose real controls are not
 * known until it runs.
 *
 * A `live.dial` is stamped into the frozen `.amxd` at build time, so a device cannot
 * grow one when the user's code asks for a control. What it can do is reserve a
 * fixed number of them and lend them out - `slider()` calls in a pattern, the
 * parameters of whatever effect was just loaded - and that borrowing is the same
 * problem in every device that has it.
 *
 *   params: { ...knobPool(8) }        // s1..s8, all 0..1
 *
 * The dials are declared 0..1 because a borrower's real range is not known here.
 * `useControls()` in ./react then hands them out in order, tells Live what each one
 * currently IS (name, unit, range - see describeParam in @m4l-jweb/bridge), and
 * keeps the scaling straight.
 */
/** 0 .. N-1 as a union. The recursion is bounded by the count the caller wrote. */
type UpTo<N extends number, Acc extends number[] = []> = Acc["length"] extends N ? Acc[number] : UpTo<N, [...Acc, Acc["length"]]>;

/**
 * The dials are numbered from 1, and TypeScript cannot add. A lookup tuple is the
 * whole trick: index 0 holds 1, index 7 holds 8. It stops at 32, which is four Push
 * banks - past that `knobPool` still WORKS, its keys just widen back to `string` and
 * `useParam(surface, "s33")` stops being checked.
 */
type OneBased = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
  17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32,
];

/** `PoolIds<8>` is `"s1" | ... | "s8"`. */
export type PoolIds<N extends number, P extends string = "s"> = `${P}${OneBased[UpTo<N>] & number}`;

/**
 * The KEYS are the point, not just the values. `params: { ...knobPool(8) }` has to
 * leave `keyof P` carrying `s1`..`s8`, or the spread widens the surface to an index
 * signature and every downstream `useParam(surface, "s3")` and `layout.native.params`
 * entry stops type-checking against the declaration it came from.
 */
export const knobPool = <N extends number, P extends string = "s">(
  count: N,
  prefix: P = "s" as P,
): Record<PoolIds<N, P>, DialSpec> => {
  const out: Record<string, DialSpec> = {};
  for (let i = 1; i <= count; i++) {
    // The short name is what Push prints when nothing has borrowed the slot yet.
    out[`${prefix}${i}`] = dial({ range: [0, 1], default: 0, short: `${prefix.toUpperCase()}${i}` });
  }
  return out as Record<PoolIds<N, P>, DialSpec>;
};
export const toggle = (spec: Omit<ToggleSpec, "kind">): ToggleSpec => ({
  kind: "toggle",
  ...spec,
});
/** A labelled toggle button (`live.text`). Same on/off value as a toggle, with visible text. */
export const button = (spec: Omit<ButtonSpec, "kind">): ButtonSpec => ({
  kind: "button",
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
   * How the controls are arranged. Default 3.
   *
   * A NUMBER is rows per column, filled column-major: three down, then the next
   * column. Adding a parameter never reshuffles the ones before it.
   *
   * AN ARRAY is the size of each row, filled left to right - `[1, 4, 4]` puts one
   * control on the first row and four on each of the next two. Column-major cannot
   * express that, and it is what a panel usually wants to say: a transport button
   * ABOVE two banks of dials, rather than interleaved with them.
   *
   * Either way the device view is a fixed ~169 px tall and a `live.dial` needs a
   * 56 px pitch, so three rows is the ceiling.
   */
  rows?: number | number[];
  /**
   * LAYERED "two screens" instead of side-by-side. When true, `[jweb]` is built
   * full-width and the dials OVERLAP its left, and the app flips between them with
   * `useNativePanel` (hide one layer, show the other) - because runtime reposition
   * of native objects does not work in a frozen M4L device, only hide/show does.
   * When false (the default), the dials sit BESIDE a right-shifted `[jweb]`, both
   * visible at once.
   */
  panel?: boolean;
  /**
   * A parameter that is the VIEW SWITCH, not a grid dial: pinned to the top-right
   * (over the web UI's own switch button, so the control stays in one place across
   * both views), kept out of the `params` grid, and shown in both modes. Meant for a
   * toggle in a `panel` layout - the way back from the native panel, since the web
   * UI is hidden there.
   */
  switch?: K;
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
  /**
   * What this device claims on the CONTROL SURFACE - `defineControls()`.
   *
   * It lives on the Surface rather than beside it because it CONTRIBUTES two real
   * Live parameters (`takeover`, `focus`): the user must be able to switch a
   * takeover off, automate it and see it on Push, and the only thing Push sees is a
   * Live parameter. So the declaration that claims the pads and the declaration that
   * generates the dials are one declaration, and the two parameters are typed into
   * this surface exactly as if they had been written out by hand.
   */
  controls?: Controls;
}

export interface Surface<
  P extends Record<string, ParamSpec> = Record<string, ParamSpec>,
  S extends Record<string, StateSpec> = Record<string, StateSpec>,
  W extends Record<string, WindowSpec> = Record<string, WindowSpec>,
> extends SurfaceDef<P, S, W> {
  /** Declaration order. This is also the order Push falls back to without banks. */
  readonly ids: readonly Extract<keyof P, string>[];
}

/**
 * The two parameters `defineControls()` adds to the Surface that carries it.
 *
 * `takeover` is off by default and `focus` decides WHEN an enabled device actually
 * holds what it declared - see controls.ts. They are spelled out as a type so that
 * `useParam(surface, "takeover")` is typed like any other declared parameter, with
 * nothing to cast and nothing to remember.
 */
export interface ControlParams {
  takeover: ToggleSpec;
  focus: MenuSpec<FocusPolicy>;
}

/**
 * `P` with the takeover pair folded in, FLATTENED.
 *
 * A plain `P & ControlParams` is an intersection, and an intersection of two object
 * types has no index signature even when both halves would satisfy one - so
 * `useParam(surface, ...)` fails to infer `P extends Record<string, ParamSpec>` and
 * the device sees a wall of "index signature is missing". Mapping over the keys
 * produces an ordinary object type again, which infers exactly as a hand-written
 * params block does.
 */
export type WithControlParams<P extends Record<string, ParamSpec>> = {
  [K in keyof (P & ControlParams)]: (P & ControlParams)[K];
};

/** The two parameter specs themselves, so the build and the app agree on one object. */
export function controlParams(controls: Controls): ControlParams {
  return {
    takeover: toggle({ default: false, short: "Takeovr" }),
    focus: menu({ options: FOCUS_OPTIONS, default: controls.defaultFocus, short: "Focus" }),
  } as ControlParams;
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
>(def: SurfaceDef<P, S, W> & { controls: Controls }): Surface<WithControlParams<P>, S, W>;
export function defineSurface<
  const P extends Record<string, ParamSpec>,
  const S extends Record<string, StateSpec>,
  const W extends Record<string, WindowSpec>,
>(def: SurfaceDef<P, S, W>): Surface<P, S, W>;
export function defineSurface<
  const P extends Record<string, ParamSpec>,
  const S extends Record<string, StateSpec>,
  const W extends Record<string, WindowSpec>,
>(def: SurfaceDef<P, S, W>): Surface<P, S, W> {
  // A declared takeover contributes two REAL Live parameters, and it does so HERE
  // rather than in the build: they have to be in `ids` for the codegen to emit the
  // objects, in `banks` for Push to page them, and in the app's store for
  // `useParam(surface, "takeover")` to work. One merge, before every check below
  // runs, so the generated pair is validated exactly like a hand-written one.
  if (def.controls) def = mergeControlParams(def);

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

  // A window holds EITHER a component of ours or a prebuilt site. Both is
  // ambiguous (which one loads?) and neither is an empty window - and both would
  // otherwise fail deep in the build, as a vite entry that does not resolve or a
  // page that never gets a url.
  for (const [id, w] of Object.entries(def.windows ?? {})) {
    if (w.entry && w.site) {
      throw new Error(`surface: window "${id}" declares both entry "${w.entry}" and site "${w.site}" - a window holds one or the other`);
    }
    if (!w.entry && !w.site) {
      throw new Error(`surface: window "${id}" declares neither entry nor site - it would open empty`);
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
    if (Array.isArray(rows)) {
      if (rows.length > 3) throw new Error(`surface: layout.native.rows has ${rows.length} rows - the device view is 169 px tall and holds 3`);
      if (rows.some((n) => !(n > 0))) throw new Error(`surface: layout.native.rows must be positive counts, e.g. [1, 4, 4]`);
    } else if (rows < 1 || rows > 3) {
      throw new Error(`surface: layout.native.rows must be 1..3 - the device view is 169 px tall`);
    }
    if (native.switch !== undefined && !def.params[native.switch]) {
      throw new Error(`surface: layout.native.switch names "${native.switch}", which is not a declared parameter`);
    }
  }

  return { ...def, ids };
}

/**
 * Fold `defineControls()`'s two parameters into the declaration.
 *
 * THE BANK MATTERS AS MUCH AS THE PARAMETER. Push shows a device eight encoders per
 * page and nothing else, so a `takeover` toggle that exists but is in no bank is a
 * switch the user can only reach by opening the device view - which is the one place
 * a Push user is not looking. A surface that declares banks therefore gets the pair
 * appended to the first page with room, and a page of its own only if every declared
 * bank is full.
 *
 * A surface with NO banks is left alone: Live falls back to declaration order, and
 * the two land at the end of it either way.
 */
function mergeControlParams<
  P extends Record<string, ParamSpec>,
  S extends Record<string, StateSpec>,
  W extends Record<string, WindowSpec>,
>(def: SurfaceDef<P, S, W>): SurfaceDef<P, S, W> {
  const extra = controlParams(def.controls!) as unknown as P;
  for (const id of Object.keys(extra)) {
    if (def.params[id]) {
      throw new Error(
        `surface: "${id}" is generated by defineControls() - remove it from params, or the takeover would have two dials and one name`,
      );
    }
  }

  const params = { ...def.params, ...extra };
  if (!def.banks?.length) return { ...def, params };

  const ids = Object.keys(extra) as Extract<keyof P, string>[];
  const banks = def.banks.map((b) => ({ name: b.name, params: [...b.params] as Extract<keyof P, string>[] }));
  for (const id of ids) {
    const room = banks.find((b) => b.params.length < BANK_SIZE);
    if (room) room.params.push(id);
    else banks.push({ name: "Takeover", params: [id] });
  }
  return { ...def, params, banks };
}

/**
 * Does this parameter render as a native Max object? App code uses it to stop
 * drawing an HTML control the device view now owns. Cheap and honest: a parameter
 * that is not in `layout.native` is still an HTML control, so `useParam()` stays
 * the source of truth either way.
 */
export const isNative = (surface: Surface, id: string): boolean => !!surface.layout?.native?.params.includes(id as never);

/**
 * The scripting name the build gives `[jweb]` when a surface declares native
 * layout, so the app can hide/show it at runtime (see `useNativePanel`).
 */
export const JWEB_VARNAME = "obj-jweb";

/** The default value of every parameter. The app's initial state, before Live replies. */
export function defaults<P extends Record<string, ParamSpec>>(surface: Surface<P>): { [K in keyof P]: ParamValue<P[K]> } {
  const out = {} as { [K in keyof P]: ParamValue<P[K]> };
  for (const id of surface.ids) out[id] = surface.params[id].default as ParamValue<P[typeof id]>;
  return out;
}

/* ------------------------------------------------------------------ *
 * defineWatch - declare what to OBSERVE in Live, once, as code.
 *
 * The twin of defineSurface, and it exists to kill hard rule 4 BY CONSTRUCTION.
 * A LiveAPI observer built during `loadbang` is dead forever; the only safe place
 * to create one is `live.thisdevice`'s bang. That is a trap a hand-written
 * observer falls into silently - the object constructs without error and then
 * notifies nothing. So no device writes the observer at all: it DECLARES the LOM
 * path and property, the build injects the list as data, and the packaged wrapper
 * creates every observer from bang() (see setupWatches in @m4l-jweb/wrapper). The
 * one place LiveAPI is safe is the one place the observers are made.
 *
 * Each change reaches the UI as `watch_<key> <value...>`, exactly as a parameter
 * reaches it as `<id> <value>` - one declaration, one name, both sides. `useWatch`
 * binds it; the app never types the selector.
 *
 * This is READ-ONLY: an observed property flows Live -> UI and nowhere back. A
 * value the app can also WRITE is a parameter (`defineSurface`), not a watch.
 * ------------------------------------------------------------------ */

/** One observed Live property. `T` is the value the app sees, so `useWatch` is typed from it. */
export interface WatchSpec<T = unknown> {
  /** The LOM object path, e.g. `"live_set"` or `"live_set view selected_track"`. */
  path: string;
  /** An OBSERVABLE property on that object, e.g. `"tempo"`, `"scale_name"`, `"is_playing"`. */
  property: string;
  /** What the app shows before Live has replied - the same role a parameter's `default` plays. */
  default: T;
}

/** The value type a watch carries. `useWatch` is typed by this. */
export type WatchValue<S extends WatchSpec> = S extends WatchSpec<infer T> ? T : never;

/**
 * Declare one watch. `watch<string>({ path: "live_set", property: "scale_name", default: "C" })`
 * carries the value type through, so `useWatch(w, "scale")` is `string` with nothing to cast.
 */
export const watch = <T>(spec: WatchSpec<T>): WatchSpec<T> => ({ ...spec });

export interface WatchDef<W extends Record<string, WatchSpec>> {
  watches: W;
}

export interface Watch<W extends Record<string, WatchSpec> = Record<string, WatchSpec>> extends WatchDef<W> {
  /** Declaration order - the order the build emits WATCH_SPECS and the wrapper attaches observers. */
  readonly keys: readonly Extract<keyof W, string>[];
}

/**
 * Declare the watch surface.
 *
 * Like defineSurface, the checks run HERE, at call time, and throw - the build
 * imports this module to emit the observer list, so a bad declaration fails
 * `pnpm build` and CI. A key becomes the selector suffix `watch_<key>`, so it may
 * not carry whitespace (Max would split the message on it); a path or property
 * left blank would attach an observer to nothing, silently, which is the exact
 * failure this API exists to prevent.
 */
export function defineWatch<const W extends Record<string, WatchSpec>>(def: WatchDef<W>): Watch<W> {
  const keys = Object.keys(def.watches) as Extract<keyof W, string>[];
  for (const key of keys) {
    if (/\s/.test(key)) throw new Error(`watch: key "${key}" has whitespace - it becomes the selector watch_${key}, which Max would split`);
    const w = def.watches[key];
    if (!w.path) throw new Error(`watch: "${key}" has no path - an observer with no LOM object attaches to nothing`);
    if (!w.property) throw new Error(`watch: "${key}" has no property - an observer with no property notifies nothing`);
  }
  return { ...def, keys };
}

/* ------------------------------------------------------------------ *
 * defineFiles - declare that a device touches DISK, once, as code.
 *
 * The third sibling of defineSurface and defineWatch, and the one reality asked
 * for. Writing a file is not one feature, it is three that must travel together:
 *
 *   the `download` chain   it owns [maxurl], and phase three of saveToFile is a
 *                          `file://` place through it - even for a device that
 *                          downloads nothing and only writes bytes it already has;
 *   the device folder      where the files went, which the page cannot know and
 *                          the wrapper has to tell it (`device_folder`);
 *   the selectors          `fetch_to_file`, the `save_*` exchange.
 *
 * Get the first one wrong and the failure is SILENT: the bytes are written
 * correctly, the place request leaves on an aux outlet with nothing on the other
 * end, no reply ever comes, and the promise never settles. The UI sits on
 * "Rendering..." next to a scratch file that looks almost right. Nothing in the
 * build or the tests could see it, because nothing knew the device meant to write.
 *
 * Now it does. A device that declares files gets [maxurl] whether or not its
 * manifest remembered to ask, and gets told its own folder; a device that declares
 * none gets neither.
 *
 * NO SUBFOLDER OPTION, deliberately. A save's destination must be a FLAT name in
 * the device folder: Max's [js] File and maxurl (libcurl) resolve a subdirectory
 * differently, so `sub/x.wav` writes the .part where File agrees and the place
 * cannot reach it (see saveToFile in @m4l-jweb/wrapper). An option for a path that
 * does not work is worse than no option.
 * ------------------------------------------------------------------ */

export interface FilesDef {
  /**
   * The page holds the bytes and writes them next to the .amxd - a rendered WAV,
   * an export, a bounce. `saveToFile()` in @m4l-jweb/bridge.
   */
  saves?: boolean;
  /**
   * The page hands Max a URL and Max streams it to disk on its own thread, with
   * nothing crossing the message bridge. `fetchToFile()` in @m4l-jweb/bridge.
   */
  fetches?: boolean;
  /**
   * Tell the page where its files land, at ui_ready (`device_folder <path>`).
   * On by default: a file the user cannot find is a file that was not written, and
   * the page has no other way to learn its own device's folder. Turn it off for a
   * device whose files are its own business - a cache it fills and reads back.
   */
  tellPage?: boolean;
}

export interface Files extends FilesDef {
  readonly saves: boolean;
  readonly fetches: boolean;
  readonly tellPage: boolean;
}

/**
 * Declare what this device does with disk.
 *
 * Like defineSurface and defineWatch, the checks run HERE, at call time, and
 * throw - the build imports this module to derive the chain and the banner, so a
 * bad declaration fails `pnpm build` and CI.
 */
export function defineFiles(def: FilesDef): Files {
  const saves = def.saves ?? false;
  const fetches = def.fetches ?? false;
  // A declaration that claims neither would still pull in [maxurl] and still tell
  // the page a folder, for a device that touches no disk at all. That is not a
  // harmless default, it is a device carrying a chain nobody can explain.
  if (!saves && !fetches) {
    throw new Error(`files: declare at least one of saves / fetches - a device that does neither should not declare files at all`);
  }
  return { saves, fetches, tellPage: def.tellPage ?? true };
}

/** How a value is displayed - the parameter's own `format`, or a sane default. */
export function formatValue(spec: ParamSpec, value: unknown): string {
  if (spec.kind === "toggle" || spec.kind === "button") return value ? "on" : "off";
  if (spec.kind === "menu") return String(value);
  if (spec.format) return spec.format(Number(value));
  const n = Number(value);
  const text = spec.step === 1 ? String(Math.round(n)) : n.toFixed(2);
  return spec.unit ? `${text}${spec.unit}` : text;
}
