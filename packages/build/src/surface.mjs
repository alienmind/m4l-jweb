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

/* ------------------------------------------------------------------ *
 * Native declarative layout (surface `layout.native`)
 *
 * A parameter listed in `layout.native` renders as a native `live.*` object IN
 * THE DEVICE VIEW, next to a `[jweb]` shifted right to make room. This is a pure
 * PRESENTATION overlay: the dial the compiler already emits gains three keys
 * (`presentation`, `presentation_rect`, `varname`) and nothing about its wiring,
 * its fan-out or the app's `set_<id>` route changes. A dial that carries no rect
 * is exactly today's invisible object.
 * ------------------------------------------------------------------ */

// The device view Live gives an M4L device. Height is fixed at ~169 px; the width
// is whatever the presentation content needs, which is the whole mechanism this
// relies on (Live recomputes device width from the presentation rects).
const DEVICE_H = 169;
const MARGIN = 8;
// Per-kind native sizes, from Max's own live.* defaults. A live.dial includes its
// own label under the knob, which is why it is taller than a bare toggle.
const NATIVE_SIZE = { dial: [44, 48], toggle: [44, 15], menu: [100, 15] };
// Vertical pitch: a dial is 48 px tall and wants 8 px of air beneath its label.
const PITCH_Y = 56;

/**
 * `id -> presentation_rect` for every native parameter, plus the zone's total
 * width (how far `[jweb]` shifts right). A pure function of the declaration, so
 * `tests/` can drive it directly.
 *
 * Column-major: fills `rows` down the first column, then starts a new column to
 * the right. Adding a parameter at the end therefore never reshuffles the ones
 * before it - the reading order stays stable.
 */
