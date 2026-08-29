/**
 * controls.ts (push-snake) - what this device claims on the hardware.
 *
 * The 8x8 grid, and nothing else. That is a real cost and it is the right one
 * here: claiming `Button_Matrix` takes the pads OFF THE NOTE PATH - no MIDI, no MPE
 * expression, measured - which for a game is exactly what you want and for a
 * sequencer would be a decision to think about. The scene column, the transport and
 * the mode buttons are left alone, so everything else on the Push keeps working.
 *
 * Roles, never Max names: the library owns the name table and resolves it against
 * the connected hardware's own `get_control_names`.
 */
import { defineControls, grid } from "@m4l-jweb/surface";

export default defineControls({
  surface: "push",
  controls: {
    pads: grid({ role: "matrix", rows: 8, cols: 8 }),
  },
});
