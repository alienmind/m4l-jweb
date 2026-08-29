/**
 * controls.ts - declare what a device claims on the CONTROL SURFACE, once, as code.
 *
 * The fourth sibling of `defineSurface`, `defineWatch` and `defineFiles`, and the
 * one that reaches the sixty-four pads. `defineSurface` already gives a device the
 * eight Push encoders - declare a parameter and it is on the hardware, labelled,
 * banked, automatable. It gives you nothing on the grid, and this closes that:
 *
 *   grid.draw()   a frame buffer you paint
 *   grid.onPad()  an event stream you handle
 *
 * ------------------------------------------------------------------------------
 * WHAT THE HARDWARE ACTUALLY DOES, because five of these contradict the obvious
 * guess and every one of them fails silently. All measured on a Push 3 with the
 * `push-probe` device; the evidence is doc/MAX-FACTS.md, "Grabbing a Push control".
 *
 *  1. A control is grabbed BY NAME. A bare LOM id is rejected; the two-atom
 *     `id <n>` works and buys nothing over the name. The id is wanted for exactly
 *     one thing - building the observer.
 *  2. A REJECTED CALL REPORTS NOTHING. `LiveAPI.call` does not throw when Live
 *     refuses it: it posts a console line and returns normally. There is no success
 *     to branch on, so nothing here can verify its own grab. `controls_role` reports
 *     the one failure that IS visible - a role this hardware does not have.
 *  3. Y COUNTS FROM THE TOP on the wire and from the BOTTOM in this API, and the
 *     flip lives in ONE place (`usePadGrid`). Get it wrong anywhere else and every
 *     device on the grid is mirrored, with nothing to report it.
 *  4. THE FIRST FRAME AFTER A GRAB IS LOST. Live's own surface script repaints the
 *     matrix just after handing it over, so the wrapper defers its first paint and
 *     treats the hardware as unknown until then.
 *  5. ROLES RESOLVE AT RUNTIME. A Push 3 answers `get_control_names` with 176 names
 *     and they are not the Push 2 set, so the role table below is CANDIDATES, tried
 *     in order against that answer. A candidate that is not on the connected
 *     hardware is never called - which is what turns rule 2's silence into a
 *     reportable `controls_role <key> 0`.
 *  6. THE ENCODERS ARE GRABBABLE, and grabbing one takes it: with `Track_Controls`
 *     held, the dials stop moving their parameters entirely. That costs automation,
 *     MIDI mapping and the automation lane - everything the parameter path exists
 *     for - so those roles are REFUSED here, at declaration time.
 *  7. CLAIMING THE MATRIX TAKES THE PADS OFF THE NOTE PATH. No MIDI notes and no
 *     MPE while `Button_Matrix` is held, even on a device that declares `mpe`.
 *     Claiming a non-matrix control (the scene column, the jog wheel) costs nothing
 *     on the note path, which is why a mixed declaration is allowed rather than
 *     refused.
 *  8. A CONTROL IS NOT ALWAYS A GRID OR A BUTTON. A jog wheel is a STREAM, so there
 *     is a third shape here rather than a fourth one bolted on later.
 * ------------------------------------------------------------------------------
 *
 * Like its three siblings the checks run HERE, at call time, and throw - the build
 * imports this declaration to emit the chain and the wrapper's spec, so a bad
 * declaration fails `pnpm build` and CI rather than the hardware going quiet.
 */

/* ------------------------------------------------------------------ *
 * The roles, and the names they resolve to
 * ------------------------------------------------------------------ */

/**
 * The role vocabulary. A device names a ROLE, never a Max name: the name is a
 * per-generation fact the library owns, and CLAUDE.md's first hard rule is that a
 * name Max looks up and does not recognise is not an error - it is a feature that
 * silently does nothing.
 */
export type ControlRole =
  // Grids
  | "matrix"
  | "scene_launch"
  | "track_state"
  // Buttons
  | "shift"
  | "select"
  | "delete"
  | "duplicate"
  | "new"
  | "undo"
  | "capture"
  | "record"
  | "play"
  | "loop"
  | "left"
  | "right"
  | "up"
  | "down"
  | "octave_up"
  | "octave_down"
  | "layout"
  | "note_mode"
  | "session_mode"
  // Streams
  | "jogwheel"
  | "touch_strip";

