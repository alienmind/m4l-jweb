/**
 * maxBridge - thin wrapper over jweb's `window.max` bridge.
 *
 * jweb exposes exactly two calls to the embedded page:
 *   window.max.bindInlet(name, handler)  - receive a Max message
 *   window.max.outlet(...args)           - send a Max message
 *
 * That two-call surface is the ENTIRE API between the web app and the device.
 * Outside Max (browser dev), `window.max` is absent, so this module installs a
 * `window.maxSimulate(name, ...args)` shim that routes into the same handlers -
 * you develop in a normal browser with hot reload, then it runs unchanged in
 * the device.
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

export const inJweb = typeof window !== "undefined" && !!window.max;

export function bindInlet(name: string, fn: InletHandler): void {
	handlers.set(name, fn);
	if (typeof window !== "undefined" && window.max) {
		window.max.bindInlet(name, fn);
	}
}

export function outlet(...args: unknown[]): void {
	if (typeof window !== "undefined" && window.max) {
		window.max.outlet(...args);
	} else {
		console.debug("[maxBridge:outlet]", ...args);
	}
}

if (typeof window !== "undefined" && !window.max) {
	window.maxSimulate = (name, ...args) => {
		const fn = handlers.get(name);
		if (fn) fn(...args);
		else console.warn(`[maxBridge] no handler bound for "${name}"`);
	};
	console.info("[maxBridge] running outside Max. Try: maxSimulate('tempo', 128)");
}
