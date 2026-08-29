/**
 * pads.ts - the state behind usePadGrid(), with no React in it.
 *
 * The twin of store.ts, and separate from it for the same reason store.ts is
 * separate from react.tsx: everything subtle here is testable without a DOM. What
 * is subtle is not the binding - it is the two things this file owns and nothing
 * else may:
 *
 * ------------------------------------------------------------------------------
 * 1. THE Y FLIP, IN ONE PLACE.
 *
 * The hardware counts rows from the TOP (a press on the bottom-left pad reports
 * y = 7) and `defineControls`' API counts them from the BOTTOM, which is the
 * orientation every layout in PUSH-USECASES.md is drawn in. Both directions are
 * converted HERE, on the way out of `draw()` and on the way in from `pad_<key>`,
 * and nowhere else. Do it twice and it cancels; do it in a device and every OTHER
 * device on the grid is mirrored vertically with nothing to report it. That misread
 * cost two rounds of the spike, because a wrong reading of the same payload
 * collapsed four corners onto two cells and looked like a hardware fault.
 *
 * ------------------------------------------------------------------------------
 * 2. THE FRAME IS WHOLE, AND SENT ONLY WHEN IT CHANGED.
 *
 * `draw()` takes a FRAME, not a pad: a device describes the entire grid every time
 * and this works out whether anything moved. The callback fills an off-screen
 * buffer of palette indices; if it is identical to the last buffer sent, nothing
 * crosses the bridge at all. So a device may redraw on every tick and every state
 * change - which is what makes `pads.draw(frame)` on a worker message a reasonable
 * thing to write - and a still grid costs nothing.
 *
 * The wrapper diffs a second time, per CELL, against what the HARDWARE last
 * received. That is not the same buffer: Live repaints the matrix as it hands it
 * over, so after a grab the hardware's state is unknown and the wrapper has to
 * repaint everything even though the app's frame did not change. Two diffs, two
 * questions: this one is "did the device change its mind", the wrapper's is "does
 * the pad already show this".
 */
import { bindInlet, outlet, padSelector, CONTROLS_IN, CONTROLS_OUT } from "@m4l-jweb/bridge";
import { controlSize, paletteIndex, type ControlSpec, type Controls } from "./controls";

/** One event off a grabbed control. */
export interface PadEvent {
  /** 0 .. cols-1, left to right. */
  x: number;
  /** 0 .. rows-1, BOTTOM to top - flipped from the wire here and nowhere else. */
  y: number;
  /** The raw value: a velocity on a press, 0 on a release. */
  value: number;
  /** `value > 0` - the check nine handlers in ten want. */
  down: boolean;
  /**
   * The wire's fourth atom, passed through unnamed.
   *
   * It has been `1` on every event observed on a Push 3, press and release alike,
   * and naming a field after a guess is how a guess becomes a fact by repetition.
   */
  extra: number;
}

/** The painting surface `draw()` hands you. Coordinates are bottom-up. */
export interface PadFrame {
  readonly rows: number;
  readonly cols: number;
  /** Fill every cell. */
  clear(colour: string): void;
  /** One cell. Out-of-range coordinates are ignored rather than thrown - a game's cursor may walk off the edge. */
  set(x: number, y: number, colour: string): void;
  /** A whole row, bottom-up. */
  row(y: number, colour: string): void;
  /** A whole column. */
  col(x: number, colour: string): void;
  /** A rectangle, from its bottom-left corner. */
  rect(x: number, y: number, w: number, h: number, colour: string): void;
}

/**
 * Why this device is or is not holding what it declared.
 *
 * `held` is the only one that is not a complaint. The other four are why the pads are
 * dark, and they are worth distinguishing precisely because the hardware cannot: a
 * Push with `takeover` off, a Push that is not plugged in, and a Push another instance
 * of the device is holding all look identical.
 */
export type PadHoldReason = "held" | "off" | "no_surface" | "unresolved" | "not_focused";

export type PadHandler = (e: PadEvent) => void;
/** A `stream` control's raw atoms, exactly as the hardware sent them. Nothing is measured about their meaning yet. */
export type StreamHandler = (atoms: number[]) => void;

export interface PadStore {
  /** Paint the whole of one control. Nothing crosses the bridge if the frame is unchanged. */
  draw(key: string, fill: (f: PadFrame) => void): void;
  /** Force the next `draw` to be sent even if it is identical, and tell the wrapper to repaint the hardware. */
  refresh(): void;
  onPad(key: string, fn: PadHandler): () => void;
  onStream(key: string, fn: StreamHandler): () => void;
  /** Do we hold the declared controls right now? */
  held(): boolean;
  /**
   * WHY, when we do not - `off`, `no_surface`, `unresolved`, `not_focused`, `held`.
   *
   * On the hardware all four look the same: a dark Push. And a rejected LiveAPI call
   * reports nothing, so the wrapper cannot say whether Live accepted a grab - only
   * what it DECIDED, which is this.
   */
  reason(): PadHoldReason;
  /** Which declared roles resolved on the connected hardware. A key absent from this map has not been answered for yet. */
  roles(): Record<string, boolean>;
  subscribe(fn: () => void): () => void;
}

const stores = new WeakMap<object, PadStore>();

/**
 * The store for one `defineControls()` declaration - created once, never torn down.
 *
 * Same rule as paramStore: the bridge holds ONE handler per selector, so a second
 * `bindInlet("pad_pads", ...)` would silently replace the first and one of the two
 * components would never see another press. Bind once, fan out.
 */
