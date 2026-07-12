/**
 * protocol.ts (transposer) - every selector that crosses the bridge.
 *
 * Both sides read this file: the app binds/emits these names, and the patcher
 * generated from patcher/devices.mjs routes them.
 */

/** Device -> UI. */
export const IN = {
	/** wrapper -> UI: run mode. */
	mode: "mode",
	/** wrapper -> UI: build stamp, for the stale-install check. */
	build: "build",
	/** midiin chain -> UI: `notein <pitch> <velocity>` (velocity 0 = note off). */
	notein: "notein",
	/** live.dial -> UI: `semitones <-24..24>`. A parameter is just a message. */
	semitones: "semitones",
} as const;

/** UI -> device. */
export const OUT = {
	/** UI -> wrapper: page ready; send me the current state. */
	ui_ready: "ui_ready",
	/** UI -> midiout chain: `midinote <pitch> <vel> <durMs> <chan> <delayMs>`. */
	midinote: "midinote",
} as const;
