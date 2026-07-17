/**
 * The wrapper is not a library you import - Max's [js] has no module system.
 * It is a set of TypeScript sources the build COMPILES TOGETHER and
 * CONCATENATES, in this order, into one ES5 script.
 *
 * Because they all compile as global scripts in a single TS program, they see
 * each other's functions (core's bang() calls liveapi's startTickPoll()), and
 * TypeScript still typechecks across the seam.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (f) => path.join(here, "src", f);

/** Ambient types for post/outlet/LiveAPI/Task/File. Typechecked, never emitted. */
export const types = src("max.d.ts");

/**
 * Ordered. core must come first: it owns the lifecycle that the rest hooks
 * into. A device's own `wrapper/device.ts`, if present, is appended after these
 * by the build, so it can define extra message handlers.
 */
export const sources = [
	src("core.ts"), // build stamp, lifecycle, the anything() guard, payload extraction
	src("liveapi.ts"), // transport poll, tempo observer, clip I/O
	src("watch.ts"), // defineWatch() observers - after liveapi, it calls observeProperty()
];
