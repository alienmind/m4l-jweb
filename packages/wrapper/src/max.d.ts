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

/**
 * A named Max dictionary, addressed from [js].
 *
 * The reason this exists here at all is [maxurl]: downloading to a FILE is not
 * expressible as a flat Max message. Per the reference, the file form is a
 * `dictionary <name>` message carrying a dict with a `filename_out` key - so
 * something has to build that dict, and [js] is the only thing in the patcher
 * that can.
 *
 * VERIFIED in Live (doc/SPIKES.md spike 1.3): [js] built a maxurl request dict
 * and read the response dict back. `constructor`, `set`, `clear` and `stringify`
 * all behave as declared. `get`, `parse` and `freepeer` were not exercised.
 */
declare class Dict {
  constructor(name?: string);
  name: string;
  set(key: string, value: unknown): void;
  /** UNVERIFIED - the spike only ever wrote, and read back via stringify(). */
  get(key: string): unknown;
  /** The whole dict as JSON - the cheapest way to see what maxurl replied. */
  stringify(): string;
  /** UNVERIFIED. */
  parse(json: string): void;
  clear(): void;
  /** Release the dict's reference. Max dictionaries are refcounted. UNVERIFIED. */
  freepeer(): void;
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

/**
 * A named [buffer~] in the patcher, addressed from [js].
 *
 * This is the seam that makes "disk is the audio transport" work: [js] tells a
 * buffer~ to `replace` a file on disk and MSP plays it from there, so audio
 * never crosses the Max message bridge (a text-parsed protocol) as data.
 *
 * The buffer~ must ALREADY EXIST in the patcher under this name - `new Buffer`
 * binds to one, it does not create one. And `send("replace", path)` is
 * ASYNCHRONOUS: framecount() right after it still reads the old size. Come back
 * on a Task.
 *
 * VERIFIED in Live (doc/SPIKES.md spike 1.2): an empty buffer~ went to 124439
 * frames, 1 channel, midsample -0.0319 after `send("replace", "jongly.aif")`.
 * `send`, `framecount`, `channelcount` and `peek` are all real and behave as
 * declared. `poke` is the one member here still taken on faith from the docs.
 *
 * `replace` on a file buffer~ cannot decode is a SILENT NO-OP: no error, and the
 * buffer keeps whatever it held before. So a frame count on its own never means
 * "the read worked" - it only means something next to what the count was before.
 */
declare class Buffer {
  constructor(name: string);
  /** Send a message to the buffer~ itself, e.g. `send("replace", "/path/x.wav")`. */
  send(message: string, ...args: unknown[]): void;
  framecount(): number;
  channelcount(): number;
  /** peek(channel, frameIndex, count) - channels and frames are 1-indexed. */
  peek(channel: number, index: number, count?: number): number;
  /** UNVERIFIED - spike 1.2 exercised everything above this, but not poke. */
  poke(channel: number, index: number, value: number): void;
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