/**
 * Role -> the control names to TRY, in order, on whatever is plugged in.
 *
 * Two sources, and neither is complete: the 176 names a Push 3 returned from
 * `get_control_names`, and the names a shipping third-party takeover device
 * addresses (a Push 2-era set - several of them do not exist on a Push 3, which has
 * `Left_Arrow`/`Right_Arrow` and `Layout` where the older set has `Left_Button`,
 * `Right_Button` and `Layout_Button`). Both are in doc/MAX-FACTS.md.
 *
 * A candidate is only ever used if it appears in the connected hardware's own
 * `get_control_names` answer, so a wrong guess here costs a `controls_role <key> 0`
 * and not a silent no-op. That is the whole reason resolution is a runtime list
 * rather than a compile-time name.
 */
export const ROLE_NAMES: Record<ControlRole, readonly string[]> = {
  matrix: ["Button_Matrix"],
  scene_launch: ["Scene_Launch_Buttons"],
  track_state: ["Track_State_Buttons"],
  shift: ["Shift_Button"],
  select: ["Select_Button"],
  delete: ["Delete_Button"],
  duplicate: ["Duplicate_Button"],
  new: ["New_Button"],
  undo: ["Undo_Button"],
  capture: ["Capture_Button"],
  record: ["Record_Button"],
  play: ["Play_Button"],
  loop: ["Loop_Button"],
  left: ["Left_Arrow", "Left_Button"],
  right: ["Right_Arrow", "Right_Button"],
  up: ["Up_Arrow", "Up_Button"],
  down: ["Down_Arrow", "Down_Button"],
  octave_up: ["Octave_Up_Button"],
  octave_down: ["Octave_Down_Button"],
  layout: ["Layout", "Layout_Button"],
  note_mode: ["Note_Mode_Button"],
  session_mode: ["Session_Mode_Button"],
  jogwheel: ["Jogwheel"],
  touch_strip: ["Touch_Strip_Control"],
};

/**
 * The roles a declaration may NOT claim, and why - the message is what the author
 * reads, so it says what grabbing one costs rather than "not allowed".
 *
 * They are perfectly grabbable. That is the problem: measured, with two dials
 * declared so Push had something to map, the encoders moved their parameters
 * normally and stopped dead the moment `Track_Controls` was grabbed.
 */
export const REFUSED_ROLES: Record<string, string> = {
  Track_Controls:
    "the eight encoders are grabbable, and grabbing them TAKES them: the dials stop moving their parameters, " +
    "which costs automation, MIDI mapping and the automation lane. Declare the values as parameters in surface.ts instead.",
  Global_Param_Controls: "same as Track_Controls - an encoder belongs to the parameter path, not to a takeover.",
};

/** Which roles are grids, and the dimensions each one is. */
const GRID_SHAPE: Partial<Record<ControlRole, { rows: number; cols: number }>> = {
  // The only one measured: 8x8, y from the top, one control and one id - not 64.
  matrix: { rows: 8, cols: 8 },
  // UNMEASURED SHAPES. Both resolve on a Push 3 and both are grabbable (the scene
  // column was grabbed and released during the spike, and the MPE stream survived
  // it), but what their `value` carries and what `send_value` wants have not been
  // read off the hardware. Declaring one is allowed and reports its resolution;
  // trusting its payload without looking is not.
  scene_launch: { rows: 8, cols: 1 },
  track_state: { rows: 1, cols: 8 },
};

/** The roles that are a single button. */
const BUTTON_ROLES: ControlRole[] = [
  "shift",
  "select",
  "delete",
  "duplicate",
  "new",
  "undo",
  "capture",
  "record",
  "play",
  "loop",
  "left",
  "right",
  "up",
  "down",
  "octave_up",
  "octave_down",
  "layout",
  "note_mode",
  "session_mode",
];