export function computeNativeSlots(surface) {
  const native = surface?.layout?.native;
  if (!native || native.params.length === 0) return { slots: new Map(), width: 0 };
  const rows = native.rows ?? 3;
  const slots = new Map();
  let row = 0;
  let colW = 0;
  let x = MARGIN;
  for (const id of native.params) {
    const [w, h] = NATIVE_SIZE[surface.params[id].kind];
    if (row >= rows) {
      // Column full: step right by the widest box in the column just finished.
      row = 0;
      x += colW + MARGIN;
      colW = 0;
    }
    slots.set(id, [x, MARGIN + row * PITCH_Y, w, h]);
    colW = Math.max(colW, w);
    row += 1;
  }
  return { slots, width: x + colW + MARGIN };
}

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

  // Where the native dials go, if any were declared. `slots` is empty for a
  // surface with no `layout`, and then this whole feature is inert - a param
  // carries no presentation rect and stays the invisible object it is today.
  const { slots, width: nativeW } = computeNativeSlots(surface);

  let x = 480;
  for (const id of surface.ids) {
    const spec = surface.params[id];
    const rect = slots.get(id);
    boxes.push({
      box: {
        id: paramObject(id),
        maxclass: MAXCLASS[spec.kind],
        numinlets: 1,
        numoutlets: 1,
        outlettype: [""],
        parameter_enable: 1,
        patching_rect: [x, 300, 44, 48],
        // A native param is shown in the device view: it gets a presentation rect
        // and a scripting name (prefixed `param-` so it cannot collide with a state
        // dict's `obj-state-<id>` varname). Everything else about the box - the
        // wiring below, the fan-out, useParam() - is UNCHANGED. Presentation is
        // purely a display overlay on the same graph.
        ...(rect ? { presentation: 1, presentation_rect: rect, varname: `param-${id}` } : {}),
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

  // Shift [jweb] right by the native zone's width, so the dials sit to its left.
  // WIDTH IS PRESERVED: the device gets wider, the web view does not get narrower
  // (React layouts were built for 420 px). A surface with no native params has
  // nativeW === 0 and leaves [jweb] exactly where the template put it.
  if (nativeW > 0) {
    const jweb = boxes.find((b) => b.box.id === jwebId)?.box;
    if (jweb) {
      const [, py, pw, ph] = jweb.presentation_rect ?? [0, 0, 420, DEVICE_H];
      jweb.presentation_rect = [nativeW, py, pw, ph];
    }
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

/**
 * Runtime show/hide of native dials - the `layout.native` visibility override.
 *
 * `layout.native` makes a parameter a native `live.*` object, and its presentation
 * is STATIC: `presentation: 1` is stamped into the .amxd at build time, so every
 * listed dial is always visible. A device like the fx line wants the opposite - a
 * stage the current line does not name should not clutter the view, the way its old
 * HTML slider was simply not rendered. React can hide a slider; a native object
 * cannot hide itself, so the app drives it from outside via `native_show`/
 * `native_hide <varname>` (useNativeVisibility).
 *
 * ------------------------------------------------------------------------------
 * THIS IS A SPIKE, and its FIRST mechanism already FAILED IN LIVE.
 *
 * Attempt 1 (this codegen, now retired): a `[thispatcher]` running `script hide
 * <varname>`. Verified in Live - the dials did NOT disappear. `script hide` acts on
 * the PATCHING canvas; the M4L device view is the PRESENTATION, and `script` has no
 * documented reach into it.
 *
 * Attempt 2 (current): the wrapper's [js] handles `native_show`/`native_hide` and
 * manipulates the object through the Maxobj API (`this.patcher.getnamed(varname)`),
 * with console diagnostics. So this codegen no longer claims the messages - it lets
 * them fall through to the wrapper. See `native_show`/`native_hide` in core.ts.
 *
 * If attempt 2 also fails to reach the presentation, the honest conclusion is that a
 * frozen M4L device cannot hide a native object at runtime, and the fallback is a
 * build-time choice (fewer native params, or a device keeps HTML controls).
 * ------------------------------------------------------------------------------
 */

/**
 * Compile a declared `window` into the patcher: a subpatcher holding its own
 * [jweb], and a [pcontrol] that opens it when the app asks.
 *
 *   [jweb] -> [route window_x_open window_x_close] -> [t b] -> [open( -> [pcontrol] -> [p Title]
 *
 * ------------------------------------------------------------------------------
 * A MAXCLASS IS NOT A NAME YOU INVENT, and that is what was broken here.
 *
 * This generated the open/close message boxes as `newobj` with the TEXT "open"
 * and "wclose", and the [pcontrol] as a box with `maxclass: "pcontrol"`. Neither
 * is a thing:
 *
 *   - `newobj` means "an object box", and its text names the object. There is no
 *     Max object called `open`, so what got built was a BROKEN box - the dashed
 *     outline you would see instantly in the Max editor, and see nothing of here.
 *     A message box is `maxclass: "message"` with the message in `text`
 *     (chains.mjs's [flush( does this - copy that, do not reinvent it).
 *   - `pcontrol` is an object, not a box class: `maxclass: "newobj"`,
 *     `text: "pcontrol"`. A box with an unknown maxclass does not instantiate.
 *
 * A patcher full of broken boxes still LOADS, keeps its cords, and does nothing.
 * That is why the message reached [jweb]'s outlet, the route matched, and the
 * window never opened - and why the failure was misread as `[route]` refusing to
 * match jweb's output. The route was fine. It was firing into a box that had
 * failed to exist.
 * ------------------------------------------------------------------------------
 */
export function applyWindows(ctx) {
  const { boxes, lines, surface, unmatchedId } = ctx;
  const windowIds = surface?.windows ? Object.keys(surface.windows) : [];
  if (windowIds.length === 0) return;

  const selectors = windowIds.flatMap((id) => [`window_${id}_open`, `window_${id}_close`]);

  const routeId = "obj-windows-route";
  boxes.push(
    box(routeId, `route ${selectors.join(" ")}`, {
      numoutlets: selectors.length + 1,
      outlettype: selectors.map(() => "").concat(""),
    }),
  );
  // IN SERIES, like every other claimant of the app's message stream. Hanging this
  // route off [jweb] in parallel (which it did) leaves two paths to [js], so the
  // wrapper sees every unrouted message - `ui_ready` included - twice.
  claimAppMessages(ctx, routeId, selectors.length);

  windowIds.forEach((id, index) => {
    const spec = surface.windows[id];

    // `route` STRIPS the selector, so `window_x_open 1` emerges as a bare `1`. A
    // message box would try to interpret that as its own argument, so bang it
    // instead: [t b] makes the trigger unambiguous whatever the app sent.
    //
    // The words are [pcontrol]'s: `open` and `close`. NOT `wclose` - that is
    // [thispatcher]'s vocabulary, and pcontrol says so out loud
    // ("pcontrol: doesn't understand \"wclose\""), which is the one thing an
    // unrecognised NAME usually does not do. See pcontrol.maxref.xml.
    for (const [outlet, verb, tag] of [
      [index * 2, "open", "open"],
      [index * 2 + 1, "close", "close"],
    ]) {
      const triggerId = `obj-window-${id}-t-${tag}`;
      const msgId = `obj-window-${id}-${tag}msg`;
      boxes.push(box(triggerId, "t b"));
      // A MESSAGE box: maxclass "message", the message in `text`. Not a newobj.
      boxes.push(box(msgId, verb, { maxclass: "message", numinlets: 2, numoutlets: 1 }));
      lines.push(line(routeId, outlet, triggerId, 0));
      lines.push(line(triggerId, 0, msgId, 0));
      lines.push(line(msgId, 0, `obj-window-${id}-pcontrol`, 0));
    }

    // [pcontrol] is the supported way to open a subpatcher's window from outside
    // it. `open` shows it, `wclose` hides it.
    const pcontrolId = `obj-window-${id}-pcontrol`;
    boxes.push(box(pcontrolId, "pcontrol"));

    const subpatcherId = `obj-window-${id}-sub`;
    lines.push(line(pcontrolId, 0, subpatcherId, 0));
    // The window's [jweb] can now TALK BACK. Its output leaves the subpatcher on an
    // [outlet] and this cord carries it to the wrapper's [js] - the same [js] the
    // device view feeds. It is tagged `window <id>` inside (below), so the wrapper
    // tells the two apart and can answer the right one. Without this the window's
    // page could display but never send a message: the [jweb] outlet went nowhere.
    lines.push(line(subpatcherId, 0, unmatchedId, 0));
    boxes.push({
      box: {
        id: subpatcherId,
        maxclass: "newobj",
        text: `p ${spec.title}`,
        // The inlet is not decoration: Max will not connect a patch cord to a
        // subpatcher that has no inlets, so [pcontrol] would end up wired to
        // NOTHING - silently, in the saved file. That was attempt 1.
        numinlets: 1,
        numoutlets: 1,
        outlettype: [""],
        patching_rect: [16, 620, 120, 22],
        patcher: {
          fileversion: 1,
          appversion: { major: 8, minor: 0, revision: 0, architecture: "x64", modernui: 1 },
          rect: [100, 100, spec.width, spec.height],
          openinpresentation: 1,
          boxes: [
            { box: { id: "obj-in", maxclass: "inlet", patching_rect: [16, 16, 30, 30], numinlets: 0, numoutlets: 1, outlettype: [""] } },
            // The page's URL cannot be WIRED here - this [jweb] is inside a
            // subpatcher and the wrapper's [js] is outside it. The wrapper reaches
            // it by NAME instead (messnamed), once the payload is extracted.
            {
              box: {
                id: "obj-recv",
                maxclass: "newobj",
                text: `r window-read-${id}`,
                numinlets: 0,
                numoutlets: 1,
                outlettype: [""],
                patching_rect: [16, 56, 160, 22],
              },
            },
            {
              box: {
                id: "obj-jweb",
                maxclass: "jweb",
                numinlets: 1,
                numoutlets: 2,
                outlettype: ["", ""],
                patching_rect: [16, 96, spec.width, spec.height],
                presentation: 1,
                presentation_rect: [0, 0, spec.width, spec.height],
              },
            },
            // TAG the window's messages with which window they are, so the wrapper's
            // `window()` can answer THIS window (its [jweb] has no cord from [js], so
            // a reply goes back by name). The page emits bare selectors; the tag is
            // added here, in the patcher, not in the app - so a window page is an
            // ordinary bridge client that happens to be in its own runtime.
            {
              box: {
                id: "obj-tag",
                maxclass: "newobj",
                text: `prepend window ${id}`,
                numinlets: 1,
                numoutlets: 1,
                outlettype: [""],
                patching_rect: [16, 96 + spec.height + 16, 160, 22],
              },
            },
            { box: { id: "obj-out", maxclass: "outlet", patching_rect: [16, 96 + spec.height + 48, 30, 30], numinlets: 1, numoutlets: 0 } },
          ],
          lines: [
            { patchline: { source: ["obj-recv", 0], destination: ["obj-jweb", 0] } },
            // [jweb] outlet 0 is the page's messages; tag them and send them out.
            { patchline: { source: ["obj-jweb", 0], destination: ["obj-tag", 0] } },
            { patchline: { source: ["obj-tag", 0], destination: ["obj-out", 0] } },
          ],
        },
      },
    });
  });
}

/**
 * Compile a declared `state` slot: a named [dict] the app reads and writes, and a
 * [pattr] bound to it, which is what actually SAVES.
 *
 * ------------------------------------------------------------------------------
 * WHAT MAKES LIVE SAVE IT IS `parameter_enable`, and nothing else.
 *
 * A pattr on its own persists in a PATCHER. A Max for Live device is not saved as a
 * patcher - Live saves the SET - so the pattr's value goes with it only when the
 * pattr is a Live parameter. Max's own pattr help says so in one line:
 *
 *   "In Max for Live, if you activate the parameter_enable attribute, the pattr
 *    value will be saved with the Live set."
 *
 * The first version of this emitted `@save 1`, which is not a pattr attribute at
 * all ("pattr: 'save' is not a valid attribute argument"), and `@autorestore 1`,
 * which restores from the PATCHER and so does nothing here. The state survived a
 * reload of the page and would not have survived a reload of the set.
 *
 * The recipe below is copied from a device Ableton ships - `pattr Delays` in
 * "Max DelayTaps.amxd", which persists an array of tap times exactly this way:
 *
 *   parameter_type 3       BLOB. Not a float, not an enum - an opaque value Live
 *                          stores and hands back, which is the whole point: JSON is
 *                          not a number and must never pretend to be one.
 *   parameter_invisible 1  ...so it stays out of the automation lane and off Push.
 *                          A blob cannot be automated, and a slot that offered to be
 *                          would be a lie in every Live UI that listed it.
 *   parameter_enable 1     in saved_object_attributes - the switch itself.
 *
 * `dict` is an OBJECT (`maxclass: "newobj"`, text `dict <name>`), not a box class.
 * It was emitted as `maxclass: "dict"` - a box class Max does not have, so the box
 * never instantiated and the pattr bound to nothing. Same mistake as the windows,
 * same silence.
 * ------------------------------------------------------------------------------
 */
export function applyPersistence(ctx) {
  const { boxes, surface } = ctx;
  const stateIds = surface?.state ? Object.keys(surface.state) : [];

  for (const id of stateIds) {
    const dictId = `obj-state-${id}`;
    // `varname` is the SCRIPTING name, which is what [pattr]'s @bindto resolves -
    // it binds to a NAMED object in the patcher, not to a box id (which is ours, and
    // which Max is free to renumber). The dict's own name argument is what [js]
    // addresses with `new Dict("obj-state-<id>")`, so all three agree.
    boxes.push(box(dictId, `dict ${dictId}`, { varname: dictId, numinlets: 2, numoutlets: 4, outlettype: ["dictionary", "", "", ""] }));

    const pattrId = `obj-pattr-${id}`;
    boxes.push(
      box(pattrId, `pattr ${pattrId} @bindto ${dictId}`, {
        numinlets: 2,
        numoutlets: 3,
        outlettype: ["", "", ""],
        varname: pattrId,
        saved_attribute_attributes: {
          valueof: {
            parameter_longname: pattrId,
            // Live truncates a short name at 8 characters (see the parameter
            // compiler above), and it is never displayed for an invisible blob -
            // but it must still be there and still be unique.
            parameter_shortname: `st_${id}`.slice(0, 8),
            parameter_type: 3, // blob
            parameter_invisible: 1,
          },
        },
        saved_object_attributes: {
          parameter_enable: 1, // THE switch: no parameter, no save.
        },
      }),
    );
  }
}
