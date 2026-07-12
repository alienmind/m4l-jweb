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
 * STATUS - read this before you reach for it. Shipped today (Stage 0.3 of
 * doc/TODO.md): the declaration, its types, and its validation. NOT shipped:
 * the codegen that turns it into Max objects and wiring (Stage 2). So a Surface
 * currently type-checks, validates, and drives the dev harness - but the
 * parameters Live actually sees still come from `parameters` in
 * `patcher/devices.mjs`. Declaring one does not yet make a dial appear in Live.
 * Keep the two in step by hand until Stage 2 lands and deletes the manifest field.
 */

/* ------------------------------------------------------------------ *
 * Parameter kinds
 * ------------------------------------------------------------------ */

export interface DialSpec {
  kind: "dial";
  /** [min, max]. Live needs a bounded range; there is no unbounded parameter. */
  range: [number, number];
  default: number;
  /** `step: 1` makes it an integer parameter (Max parameter_type 1). */
  step?: number;
  unit?: string;
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
export const menu = <O extends string>(spec: Omit<MenuSpec<O>, "kind">): MenuSpec<O> => ({ kind: "menu", ...spec });

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