/** The roles that are a continuous stream rather than a gate. */
const STREAM_ROLES: ControlRole[] = ["jogwheel", "touch_strip"];

/* ------------------------------------------------------------------ *
 * The control kinds
 * ------------------------------------------------------------------ */

/**
 * What every control kind carries.
 *
 * `names` is FILLED IN BY `defineControls()`, from ROLE_NAMES above - it is not
 * something a device writes. The build reads the declaration as plain data (it
 * cannot call back into this module: `packages/build` is .mjs and this is the
 * bundled TypeScript it imported), so the candidate list has to travel ON the
 * declaration rather than be looked up again on the other side. Two lookups of one
 * table is exactly how a role table drifts.
 */
export interface ControlBase {
  role: ControlRole;
  /** The control names to try, in order. Written by defineControls; do not set it. */
  names?: readonly string[];
}

/** A rectangle of pads you paint and read. */
export interface GridControlSpec extends ControlBase {
  kind: "grid";
  rows: number;
  cols: number;
}

/** One button: a boolean, live. The degenerate case of a grid. */
export interface ButtonControlSpec extends ControlBase {
  kind: "button";
}

/**
 * A continuous control - the jog wheel, the touch strip.
 *
 * NOTHING HERE IS MEASURED YET. Whether either emits a usable stream under a grab,
 * and whether the jog wheel reports a DELTA or an absolute position, is doc/TODO.md
 * item 2a - one button press in `push-probe`, and it gates the DJ surface in
 * PUSH-USECASES.md. The shape exists so that answering the question does not force
 * an API change; it does not claim the answer.
 */
export interface StreamControlSpec extends ControlBase {
  kind: "stream";
}

export type ControlSpec = GridControlSpec | ButtonControlSpec | StreamControlSpec;

/**
 * A rectangle of pads. `rows` and `cols` are stated by the caller and checked
 * against the role, rather than defaulted from it: a device that writes
 * `rows: 8, cols: 8` is a device whose layout code you can read without knowing the
 * role table.
 */
export const grid = (spec: { role: ControlRole; rows: number; cols: number }): GridControlSpec => ({ kind: "grid", ...spec });

/**
 * One button.
 *
 * NOT `button()` - that name already belongs to `defineSurface`'s `live.text`
 * parameter, and a device declaring both would import two different things called
 * the same word. PUSH-USECASES.md writes `button({ role: "shift" })`; this is that,
 * renamed for the collision.
 */
export const padButton = (spec: { role: ControlRole }): ButtonControlSpec => ({ kind: "button", ...spec });

/** One continuous control. See StreamControlSpec - the hardware question is open. */
export const padStream = (spec: { role: ControlRole }): StreamControlSpec => ({ kind: "stream", ...spec });

/* ------------------------------------------------------------------ *
 * The palette
 * ------------------------------------------------------------------ */

/**
 * Colour NAMES, resolved to hardware palette indices by the library.
 *
 * A device that writes `36` is a device nobody can read, and an index is not
 * portable across generations until doc/MAX-FACTS.md says it is.
 *
 * PROVISIONAL, and that is the honest status. `probe_palette` paints index
 * `base + y*8 + x` on every pad, so two photographs put all 128 indices at known
 * positions - and these names are what those photographs look like, through a
 * camera, at one white balance. Index 0 is the exception: it is MEASURED off, the
 * only dark pad on page 0.
 *
 * NO GREY IS NAMED, because none was identified in the photographs. Do not add one
 * by analogy with the Push 2 velocity palette (0 off, 1 dark grey, 2 grey, 3 white):
 * on this hardware index 2 photographs as pure red, so that palette is not this one.
 * A device that wants a dim, always-lit border uses `tan`.
 */
export const PUSH_PALETTE = {
  /** MEASURED: the only dark pad on page 0. */
  black: 0,
  red: 2,
  amber: 3,
  peach: 5,
  tan: 7,
  orange: 8,
  yellow: 9,
  lime: 10,
  green: 11,
  spring: 13,
  turquoise: 14,
  sky: 16,
  ocean: 18,
  violet: 21,
  purple: 22,
  magenta: 23,
  rose: 25,
  pink: 26,
  gold: 29,
  mint: 32,
  pale_blue: 34,
  pale_pink: 37,
  white: 69,
} as const;

