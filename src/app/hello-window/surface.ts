/**
 * A device with a FLOATING WINDOW - a second page, in a window of its own.
 *
 * The device view in Live is fixed at ~169 px tall and does not scroll, so a UI
 * that needs room has nowhere to grow. A declared window compiles to a subpatcher
 * holding its own [jweb] and a [pcontrol] that opens it, and `entry` names the
 * component it bundles - here Window.tsx, a page separate from App.tsx.
 */
import { defineSurface, state, window } from "@m4l-jweb/surface";

export default defineSurface({
  params: {},
  banks: [],
  // A state slot the WINDOW reads and writes. It proves the window's [jweb] can
  // now talk back to [js]: the window edits `note`, the wrapper writes it into the
  // shared [dict], and it survives a save - the same slot the device view sees.
  state: {
    note: state({ default: { text: "" } }),
  },
  windows: {
    testWindow: window({ title: "My Floating Window", width: 400, height: 300, entry: "Window" }),
  },
});