export function padStore<C extends Record<string, ControlSpec>>(controls: Controls<C>): PadStore {
  const existing = stores.get(controls);
  if (existing) return existing;

  const keys = controls.keys as readonly string[];
  const specs = controls.controls as Record<string, ControlSpec>;

  /** The last frame SENT for each control, in hardware order. Null means "nothing sent yet". */
  const sent = new Map<string, number[]>();
  const padHandlers = new Map<string, Set<PadHandler>>();
  const streamHandlers = new Map<string, Set<StreamHandler>>();
  const listeners = new Set<() => void>();

  let heldNow = false;
  let reasonNow: PadHoldReason = "off";
  let roleMap: Record<string, boolean> = {};

  const notify = () => {
    for (const fn of listeners) fn();
  };

  for (const key of keys) {
    const spec = specs[key];
    const rows = spec.kind === "grid" ? spec.rows : 1;
    const cols = spec.kind === "grid" ? spec.cols : 1;

    bindInlet(padSelector(key), (...args) => {
      const atoms = args.map(Number);

      // `live.observer` emits the property's CURRENT value the moment it is pointed
      // at an object - for a control nobody has touched that is a bang, which
      // arrives here as no arguments at all. It is an attach notification, not a
      // press, and forwarding it is a press at (undefined, undefined).
      if (!atoms.length) return;

      const streams = streamHandlers.get(key);
      if (streams) for (const fn of streams) fn(atoms);
      if (spec.kind === "stream") return;

      const handlers = padHandlers.get(key);
      if (!handlers?.size) return;

      // MEASURED on a Push 3: `<velocity> <x> <yFromTop> <1>`. A button carries one
      // atom (unmeasured - no button but the matrix has been grabbed), so its
      // coordinates are the only cell it has.
      const value = atoms[0];
      const hx = atoms.length >= 3 ? atoms[1] : 0;
      const hy = atoms.length >= 3 ? atoms[2] : 0;
      const e: PadEvent = { x: hx, y: rows - 1 - hy, value, down: value > 0, extra: atoms.length >= 4 ? atoms[3] : 0 };
      if (e.x < 0 || e.x >= cols || e.y < 0 || e.y >= rows) return;
      for (const fn of handlers) fn(e);
    });
  }

  bindInlet(CONTROLS_IN.controls_held, (v, why) => {
    const next = Number(v) === 1;
    const nextReason = (why === undefined ? (next ? "held" : "off") : String(why)) as PadHoldReason;
    if (next === heldNow && nextReason === reasonNow) return;
    reasonNow = nextReason;
    if (next === heldNow) {
      // The reason moved without the grab moving - `off` to `not_focused`, say. The
      // page still wants to know, and the frame cache is still valid.
      notify();
      return;
    }
    heldNow = next;
    // The hardware is repainted by Live as it hands the controls over, so what we
    // last sent is no longer what is lit. Forget it either way, and the next draw
    // is a whole frame rather than a no-op against a stale cache.
    sent.clear();
    notify();
  });

  bindInlet(CONTROLS_IN.controls_role, (key, ok) => {
    const next = { ...roleMap, [String(key)]: Number(ok) === 1 };
    roleMap = next;
    notify();
  });

  const store: PadStore = {
    draw(key, fill) {
      const spec = specs[key];
      if (!spec) return;
      const rows = spec.kind === "grid" ? spec.rows : 1;
      const cols = spec.kind === "grid" ? spec.cols : 1;
      const cells = new Array<number>(controlSize(spec)).fill(0);

      // Hardware order: row 0 is the TOP. The flip is here, and only here.
      const at = (x: number, y: number) => (rows - 1 - y) * cols + x;
      const put = (x: number, y: number, colour: string) => {
        if (x < 0 || x >= cols || y < 0 || y >= rows) return;
        cells[at(x, y)] = paletteIndex(colour);
      };

      const frame: PadFrame = {
        rows,
        cols,
        clear: (colour) => cells.fill(paletteIndex(colour)),
        set: put,
        row: (y, colour) => {
          for (let x = 0; x < cols; x++) put(x, y, colour);
        },
        col: (x, colour) => {
          for (let y = 0; y < rows; y++) put(x, y, colour);
        },
        rect: (x, y, w, h, colour) => {
          for (let dx = 0; dx < w; dx++) for (let dy = 0; dy < h; dy++) put(x + dx, y + dy, colour);
        },
      };
      fill(frame);

      const last = sent.get(key);
      if (last && last.length === cells.length && last.every((c, i) => c === cells[i])) return;
      sent.set(key, cells);
      // ONE message carrying the whole grid, not one per cell: [js] is a control
      // plane, and sixty-four messages a frame is a data plane. The per-cell diff
      // that decides what the hardware is actually told happens in the wrapper.
      outlet(CONTROLS_OUT.controls_frame, key, ...cells);
    },
    refresh() {
      sent.clear();
      outlet(CONTROLS_OUT.controls_refresh);
    },
    onPad(key, fn) {
      let set = padHandlers.get(key);
      if (!set) padHandlers.set(key, (set = new Set()));
      set.add(fn);
      return () => set!.delete(fn);
    },
    onStream(key, fn) {
      let set = streamHandlers.get(key);
      if (!set) streamHandlers.set(key, (set = new Set()));
      set.add(fn);
      return () => set!.delete(fn);
    },
    held: () => heldNow,
    reason: () => reasonNow,
    roles: () => roleMap,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };

  stores.set(controls, store);
  return store;
}
