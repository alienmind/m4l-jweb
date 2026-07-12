/**
 * protocol.ts - the typed list of selectors crossing the UI <-> device bridge.
 *
 * This is the single source of truth for BOTH sides of the bridge:
 *   - the web app binds/emits these selectors (via @m4l-jweb/bridge)
 *   - the [js] wrapper and the generated patcher route these selectors
 *
 * A Max message is a selector word followed by arguments
 * (e.g. `tick 1 12.5`). Keep selectors here so a CI lint can assert every one
 * appears in a route or handler on the patcher/wrapper side.
 */

/** Selectors the DEVICE sends INTO the UI (bindInlet these). */
export const IN = {
	/** wrapper -> UI: current run mode (midi | audio | instrument). */
	mode: "mode",
	/** wrapper -> UI: build stamp, for the stale-install check. */
	build: "build",
	/** wrapper -> UI: transport state. args: `<playing 0|1> <beats>`. */
	tick: "tick",
	/** wrapper -> UI: Live tempo in BPM. args: `<bpm>`. */
	tempo: "tempo",
} as const;

/** Selectors the UI sends OUT to the device (outlet these). */
export const OUT = {
	/** UI -> wrapper: page finished loading; reply with current state. */
	ui_ready: "ui_ready",
} as const;

export type InSelector = (typeof IN)[keyof typeof IN];
export type OutSelector = (typeof OUT)[keyof typeof OUT];
