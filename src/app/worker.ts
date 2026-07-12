/**
 * worker.ts - optional compute worker (inlined into the single-file build).
 *
 * The place for anything that must not fight the UI thread: sequencers,
 * analyzers, DSP-adjacent math. Dedicated workers are also exempt from the
 * timer throttling Chromium applies to hidden pages - and a device's view is
 * often not visible.
 *
 * This hello-world worker just counts the transport ticks it is fed and posts
 * the running total back. Replace it with your own message-driven engine
 * (Live pushes time in, you push events out) and delete it if you do not need
 * a worker at all.
 */

let ticks = 0;

self.onmessage = (e: MessageEvent) => {
	const [type] = e.data as [string, ...unknown[]];
	if (type === "tick") {
		ticks += 1;
		self.postMessage(["ticks", ticks]);
	} else if (type === "reset") {
		ticks = 0;
		self.postMessage(["ticks", ticks]);
	}
};
