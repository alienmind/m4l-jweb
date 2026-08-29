/**
 * controls.mjs - the build side of defineControls().
 *
 * The fourth of the same pipeline (surface.mjs, watch.mjs, files.mjs), and like
 * files.mjs it produces BOTH kinds of output: a patcher CHAIN and a data banner.
 * The declaration itself rides on the Surface - `defineSurface({ controls })` - so
 * there is nothing to import here that `loadSurface()` has not already loaded.
 *
 * ------------------------------------------------------------------------------
 * WHERE THE WORK LIVES, and why it is split where it is.
 *
 * doc/TODO.md asked for discovery, grab, release and the value observer in
 * the chain, with the frame diff and `send_value` in the wrapper. The line moved,
 * and it moved for one reason: EVERY MEASURED FACT ABOUT THIS API WAS MEASURED
 * THROUGH `[js]`. `push-probe` resolved the surface, grabbed by name, painted and
 * observed from LiveAPI in the wrapper, and doc/MAX-FACTS.md's numbers are that
 * path's numbers. A patcher rewrite of the same steps is unmeasured code in an API
 * that reports NOTHING when it is wrong - so the parts that only [js] can do at all
 * stayed in [js], and the part the constraint is actually about moved out of it:
 *
 *   the chain     THE INPUT PATH. One `[live.observer value]` per declared control,
 *                 straight into `[jweb]`. A press crosses no [js] at all. Plus the
 *                 two takeover parameters, tapped into [js] so the grab follows the
 *                 dial even with the page closed or dead.
 *
 *   the wrapper   discovery (walking `live_app`'s `control_surfaces` is a LOOP, and
 *                 a loop in a patcher is [uzi] + [zl] that nothing can test without
 *                 the hardware), resolving each role against `get_control_names`,
 *                 grab, release, the focus policy, the frame buffer and its per-cell
 *                 diff, and `send_value`.
 *
 * The constraint that carries a failure mode - a grabbed pad must not wait on
 * anything the page is doing - is met. The constraint that was a preference is not,
 * and this comment is the record of the trade rather than a silent divergence.
 * ------------------------------------------------------------------------------
 */
import { box, fanParamInto, line } from "./chains.mjs";

/** Must match FOCUS_OPTIONS in @m4l-jweb/surface - the menu's value is its index. */
const FOCUS_OPTIONS = ["Device", "Track", "Always"];

/** The chain that owns the observers. Every device that declares controls needs it. */
export const CONTROLS_CHAIN = "takeover";

/** The parameters defineControls() contributes. Must match TAKEOVER_PARAM / FOCUS_PARAM in @m4l-jweb/surface. */
export const TAKEOVER_PARAM = "takeover";
export const FOCUS_PARAM = "focus";

/**
 * The chain list this device is actually built with.
 *
 * A device that declares controls gets `takeover` whether or not the manifest asked
 * for it, appended LAST for the same reason `download` is: it claims no stage of the
 * signal path, but chain order IS the signal path and inserting anywhere else would
 * silently re-route a device that merely started using the pads.
 *
 * Idempotent - a manifest that lists it keeps exactly one, since running the chain
 * twice emits the same box ids twice and assertUniqueBoxIds rejects that.
 */
export function withControlsChain(chains, surface) {
  const declared = chains ?? [];
  if (!surface?.controls) return declared;
  return declared.includes(CONTROLS_CHAIN) ? declared : [...declared, CONTROLS_CHAIN];
}

/**
 * The `var CONTROLS_SPEC = {...}` banner prepended to a device's wrapper.js.
 *
 * Only what the wrapper ACTS on travels: the key (which is the selector suffix and
 * the argument the chain routes on), the kind, the size of the frame buffer, and the
 * CANDIDATE NAMES to resolve the role against. The role name itself rides along
 * because it is what a console line has to say when a role does not resolve, and
 * "matrix" is what the device author wrote.
 *
 * A device with no declaration gets no banner ("") - `typeof CONTROLS_SPEC ===
 * "undefined"` is exactly the guard the wrapper checks.
 */
export function controlsSpecBanner(surface) {
  const controls = surface?.controls;
  if (!controls) return "";
  const spec = {
    surface: controls.surface,
    /**
     * The declared `focus` default, as the menu INDEX Max stores it as.
     *
     * The wrapper needs it because a `live.menu` does not necessarily announce its
     * value at load - and a wrapper that assumed 0 would treat a device declared
     * `Track` as `Device` until somebody touched the menu, which is a takeover that
     * silently does not happen on a track the user has selected.
     */
    focus: FOCUS_OPTIONS.indexOf(controls.defaultFocus),
    controls: controls.keys.map((key) => {
      const c = controls.controls[key];
      return {
        key,
        kind: c.kind,
        role: c.role,
        rows: c.kind === "grid" ? c.rows : 1,
        cols: c.kind === "grid" ? c.cols : 1,
        // Stamped onto the spec by defineControls() from its own ROLE_NAMES table,
        // so this file never reimplements it. See ControlBase in controls.ts.
        names: c.names ?? [],
      };
    }),
  };
  return `var CONTROLS_SPEC = ${JSON.stringify(spec)};\n`;
}