/** A colour a device may name. */
export type PadColour = keyof typeof PUSH_PALETTE;

/**
 * Roughly what each name looks like, for a screen that mirrors the hardware - the
 * dev harness's mock grid, and a device's own on-page preview.
 *
 * Same photographs, same caveat. Good enough to recognise a layout; not a colour
 * profile.
 */
export const PALETTE_CSS: Record<PadColour, string> = {
  black: "#0e1013",
  red: "rgb(255, 0, 0)",
  amber: "rgb(255, 106, 0)",
  peach: "rgb(255, 138, 106)",
  tan: "rgb(224, 168, 120)",
  orange: "rgb(255, 149, 0)",
  yellow: "rgb(255, 224, 0)",
  lime: "rgb(200, 224, 0)",
  green: "rgb(51, 209, 58)",
  spring: "rgb(74, 211, 154)",
  turquoise: "rgb(74, 209, 209)",
  sky: "rgb(53, 180, 224)",
  ocean: "rgb(30, 79, 224)",
  violet: "rgb(106, 90, 224)",
  purple: "rgb(154, 90, 224)",
  magenta: "rgb(209, 90, 209)",
  rose: "rgb(224, 21, 90)",
  pink: "rgb(224, 90, 154)",
  gold: "rgb(255, 180, 0)",
  mint: "rgb(23, 201, 100)",
  pale_blue: "rgb(154, 154, 224)",
  pale_pink: "rgb(255, 180, 200)",
  white: "rgb(240, 240, 240)",
};

/** The index the hardware wants for a named colour. An unknown name is OFF, not a guess. */
export function paletteIndex(colour: string): number {
  const i = (PUSH_PALETTE as Record<string, number>)[colour];
  return typeof i === "number" ? i : 0;
}

/** ...and back, for a screen mirroring the hardware. */
export function cssForPaletteIndex(index: number): string {
  for (const name of Object.keys(PUSH_PALETTE) as PadColour[]) {
    if (PUSH_PALETTE[name] === index) return PALETTE_CSS[name];
  }
  return PALETTE_CSS.black;
}

/* ------------------------------------------------------------------ *
 * The declaration
 * ------------------------------------------------------------------ */

/** When an enabled device actually HOLDS the controls it declared. */
export type FocusPolicy = "Device" | "Track" | "Always";

export const FOCUS_OPTIONS: readonly FocusPolicy[] = ["Device", "Track", "Always"];

export interface ControlsDef<C extends Record<string, ControlSpec>> {
  /** Which hardware family the roles are resolved against. */
  surface: "push";
  controls: C;
  /**
   * What `focus` starts at. `Track` is the default because two of these devices in
   * one set is the normal case, not the edge: `Always` means the last one loaded
   * wins the grid forever, which reads as the first one being broken.
   */
  defaultFocus?: FocusPolicy;
}

export interface Controls<C extends Record<string, ControlSpec> = Record<string, ControlSpec>> extends ControlsDef<C> {
  /**
   * Declaration order - the order the build emits CONTROLS_SPEC and the chain wires
   * observers.
   *
   * Deliberately `string[]` and not `Extract<keyof C, string>[]`. Naming the keys
   * here would make `Controls<C>` INVARIANT in C, and a `Controls<{ pads: ... }>`
   * would then not be assignable to the `Controls` a surface declares - which reads,
   * at the call site, as "property 'pads' is missing in Record<string, ControlSpec>".
   * The precise key union is where it is useful anyway: on `usePadGrid`, which takes
   * it from `keyof C` directly.
   */
  readonly keys: readonly string[];
  readonly defaultFocus: FocusPolicy;
}

