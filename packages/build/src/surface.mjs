/**
 * surface.mjs - the Surface compiler.
 *
 * One declaration (`src/app/<device>/surface.ts`) becomes the whole Max side of a
 * parameter: the `live.*` object, its wiring in BOTH directions, and the protocol
 * selectors the lint then checks for free. It replaces `addParameters()` (which
 * only ever did the read direction) and `writableParams()` (which did the write
 * direction, by hand, for one parameter at a time).
 *
 * ------------------------------------------------------------------------------
 * THE TRAP THIS FILE EXISTS TO NOT REPRODUCE
 *
 * The app writes a parameter by sending `set_<id> <value>`, and the patcher feeds
 * the object a `set <value>` message. `set` updates the object WITHOUT making it
 * output - which is what stops the app feeding itself back in a loop.
 *
 * But `set` does not suppress the outlet for the app only. It suppresses it for
 * EVERYONE, including whatever that object drives inside the patcher. The first
 * `lowpass` chain fed its filter from the dial's outlet, and the app wrote the
 * dial with `set`: the dial moved, and the filter never heard a thing. The slider
 * looked dead.
 *
 * So a parameter's value is FANNED OUT, never chained:
 *
 *        [jweb] --set_cutoff--> [route] --+--> [prepend set] --> [live.dial] --+
 *                                         |                                    |
 *                                         +-------------> the DSP <------------+
 *                                                    (or whatever it drives)
 *
 * The object is updated in parallel, so automation, MIDI mapping and Push all stay
 * correct - but nothing downstream DEPENDS on it re-emitting. The object's own
 * outlet still reaches the same destination, because that is the path a knob turn,
 * an automation lane or a Push encoder travels.
 *
 * `paramValue()` below is the route outlet a chain taps for the app's write;
 * `paramObject()` is the object's own outlet. A chain that drives DSP from a
 * parameter must wire BOTH. `tests/surface.test.mjs` asserts it.
 * ------------------------------------------------------------------------------
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { box, claimAppMessages, line } from "./chains.mjs";

/** The one route that dispatches every `set_<id>` the app sends. */
export const SURFACE_ROUTE = "obj-surface-route";

/** The `live.*` object for a parameter. Its outlet is a knob turn / automation. */
export const paramObject = (id) => `obj-param-${id}`;

/**
 * The route outlet carrying the value the APP wrote - the fan-out tap.
 *
 * Deterministic from the declaration, so a chain can wire it before the route box
 * exists: a patcher is a graph, not a script, and a cord may name a box that
 * appears later in the array.
 */
export const paramValue = (surface, id) => [SURFACE_ROUTE, surface.ids.indexOf(id)];

/**
 * What a chain is handed to reach the parameters: `surface` (to check a parameter
 * it needs exists) and the two outlets it must fan a value out of. Spread into the
 * chain context by the build - and by the codegen test, so the test drives the
 * chains through the same seam the build does.
 */
export function surfaceContext(surface) {
  return {
    surface,
    paramObject: (id) => [paramObject(id), 0],
    paramValue: (id) => paramValue(surface, id),
  };
}

/* ------------------------------------------------------------------ *
 * Reading the declaration
 * ------------------------------------------------------------------ */

/**
 * Evaluate `src/app/<ui>/surface.ts` in Node.
 *
 * It is TypeScript, and it imports @m4l-jweb/surface, whose entry point is also
 * TypeScript - so it has to be bundled before it can be imported. esbuild does
 * that in milliseconds. `defineSurface()` returns plain serializable data, so
 * nothing exotic crosses the boundary.
 *
 * `format` is the exception: it is a FUNCTION, and functions do not serialize
 * into a patcher. It survives the import (this is a real module, not JSON) and is
 * used app-side only - by the dev harness and the Push preview. Do not try to
 * ship it into [js].
 */
