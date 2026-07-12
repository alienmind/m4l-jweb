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
