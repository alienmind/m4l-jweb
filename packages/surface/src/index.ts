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

export interface SurfaceDef<P extends Record<string, ParamSpec>> {
  params: P;
  banks?: readonly Bank<Extract<keyof P, string>>[];
}

export interface Surface<P extends Record<string, ParamSpec> = Record<string, ParamSpec>> extends SurfaceDef<P> {
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
export function defineSurface<const P extends Record<string, ParamSpec>>(def: SurfaceDef<P>): Surface<P> {
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

  return { ...def, ids };
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