export async function loadSurface(root, uiDir) {
  const src = path.join(root, "src", "app", uiDir, "surface.ts");
  if (!existsSync(src)) return null;

  const { build } = await import("esbuild");
  const tmp = mkdtempSync(path.join(tmpdir(), "m4l-surface-"));
  const out = path.join(tmp, "surface.mjs");
  try {
    await build({
      entryPoints: [src],
      outfile: out,
      bundle: true,
      format: "esm",
      platform: "node",
      logLevel: "silent",
      // React is not imported by a surface declaration, and bundling it here would
      // be both slow and pointless.
      external: ["react", "react-dom"],
    });
    const mod = await import(pathToFileURL(out).href);
    const surface = mod.default;
    if (!surface?.ids) {
      throw new Error(`${src} must \`export default defineSurface({...})\``);
    }
    return surface;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/* ------------------------------------------------------------------ *
 * Generating the objects
 * ------------------------------------------------------------------ */

const MAXCLASS = { dial: "live.dial", toggle: "live.toggle", menu: "live.menu" };

/**
 * Max's `parameter_type`: 0 = float, 1 = int, 2 = enum.
 *
 * A dial with `step: 1` is an INTEGER parameter - which matters to Live, not just
 * to us: an int parameter quantises automation and shows whole numbers on Push,
 * where a float one would read "2.4 of [off 1/4 1/8 ...]".
 */
function parameterType(spec) {
  if (spec.kind === "menu" || spec.kind === "toggle") return 2;
  return spec.step === 1 ? 1 : 0;
}

/**
 * `parameter_unitstyle` - HOW LIVE PRINTS THE VALUE, and the reason a perfectly
 * good float parameter can read "0" and "1" on a Push.
 *
 * The unit style is a display concern with no effect on the value, which is
 * exactly what makes it easy to get wrong and hard to notice: the dial sweeps
 * continuously, the DSP hears every intermediate value, and Push rounds the
 * readout to an integer because THAT is what unit style 0 means. Declare the unit
 * and the same knob reads "7.3 kHz".
 *
 * The order below is the order the unit styles are listed in Max's own reference
 * (docs/refpages/m4l-ref/parameters.maxref.xml), and 3 = Hertz is confirmed
 * against the factory devices that ship with Live: every parameter named
 * "Frequency" / "Master Freq" carries `parameter_unitstyle: 3`.
 */
const UNITSTYLE = {
  int: 0,
  float: 1,
  ms: 2,
  Hz: 3,
  dB: 4,
  "%": 5,
  pan: 6,
  st: 7,
  midi: 8,
  // 9 = Custom (takes parameter_units), 10 = Native.
};
const UNITSTYLE_CUSTOM = 9;

/**
 * A dial's unit. No `unit` means "just a number": integer if the parameter is an
 * integer, float otherwise - because the default, 0, prints a float as a rounded
 * integer.
 */
function unitAttrs(spec) {
  if (!spec.unit) return { parameter_unitstyle: spec.step === 1 ? UNITSTYLE.int : UNITSTYLE.float };
  const known = UNITSTYLE[spec.unit];
  if (known !== undefined) return { parameter_unitstyle: known };
  // Anything else is a custom unit: Live prints the number and appends the string
  // (or honours a sprintf pattern, e.g. "%0.2f Bogons").
  return { parameter_unitstyle: UNITSTYLE_CUSTOM, parameter_units: spec.unit };
}

/** The parameter's value as MAX stores it: numbers, always. */
function initialValue(spec) {
  if (spec.kind === "toggle") return spec.default ? 1 : 0;
  if (spec.kind === "menu") return spec.options.indexOf(spec.default);
  return spec.default;
}

/**
 * The `saved_attribute_attributes.valueof` block, in the shape Max itself writes.
 *
 * THE RANGE IS `parameter_mmin` / `parameter_mmax`, NOT `parameter_range`. This
 * cost a device: we emitted `parameter_range: [0, 1]` for a long time, and it is
 * not a key Max uses for a continuous parameter - so the range was whatever the
 * object defaulted to, silently. `parameter_range` appears in exactly zero of the
 * patchers Ableton ships. An enum's options are `parameter_enum`, with
 * `parameter_mmax` holding the highest index.
 */
function parameterAttrs(id, spec) {
  const attrs = {
    parameter_longname: id,
    parameter_shortname: spec.short,
    parameter_type: parameterType(spec),
    // `parameter_initial` is a LIST, and it is INERT without
    // parameter_initial_enable - setting one without the other silently does
    // nothing, which is the worst way for this to fail. A live.* object with no
    // initial value loads at the BOTTOM of its range, and for a filter cutoff the
    // bottom of the range is a device that eats the signal on load.
    parameter_initial_enable: 1,
    parameter_initial: [initialValue(spec)],
  };

  if (spec.kind === "dial") {
    const [min, max] = spec.range;
    attrs.parameter_mmin = min;
    attrs.parameter_mmax = max;
    Object.assign(attrs, unitAttrs(spec));
    // `parameter_exponent` bends the knob's travel: > 1 gives the bottom of the
    // range more of the sweep, which is what a frequency or a time wants, because
    // hearing is logarithmic and a linear sweep spends its travel where nothing
    // happens. The VALUE is unaffected - only how the dial's rotation maps onto it.
    if (spec.exponent !== undefined && spec.exponent !== 1) attrs.parameter_exponent = spec.exponent;
    // `parameter_steps` quantises a continuous range into N settings.
    if (spec.steps !== undefined) attrs.parameter_steps = spec.steps;
  }

  if (spec.kind === "toggle") {
    attrs.parameter_mmax = 1;
    attrs.parameter_enum = ["off", "on"];
  }

  if (spec.kind === "menu") {
    attrs.parameter_enum = [...spec.options];
    attrs.parameter_mmax = spec.options.length - 1;
  }

  return attrs;
}

/**
 * Compile the Surface into the patcher.
 *
 * Runs AFTER the chains, and claims what they did not want: the app's `set_<id>`
 * messages are picked off the stream, and everything else carries on to the
 * wrapper. Doing it last means no chain has to know the Surface exists.
 */
export function applySurface(ctx) {
  const { boxes, lines, surface, jwebId } = ctx;
  if (!surface || surface.ids.length === 0) return;

  let x = 480;
  for (const id of surface.ids) {
    const spec = surface.params[id];
    boxes.push({
      box: {
        id: paramObject(id),
        maxclass: MAXCLASS[spec.kind],
        numinlets: 1,
        numoutlets: 1,
        outlettype: [""],
        parameter_enable: 1,
        patching_rect: [x, 300, 44, 48],
        saved_attribute_attributes: { valueof: parameterAttrs(id, spec) },
      },
    });
    // Read direction: a knob turn reaches the app as `<id> <value>`. A parameter
    // is just another inlet message.
    boxes.push(box(`obj-prepend-${id}`, `prepend ${id}`));
    lines.push(line(paramObject(id), 0, `obj-prepend-${id}`, 0));
    lines.push(line(`obj-prepend-${id}`, 0, jwebId, 0));
    x += 56;
  }

  // Write direction: one route for every `set_<id>` the app can send. It goes at
  // the END of the chain of routes (see claimAppMessages), so a chain that already
  // took [jweb]'s outlet keeps it and hands us what it did not match.
  const selectors = surface.ids.map((id) => `set_${id}`);
  boxes.push(
    box(SURFACE_ROUTE, `route ${selectors.join(" ")}`, {
      numoutlets: surface.ids.length + 1,
      outlettype: surface.ids.map(() => "").concat(""),
    }),
  );
  claimAppMessages(ctx, SURFACE_ROUTE, surface.ids.length);

  surface.ids.forEach((id, i) => {
    // `route` STRIPS the selector, so what emerges is the bare value. Re-wrap it as
    // `set <value>` - the set-WITHOUT-output message - so the object, the automation
    // lane and Push all follow the app's control without echoing back at it.
    boxes.push(box(`obj-set-${id}`, "prepend set"));
    lines.push(line(SURFACE_ROUTE, i, `obj-set-${id}`, 0));
    lines.push(line(`obj-set-${id}`, 0, paramObject(id), 0));
  });
}