/** The per-key selector the wrapper addresses the chain with: `tk_<key> id <n>`. */
export const controlIdSelector = (key) => `tk_${key}`;

/**
 * "takeover" - the pads' INPUT PATH, and the two parameters that switch it on.
 *
 * ```
 *   [js] outlet 1 -> [route tk_pads ...] -> id <n> -> right inlet of
 *                                                    [live.observer value]
 *                                                          |
 *                                       [prepend pad_pads] -+
 *                                                          |
 *                                                       [jweb]
 * ```
 *
 * THE OBSERVER IS THE WHOLE POINT OF THE CHAIN. A press reaches the page through
 * `[live.observer]` -> `[prepend]` -> `[jweb]` and touches no [js] on the way, so the
 * one thing that must never queue behind anything else does not.
 *
 * `live.observer`'s LEFT OUTLET CARRIES THE VALUE AND NOTHING ELSE - read off Max's
 * own reference on disk (`refpages/m4l-ref/live.observer.maxref.xml`: "The left
 * outlet is reserved for value messages, all other output is sent to the right
 * outlet"), which is NOT the shape [js] sees. A [js] callback is handed
 * `["value", ...]`; this is the atoms alone. The page is written against the atoms.
 *
 * ...and it fires ONCE ON ATTACH, with the property's current value, which for a
 * control nobody has touched is not a press. That reaches the page as a `pad_<key>`
 * with no arguments and `padStore` drops it on arity - the same trap the probe hit
 * as a press at (undefined, undefined).
 *
 * THE TWO PARAMETERS ARE TAPPED INTO `[js]`, not read out of the page. `takeover`
 * decides whether this device holds the hardware, and a device whose grid dies
 * because its Chromium view is closed is a device that fails exactly when the user
 * is looking at the Push instead of the screen. `fanParamInto` wires BOTH of a
 * parameter's sources - the object's own outlet (a knob turn, an automation lane,
 * Push) and the route outlet carrying what the app wrote - because the app's write
 * reaches the object as `set`, which updates it without producing output.
 */
export function takeoverChain(ctx) {
  const { boxes, lines, appIn, surface, device } = ctx;
  // The wrapper's own box, not `ctx.unmatchedId` - which is null under the headless
  // target, where there is no separate far end to pass a tail on to. The id for the
  // observer comes off [js]'s AUX outlet either way.
  const jsId = "obj-js";
  const controls = surface?.controls;
  if (!controls) {
    throw new Error(
      `chain "${CONTROLS_CHAIN}" on device "${device?.name}" needs a defineControls() declaration - ` +
        `pass it to defineSurface({ ..., controls }) in src/app/${device?.ui ?? device?.name}/surface.ts.`,
    );
  }
  for (const id of [TAKEOVER_PARAM, FOCUS_PARAM]) {
    if (!surface.params?.[id]) {
      throw new Error(
        `chain "${CONTROLS_CHAIN}" on device "${device?.name}" expected the generated parameter "${id}". ` +
          `defineSurface() adds it when a \`controls\` declaration is present - this surface has ${surface.ids.join(", ") || "none"}.`,
      );
    }
  }

  const keys = controls.keys;
  const routeId = "obj-tk-route";

  // [js]'s AUX outlet, the same one the `download` chain takes [maxurl]'s requests
  // from. Two routes hang off it in parallel and that is safe here where it is not
  // safe on [jweb]'s outlet: neither of them forwards what it did not match, so a
  // message is delivered once or dropped, never twice.
  boxes.push(
    box(routeId, `route ${keys.map(controlIdSelector).join(" ")}`, {
      numoutlets: keys.length + 1,
      outlettype: keys.map(() => "").concat(""),
    }),
  );
  lines.push(line(jsId, 1, routeId, 0));

  keys.forEach((key, i) => {
    const obs = `obj-tk-obs-${key}`;
    const tag = `obj-tk-pad-${key}`;
    boxes.push(box(obs, "live.observer value", { numinlets: 2, numoutlets: 2, outlettype: ["", ""] }));
    // The RIGHT inlet takes `id <n>` - the reference is explicit that the id goes
    // there, and [route] has already stripped the `tk_<key>` word by the time it
    // arrives, leaving exactly that message.
    lines.push(line(routeId, i, obs, 1));
    boxes.push(box(tag, `prepend pad_${key}`));
    lines.push(line(obs, 0, tag, 0));
    // The APP endpoint. Under the default target a press lands in the page with no
    // [js] in the way; under headless the page is not there and it lands in [js],
    // which is where the game already was.
    lines.push(line(tag, 0, appIn, 0));
  });

  for (const [param, selector] of [
    [TAKEOVER_PARAM, "controls_takeover"],
    [FOCUS_PARAM, "controls_focus"],
  ]) {
    const id = `obj-tk-${param}`;
    boxes.push(box(id, `prepend ${selector}`));
    lines.push(line(id, 0, jsId, 0));
    fanParamInto(ctx, param, id, 0);
  }
}
