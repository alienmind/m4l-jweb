/**
 * target.mjs - WHERE a device's logic runs, and what the patcher therefore contains.
 *
 * Until now there was one answer and it was wired into everything: the logic is a
 * React app inside `[jweb]`, so the patcher has a `[jweb]`, the `.amxd` carries a
 * base64 HTML payload, and every chain that wants to reach "the app" sends to that
 * box. A device could not opt out, and the library was named after the assumption.
 *
 * A TARGET is that assumption, made explicit and given a second value:
 *
 *   jweb       the device page runs in Max's embedded Chromium. React, Web Audio,
 *              Workers, a UI you can look at. What every device shipped before this.
 *   headless   there is no browser at all. The device declares its interface in
 *              TypeScript exactly as it does today - `defineSurface`, `defineControls`,
 *              `defineWatch` - and the build emits ONLY the `[js]` wrapper and the
 *              patcher. The device's own logic is `src/app/<device>/headless.ts`,
 *              compiled to ES5 and concatenated after the wrapper.
 *
 * ------------------------------------------------------------------------------
 * WHY HEADLESS IS WORTH A SEAM, and none of it is speculation (doc/TODO.md item 3):
 *
 *   - THE PAD TAKEOVER NEEDS NO BROWSER. The grab, the paint and the value observer
 *     are `live.object` / `live.observer` and `[js]`; the page was never in that path.
 *     A grid device's logic is a control plane, and `[js]` plus `Task` is a BETTER
 *     clock than a Chromium page nobody is looking at - the Worker in `push-snake`
 *     exists to dodge throttling that only a hidden page suffers.
 *   - AUDIO WITHOUT `[jweb~]` is a path this repo has already walked: bytes to disk,
 *     played through `[buffer~]`/`[groove~]`. Retired for ergonomics, not because it
 *     failed - and for a device holding two decoded FLACs the trade inverts, because
 *     half a gigabyte inside Chromium inside Live is not a thing `[buffer~]` suffers.
 *
 * ------------------------------------------------------------------------------
 * THE ONE THING THE SEAM IS: `ctx.appIn` and `ctx.appOut`.
 *
 * Every chain that reaches "the app" used to name `[jweb]`. Now it names the APP
 * ENDPOINT, which is `[jweb]` under one target and `[js]` under the other - and that
 * substitution is the whole port. A `[prepend notein]` feeds `ctx.appIn` either way; a
 * `[route midinote]` claims from `ctx.appOut` either way. Nothing else in the chain
 * vocabulary had to know.
 *
 * What headless GIVES UP is real and belongs here rather than in a surprise: no React
 * device view (native `live.*` objects only, which `defineSurface` already generates),
 * no Web Audio, no Workers, no floating windows, and ES5 in the emitted output.
 */
import { removeBox } from "./chains.mjs";

/** The `[jweb]` box the template ships. Only a jweb-target device has one. */
export const JWEB_ID = "obj-jweb";
/** The `[js]` box, which EVERY device has - it is the wrapper. */
export const JS_ID = "obj-js";

export const TARGETS = ["jweb", "headless"];

/** A device's target, defaulting to the one every device had before there was a choice. */
export function deviceTarget(d) {
  const target = d?.target ?? "jweb";
  if (!TARGETS.includes(target)) {
    throw new Error(`device "${d?.name}" declares target "${target}" - known targets are ${TARGETS.join(", ")}`);
  }
  return target;
}

export const isHeadless = (d) => deviceTarget(d) === "headless";

/**
 * Point the context's app endpoint at whatever this device's target is, and delete
 * what the other one would have needed.
 *
 * Called by `composePatcher` BEFORE any chain, for the same reason `openAudio` is:
 * a chain claims a stage in a stream it did not create, and it must not have to know
 * which target created it.
 *
 * THE HEADLESS CASE REMOVES `[jweb]` OUTRIGHT, both cords with it - the template's
 * `[js] -> [jweb]` and `[jweb] -> [js]`. A box left in place with nothing wired to it
 * would still load Chromium, which is the entire cost the target exists to avoid.
 *
 * `appOut` is seeded rather than left null for headless, because `claimAppMessages`
 * falls back to `[jweb]`'s outlet 2 when it is null - the one place the old assumption
 * was a literal.
 */
export function openApp(ctx) {
  const target = deviceTarget(ctx.device);

  if (target === "jweb") {
    ctx.target = "jweb";
    ctx.jwebId = JWEB_ID;
    ctx.appIn = JWEB_ID;
    // Left null on purpose: claimAppMessages reads [jweb]'s outlet 2 as the head of
    // the unclaimed stream, and asserts the template's cord to [js] is still there.
    ctx.appOut = null;
    return;
  }

  ctx.target = "headless";
  removeBox(ctx.boxes, ctx.lines, JWEB_ID);
  // Nothing may reach for `[jweb]` from here on. It is null rather than absent so the
  // few genuinely jweb-only things (the `webaudio` chain, a declared window, the
  // presentation rect applySurface gives the page) fail on a name rather than wire a
  // cord to a box that is not in the patcher.
  ctx.jwebId = null;
  ctx.appIn = JS_ID;
  // The wrapper's outlet 0 IS the app's outlet here: what a page would have sent
  // across the bridge, `[js]` sends out of the same port, into the same routes.
  ctx.appOut = [JS_ID, 0];
  // ...and there is nowhere to pass the unmatched tail ON to, because [js] is already
  // the far end. A route's unmatched outlet is simply left unconnected.
  ctx.unmatchedId = null;
}

/** The message a jweb-only feature should refuse a headless device with. */
export function refuseHeadless(ctx, what, instead) {
  return new Error(
    `device "${ctx.device?.name}" is target "headless", and ${what} needs the browser. ` +
      `${instead} Drop \`target: "headless"\` from patcher/devices.mjs, or drop ${what}.`,
  );
}
