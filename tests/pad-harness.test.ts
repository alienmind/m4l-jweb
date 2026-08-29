/**
 * pad-harness.test.ts - the mocked 8x8 grid, rendered.
 *
 * The mock's whole value is that it exercises the REAL contract in both directions,
 * so a test that reached into the component would be checking the wrong thing. These
 * two go through the bridge instead:
 *
 *   a click on the mock's bottom-left cell must reach a device's `onPad` as (0, 0);
 *   a device's `draw()` at (0, 0) must colour that same cell.
 *
 * Which is the y flip, from both ends, with the actual DOM in between - the one bug in
 * this feature that is invisible on hardware until you notice the picture is upside
 * down.
 *
 * `createElement` rather than JSX, so this file needs no build-config change: the root
 * vitest.config.ts is copied byte-for-byte into the `m4l-jweb init` template, and
 * teaching it a JSX runtime for one test would change every scaffolded repo.
 *
 * @vitest-environment happy-dom
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test } from "vitest";

import { defineControls, defineSurface, grid, PALETTE_CSS, toggle } from "@m4l-jweb/surface";
import { padStore } from "@m4l-jweb/surface/pads";
import { DevHarness } from "@m4l-jweb/surface/dev";

const controls = defineControls({ surface: "push", controls: { pads: grid({ role: "matrix", rows: 8, cols: 8 }) } });
const surface = defineSurface({ controls, params: { running: toggle({ default: false, short: "Run" }) } });

// React refuses to run act() outside an "act environment" and says so on every call.
// Setting the flag is the documented way to declare one; without it the output is
// eight warnings per render and the failures they would hide.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLElement | null = null;
afterEach(() => {
  host?.remove();
  host = null;
});

function render(): HTMLButtonElement[] {
  host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  // The harness takes `Surface<Record<string, ParamSpec>>`, and a surface with the
  // takeover pair folded in is a narrower object type that TypeScript will not widen
  // to it. src/main.tsx casts at the same seam and for the same reason.
  act(() => root.render(createElement(DevHarness, { surface: surface as never })));
  // The 64 cells of the declared 8x8, in HARDWARE order: index 0 is the top-left.
  const cells = [...host.querySelectorAll("button")].filter((b) => b.title?.startsWith("x "));
  expect(cells).toHaveLength(64);
  return cells as HTMLButtonElement[];
}

test("a click on the bottom-left cell reaches the device as (0, 0)", () => {
  const cells = render();
  const seen: { x: number; y: number; down: boolean }[] = [];
  padStore(controls).onPad("pads", (e) => seen.push({ x: e.x, y: e.y, down: e.down }));

  // The last row of the rendered grid is the BOTTOM of the Push.
  const bottomLeft = cells[56];
  expect(bottomLeft.title).toBe("x 0 y 0");
  act(() => {
    bottomLeft.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    bottomLeft.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });

  expect(seen).toEqual([
    { x: 0, y: 0, down: true },
    { x: 0, y: 0, down: false },
  ]);
});

test("...and a draw() at (0, 0) colours that same cell", () => {
  const cells = render();
  act(() => padStore(controls).draw("pads", (f) => f.set(0, 0, "green")));

  // The mock renders exactly what was SENT, so a device that flipped y twice would
  // light the top-left here - and on the hardware.
  expect(cells[56].style.background).toBe(PALETTE_CSS.green);
  expect(cells[0].style.background).toBe(PALETTE_CSS.black);
});
