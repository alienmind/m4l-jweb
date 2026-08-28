/**
 * protocol.ts (push-probe) - the selectors of the SPIKE in
 * doc/PUSH-USECASES.md (and MAX-FACTS.md, "Grabbing a Push control").
 *
 * None of these names survive into the feature. `defineControls` will own
 * `pad` / `controls_ready` / `paint` / `paint_all` (section 2.6), declared as
 * CONTROLS_IN / CONTROLS_OUT in @m4l-jweb/bridge so a device never types them -
 * and the probe deliberately does NOT claim those names early. A spike that
 * squats on the library's vocabulary makes the first real device look finished
 * when it is only wired.
 *
 * Every OUT selector below is a `function <name>()` in this repo's
 * `wrapper/device.ts`, and every IN selector is sent from there. That is not a
 * convention, it is what `tests/protocol.test.mjs` checks - an unrouted selector
 * is a message falling on the floor and produces no error at runtime, which is
 * exactly the failure a probe cannot afford: it would read as "the hardware said
 * nothing".
 */
import { DEVICE_IN } from "@m4l-jweb/bridge";

/** Device -> UI. */
export const IN = {
  ...DEVICE_IN,
  /** wrapper -> UI: one line of the probe's log, also posted to the Max console. */
  probe_log: "probe_log",
  /**
   * wrapper -> UI: one event off the grabbed control's `value` observer, as
   * `probe_pad <velocity> <x> <yFromTop> <unknown> <maxTimeMs>`.
   *
   * MEASURED on a Push 3. The observer's payload is FIVE atoms,
   * `value <velocity> <x> <y> <1>` - not the three of section 3.1, not in that
   * order, and `y` counts from the TOP while section 2.3's API counts from the
   * bottom. The flip lives in the page here; in the library it belongs in one
   * place, or every device on the grid is silently mirrored.
   *
   * The fourth atom is `1` on every event so far, press and release alike. Unnamed
   * on purpose - a guess here would become a fact by repetition.
   *
   * The timestamp is Max's, not the page's: a clock taken after Chromium's event
   * loop cannot tell one hardware event from two that arrived together.
   */
  probe_pad: "probe_pad",
  /**
   * mpein -> UI: ONE raw MPE event, straight off `[mpeparse]`'s outlet 9:
   * `mpeevent <zoneFirstChannel> <zoneIndex> <voiceNumber> <channel> <messageNumber> <data...>`
   *
   * Not a probe selector - `mpeparse` emits the word itself, so this is the object's
   * own name and not ours to choose. It arrives only when the device declares
   * `mpe: true` (the `is_mpe` patcher attribute) AND something is playing the pads,
   * which is the whole experiment: the grabbed matrix carries no expression, and this
   * is the other path it could arrive on.
   *
   * `messageNumber` is left raw. The reference names the field and not its values,
   * and a guessed enum would become a fact by repetition.
   */
  mpeevent: "mpeevent",
  /** wrapper -> UI: `probe_state <grabbed 0|1>` - do we hold the grid right now? */
  probe_state: "probe_state",
  /**
   * wrapper -> UI: the deferred first frame has run and the grid is dark.
   *
   * The page latches what is lit, so it has to know when Max blanked the hardware
   * underneath it - otherwise its model says "lit" and the pad is off.
   */
  probe_blanked: "probe_blanked",
} as const;

/** UI -> device. */
export const OUT = {
  /** UI -> wrapper: page ready; send me the current state. */
  ui_ready: "ui_ready",
  /** Resolve the surface and `Button_Matrix`. */
  probe_scan: "probe_scan",
  /** `get_control_names` on the surface actually plugged in - 45 lines of console. */
  probe_names: "probe_names",
  /** Grab `Button_Matrix` BY NAME and observe its value. No arguments: there is one addressing. */
  probe_grab: "probe_grab",
  /** Release it. */
  probe_release: "probe_release",
  /** One cell: `probe_paint <x> <yFromTop> <colour>`. */
  probe_paint: "probe_paint",
  /** Paint all 64 pads off. */
  probe_clear: "probe_clear",
  /** STILL OPEN: `probe_palette <page>` - 64 indices at once, in known positions. */
  probe_palette: "probe_palette",
  /**
   * STILL OPEN: `probe_other <controlName> <1 grab | 0 release>` - grab ANY control
   * by name and dump what its `value` carries.
   *
   * The grabbed `Button_Matrix` gives press and release with a velocity and nothing
   * else, but `get_control_names` lists `Mpe_Pitch_Bend_Elements`,
   * `Double_Press_Matrix` and the two `*_Press_Event_Matrix` controls beside it.
   */
  probe_other: "probe_other",
} as const;
