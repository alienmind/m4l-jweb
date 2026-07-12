/**
 * @m4l-jweb/bridge - the entire API surface between your web app and the device.
 *
 * jweb exposes exactly two calls to the embedded page:
 *   window.max.bindInlet(name, handler)  - receive a Max message
 *   window.max.outlet(...args)           - send a Max message
 *
 * That is it. Everything else in this package is ergonomics on top: the
 * `ui_ready` handshake, base64 helpers for structured payloads, and a dev shim
 * so the same code runs in a plain browser with hot reload.
 *
 * Zero dependencies, by design - this is the one piece that ships inside a
 * Chromium view embedded in a DAW.
 */

/**
 * Max message arguments are untyped on the wire (numbers, symbols, lists), so
 * handler params arrive as `unknown` and you narrow them at the edge:
 *   bindInlet("tempo", (bpm) => setTempo(Number(bpm)))
 */
type InletHandler = (...args: unknown[]) => void;

interface MaxGlobal {
	bindInlet: (name: string, fn: InletHandler) => void;
	outlet: (...args: unknown[]) => void;
}

declare global {
	interface Window {
		max?: MaxGlobal;
		maxSimulate?: (name: string, ...args: unknown[]) => void;
	}
}

const handlers = new Map<string, InletHandler>();

/** True inside a real [jweb] view; false in the browser dev shim. */
export const inJweb: boolean = typeof window !== "undefined" && !!window.max;

/**
 * Handle the Max message `name`. Bind every selector your device receives, and
 * keep the names in one `protocol.ts` so both sides of the bridge agree.
 */
export function bindInlet(name: string, fn: InletHandler): void {
	handlers.set(name, fn);
	if (typeof window !== "undefined" && window.max) {
		window.max.bindInlet(name, fn);
	}
}

/** Send a Max message: a selector word followed by its arguments. */
export function outlet(...args: unknown[]): void {
	if (typeof window !== "undefined" && window.max) {
		window.max.outlet(...args);
	} else {
		console.debug("[m4l-jweb:outlet]", ...args);
	}
}

/**
 * Announce that the page has finished loading, so the wrapper can send back the
 * current state (mode, build stamp, tempo, parameters).
 *
 * This is NOT optional. The page loads asynchronously: anything the device sent
 * before your handlers were bound is simply gone. Call this once, after
 * binding, and treat the reply as the source of truth.
 */
export function uiReady(): void {
	outlet("ui_ready");
}

/**
 * Max splits messages on commas and semicolons, so any structured payload -
 * JSON, code, a filesystem path - must be encoded before it crosses the bridge.
 *
 * These are UTF-8 safe: btoa alone throws on anything outside latin1.
 */
export function encodeBase64(s: string): string {
	const bytes = new TextEncoder().encode(s);
	let binary = "";
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary);
}

export function decodeBase64(s: string): string {
	const binary = atob(s);
	const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
	return new TextDecoder().decode(bytes);
}

/**
 * Dev shim. Outside Max there is no window.max, so route messages straight into
 * the bound handlers and let the developer drive the device from the console:
 *
 *   maxSimulate("tempo", 128)
 *   maxSimulate("tick", 1, 4.25)
 */
if (typeof window !== "undefined" && !window.max) {
	window.maxSimulate = (name, ...args) => {
		const fn = handlers.get(name);
		if (fn) fn(...args);
		else console.warn(`[m4l-jweb] no handler bound for "${name}"`);
	};
	console.info("[m4l-jweb] running outside Max. Drive the device with: maxSimulate('tempo', 128)");
}
