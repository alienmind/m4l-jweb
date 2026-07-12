/**
 * max.d.ts - ambient types for the globals Max's [js] object provides.
 *
 * The [js] runtime is an ES5-era interpreter: no modules, no `console`, no
 * `setTimeout`. It is also the ONLY place with LiveAPI access, and it always
 * runs - even inside a frozen device. Hence this file: enough typing to write
 * the glue in TypeScript without pretending it is a browser or Node.
 */

/** Print to the Max console. There is no `console` here. */
declare function post(...args: unknown[]): void;

/** Send a message out of outlet `n`. */
declare function outlet(n: number, ...args: unknown[]): void;

/** Collect the `arguments` of a Max message handler into a real array. */
declare function arrayfromargs(args: IArguments): unknown[];

/** Arguments given to the object box, e.g. `js wrapper.js midi` -> ["midi"]. */
declare const jsarguments: unknown[];

declare let autowatch: number;
declare let inlets: number;
declare let outlets: number;

/*
 * The patcher hosting this [js] is reached as `this.patcher` - at [js] global
 * scope `this` IS the jsthis object, and a plainly-called function inherits it.
 * `this.patcher.filepath` is how the wrapper locates the .amxd's folder on
 * disk. (Hence `noImplicitThis: false` in wrapper/tsconfig.json.)
 */

/** Max's scheduler. There is no `setTimeout` in [js]. */
declare class Task {
	constructor(fn: () => void, ctx: unknown);
	interval: number;
	repeat(count?: number): void;
	schedule(delayMs?: number): void;
	cancel(): void;
}

/** Max's file object. Note: `writebytes` truncates silently past ~16 KB. */
declare class File {
	constructor(path: string, mode?: "read" | "write" | "readwrite");
	isopen: boolean;
	eof: number;
	open(): void;
	close(): void;
	readstring(count: number): string;
	writestring(s: string): void;
	writebytes(bytes: number[]): void;
}

/** The Live object model. The whole reason [js] still exists in this stack. */
declare class LiveAPI {
	constructor(pathOrCallback: string | ((args: unknown[]) => void), path?: string);
	property: string;
	unquotedpath: string;
	get(prop: string): unknown;
	set(prop: string, value: unknown): void;
	getcount(child: string): number;
	call(method: string, ...args: unknown[]): unknown;
}

/** Injected by @m4l-jweb/build: "<version> <iso date>". */
declare const BUILD_STAMP: string | undefined;

/** Injected by @m4l-jweb/build: the UI html, base64, in chunks. */
declare const UI_PAYLOAD_NAME: string | undefined;
declare const UI_PAYLOAD_BYTES: number | undefined;
declare const UI_PAYLOAD_B64: string[] | undefined;

/**
 * Injected by @m4l-jweb/build from the manifest's `payloads`: any other file
 * that must exist on disk next to the .amxd, because whatever reads it is not a
 * Max-native object and so cannot see the frozen virtual filesystem.
 */
declare const EXTRA_PAYLOAD_NAMES: string[] | undefined;
declare const EXTRA_PAYLOAD_BYTES: number[] | undefined;
declare const EXTRA_PAYLOAD_B64: string[][] | undefined;

/*
 * Device hooks.
 *
 * Define any of these as a plain function in your repo's `wrapper/device.ts` and
 * the packaged wrapper will call it; leave it out and nothing happens. They are
 * declared here (rather than defined) so both sides typecheck: the wrapper guards
 * every call with `typeof onX === "function"`, which is safe even when the
 * identifier was never declared at runtime.
 */

/**
 * live.thisdevice has fired: the device is fully loaded and LiveAPI is finally
 * safe. Create your observers HERE - objects built during loadbang are dead.
 */
declare function onDeviceReady(): void;

/** The UI announced itself. Resend any device-specific state it needs. */
declare function onUiReady(): void;

/** Every transport poll (20 Hz), after the packaged wrapper has sent its tick. */
declare function onTick(playing: number, beats: number): void;

/** Live's tempo changed (and once on attach). */
declare function onTempoChange(bpm: number): void;
