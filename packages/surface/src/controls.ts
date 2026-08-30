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
  // The gestures around the jog wheel and the strip. MEASURED as momentary buttons on a
  // Push 3: 127 down, 0 up. They are buttons that happen to live on continuous hardware.
  | "jogwheel_press"
  | "jogwheel_tap"
  | "jogwheel_left"
  | "jogwheel_right"
  | "touch_strip_tap"
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
  // All five measured on a Push 3, one grab each: they resolve, and every one is a
  // momentary button - 127 on the way down, 0 on the way up. `Touch_Strip_Tap` reports
  // the SAME pair wherever on the strip you tap, so it is a tap and not a position.
  jogwheel_press: ["Jogwheel_Press"],
  jogwheel_tap: ["Jogwheel_Tap"],
  jogwheel_left: ["Jogwheel_Left_nudge"],
  jogwheel_right: ["Jogwheel_Right_nudge"],
  touch_strip_tap: ["Touch_Strip_Tap"],
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
  "jogwheel_press",
  "jogwheel_tap",
  "jogwheel_left",
  "jogwheel_right",
  "touch_strip_tap",
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
 * doc/TODO.md - one button press in `push-probe`, and it gates the DJ surface in
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
 * The 128 pad colours, as Live itself holds them.
 *
 * READ OUT OF LIVE, not off a photograph. Live 12 drives Push from
 * `Program/Push/python/Push2/colors.pyc`, whose `COLOR_TABLE` is 128 entries and whose
 * `push_color_index_to_pad_rgb(i)` returns `COLOR_TABLE[i]` split into bytes. These are
 * those values: `PUSH_PAD_RGB[i]` is `0xRRGGBB` for palette index `i`, so what a device
 * draws on screen and what the pad shows come from one number.
 *
 * It agrees with the hardware. Painting a known pattern on a Push 3 and photographing it
 * matched this table across the greys, the pastels and the primaries, and it explains the
 * two errors the photographs had made - see doc/MAX-FACTS.md, "Live holds the pad palette,
 * and the photographs were a page upside down".
 *
 * The greys and the pure primaries are at the END: 118 grey, 119 near-black, 120 white,
 * 122 light grey, 123 dark grey, 125 blue, 126 green, 127 red. Indices 65 to 117 are the
 * dim and shaded variants, which is why so much of that range photographs as mud.
 */
export const PUSH_PAD_RGB: readonly number[] = [
  0x000000, 0xff4032, 0x800400, 0xc93c00, 0xac1f00, 0x8c5018, 0x491804, 0xfadc3b, // 0-7
  0xffc516, 0xb6ff0e, 0x79ff18, 0x34c216, 0x4f8a04, 0x62ff55, 0x297d53, 0x269e72, // 8-15
  0x31adff, 0x3663fc, 0x1a34ff, 0x1c0ce6, 0x153999, 0x3937ff, 0x5722ff, 0x972bff, // 16-23
  0x852178, 0xff1032, 0xff2bd4, 0xa63421, 0x995628, 0x876700, 0x90821f, 0x4a8700, // 24-31
  0x007f12, 0x1853b2, 0x624bad, 0x733a67, 0xf8bcaf, 0xff9b76, 0xffbf5f, 0xd9af71, // 32-39
  0xfff480, 0xbfba69, 0xbccc88, 0xaeff99, 0x7cdd9f, 0x89b47d, 0x80f3ff, 0x7acefc, // 40-47
  0x68a1d3, 0x858fc2, 0xbbaaf2, 0xcdbbe4, 0xef8bb0, 0x859d8c, 0x6b756e, 0x84909b, // 48-55
  0x6a7075, 0x88859d, 0x6c6a75, 0x9d859c, 0x746a74, 0x9c9d85, 0x74756a, 0x9d8484, // 56-63
  0x756a6a, 0x661914, 0x210806, 0x460300, 0x280000, 0x5d1700, 0x200d00, 0x470c00, // 64-71
  0x1c0800, 0x3b2b14, 0x1c130a, 0x250e05, 0x0d0602, 0x645817, 0x201c07, 0x664e08, // 72-79
  0x211902, 0x486605, 0x172101, 0x306609, 0x0f2103, 0x144d08, 0x061902, 0x1f3701, // 80-87
  0x0a1100, 0x276622, 0x0c210b, 0x143e29, 0x081910, 0x004d36, 0x00180e, 0x134566, // 88-95
  0x061621, 0x152764, 0x070c20, 0x0a1466, 0x030621, 0x0b045c, 0x03011d, 0x0a1c4c, // 96-103
  0x040b1e, 0x161666, 0x070721, 0x220d66, 0x0b0421, 0x3c1166, 0x130521, 0x350d30, // 104-111
  0x11040f, 0x660614, 0x210206, 0x661154, 0x21051b, 0x000000, 0x595959, 0x1a1a1a, // 112-119
  0xffffff, 0x595959, 0xcccccc, 0x404040, 0x141414, 0x0000ff, 0x00ff00, 0xff0000, // 120-127
];

/** `0xRRGGBB` as a CSS colour, so a screen can mirror a pad exactly. */
export function rgbCss(value: number): string {
  return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`;
}

/**
 * Colour NAMES, resolved to hardware palette indices by the library.
 *
 * A device that writes `36` is a device nobody can read. Every index below was chosen
 * because `PUSH_PAD_RGB` says it IS that colour, so the name and the light agree.
 *
 * These are a legible subset, not the whole palette. A device that wants an index the
 * names do not cover reads `PUSH_PAD_RGB` and picks one.
 */
export const PUSH_PALETTE = {
  black: 0,
  /** 0xff0000. The pure primaries live at the top of the table. */
  red: 127,
  orange: 3,
  amber: 8,
  yellow: 7,
  lime: 9,
  green: 11,
  spring: 13,
  turquoise: 15,
  mint: 44,
  sky: 16,
  cyan: 46,
  ocean: 33,
  blue: 18,
  violet: 22,
  purple: 23,
  magenta: 26,
  rose: 25,
  pink: 52,
  peach: 36,
  tan: 39,
  gold: 38,
  pale_blue: 47,
  pale_pink: 51,
  /** The greys, which the photographs never found. */
  grey: 118,
  dark_grey: 123,
  light_grey: 122,
  white: 120,
} as const;

/** A colour a device may name. */
export type PadColour = keyof typeof PUSH_PALETTE;

/**
 * What each name looks like on a screen mirroring the hardware.
 *
 * DERIVED, never typed by hand: one table, so a name cannot drift from its light.
 */
export const PALETTE_CSS: Record<PadColour, string> = Object.fromEntries(
  (Object.keys(PUSH_PALETTE) as PadColour[]).map((name) => [name, rgbCss(PUSH_PAD_RGB[PUSH_PALETTE[name]]!)]),
) as Record<PadColour, string>;

/** The index the hardware wants for a named colour. An unknown name is OFF, not a guess. */
export function paletteIndex(colour: string): number {
  const i = (PUSH_PALETTE as Record<string, number>)[colour];
  return typeof i === "number" ? i : 0;
}

/** ...and back, for a screen mirroring the hardware. Any of the 128, named or not. */
export function cssForPaletteIndex(index: number): string {
  const rgb = PUSH_PAD_RGB[index];
  return rgb === undefined ? rgbCss(0) : rgbCss(rgb);
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