/**
 * The parameter ids `defineControls` contributes to a device's Surface.
 *
 * They are REAL Live parameters, so the user can switch takeover off, automate it,
 * put it on an encoder and see it in the device view. `takeover` defaults OFF: a
 * device that seizes the pads of every set it lands in is a device people uninstall.
 */
export const TAKEOVER_PARAM = "takeover";
export const FOCUS_PARAM = "focus";

/**
 * Declare what this device claims on the control surface.
 *
 * ```ts
 * export default defineControls({
 *   surface: "push",
 *   controls: { pads: grid({ role: "matrix", rows: 8, cols: 8 }) },
 * });
 * ```
 */
export function defineControls<const C extends Record<string, ControlSpec>>(def: ControlsDef<C>): Controls<C> {
  if (def.surface !== "push") {
    throw new Error(`controls: surface "${def.surface}" is not a family this library resolves roles for (push)`);
  }
  const keys = Object.keys(def.controls) as Extract<keyof C, string>[];
  if (!keys.length) throw new Error(`controls: declare at least one control - a device that claims nothing should not declare controls at all`);

  const claimed = new Map<ControlRole, string>();
  for (const key of keys) {
    // The key becomes the selector `pad_<key>`, and Max splits a message on
    // whitespace: a key with a space in it would arrive as two atoms and dispatch to
    // a handler nobody wrote.
    if (/\s/.test(key)) throw new Error(`controls: key "${key}" has whitespace - it becomes the selector pad_${key}, which Max would split`);
    const spec = def.controls[key];
    const role = spec.role as ControlRole;

    if (!(role in ROLE_NAMES)) {
      throw new Error(`controls: "${key}" claims role "${role}", which is not in the vocabulary (${Object.keys(ROLE_NAMES).join(", ")})`);
    }
    for (const name of ROLE_NAMES[role]) {
      if (REFUSED_ROLES[name]) throw new Error(`controls: "${key}" claims "${role}", which this library refuses - ${REFUSED_ROLES[name]}`);
    }
    const already = claimed.get(role);
    if (already) throw new Error(`controls: "${key}" and "${already}" both claim role "${role}" - one control cannot be grabbed twice`);
    claimed.set(role, key);

    if (spec.kind === "grid") {
      const shape = GRID_SHAPE[role];
      if (!shape) {
        throw new Error(`controls: "${key}" declares role "${role}" as a grid, but that role is not a grid (it is a ${describeRole(role)})`);
      }
      if (spec.rows !== shape.rows || spec.cols !== shape.cols) {
        throw new Error(
          `controls: "${key}" declares role "${role}" as ${spec.rows}x${spec.cols}; on this hardware it is ${shape.rows}x${shape.cols}`,
        );
      }
    }
    if (spec.kind === "button" && !BUTTON_ROLES.includes(role)) {
      throw new Error(`controls: "${key}" declares role "${role}" as a button, but that role is a ${describeRole(role)}`);
    }
    if (spec.kind === "stream" && !STREAM_ROLES.includes(role)) {
      throw new Error(`controls: "${key}" declares role "${role}" as a stream, but that role is a ${describeRole(role)}`);
    }
  }

  // Stamp the candidate names onto each control, so the build reads one table
  // rather than reimplementing it. See ControlBase.
  const resolved = {} as C;
  for (const key of keys) {
    const spec = def.controls[key];
    (resolved as Record<string, ControlSpec>)[key] = { ...spec, names: ROLE_NAMES[spec.role as ControlRole] };
  }

  return { ...def, controls: resolved, keys, defaultFocus: def.defaultFocus ?? "Track" };
}

function describeRole(role: ControlRole): string {
  if (GRID_SHAPE[role]) return "grid";
  if (STREAM_ROLES.includes(role)) return "stream";
  return "button";
}

/** How many cells one declared control carries. A button and a stream are one. */
export function controlSize(spec: ControlSpec): number {
  return spec.kind === "grid" ? spec.rows * spec.cols : 1;
}

/** The candidate names one declared control resolves against, in order. */
export function controlNames(spec: ControlSpec): readonly string[] {
  return ROLE_NAMES[spec.role as ControlRole] ?? [];
}
