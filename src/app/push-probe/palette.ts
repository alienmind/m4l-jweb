/**
 * palette.ts (push-probe) - the colour helpers the spike needs.
 *
 * THE TABLE IS NO LONGER HERE. `PUSH_PAD_RGB` in `@m4l-jweb/surface` is all 128 pad
 * colours as Live itself holds them, read out of Live rather than off a photograph, and
 * everything below is derived from it. The provisional list this file used to carry was
 * 23 values read through a camera at one white balance, and two of them were wrong -
 * see doc/MAX-FACTS.md, "Live holds the pad palette, and the photographs were a page
 * upside down".
 */
import { PUSH_PAD_RGB, rgbCss, PUSH_PALETTE } from "@m4l-jweb/surface";

/**
 * The nearest palette index to an RGB triple, by plain squared distance in sRGB.
 *
 * Not perceptual - a proper match would work in Oklab - but it is now matching against
 * real values rather than photographed ones, so the error that remains is the metric's
 * and not the table's. A pixel that is transparent comes back as 0, which is off.
 */
export function nearestIndex(r: number, g: number, b: number, alpha = 255): number {
  if (alpha < 128) return 0;
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < PUSH_PAD_RGB.length; i++) {
    const v = PUSH_PAD_RGB[i]!;
    const dr = r - ((v >> 16) & 255);
    const dg = g - ((v >> 8) & 255);
    const db = b - (v & 255);
    const d = dr * dr + dg * dg + db * db;
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  }
  return best;
}

/**
 * Velocity -> colour, so how hard you hit a pad is visible ON the pad.
 *
 * Five bands rather than a continuous ramp, because the palette is not a gradient -
 * consecutive indices are not neighbouring colours, so `colour = velocity` would
 * light a scatter of unrelated hues and read as noise. These five are far apart in
 * the table above and run cold to hot, which is the one ordering a person reads
 * without being told.
 *
 * The band edges are arbitrary and evenly spaced. Real Push velocities in the spike
 * ran 32-127 for ordinary playing, so a soft touch lands in the first two bands and
 * a deliberate whack in the last.
 */
export const VELOCITY_BANDS: { min: number; index: number; name: string }[] = [
  { min: 0, index: PUSH_PALETTE.blue, name: "blue" },
  { min: 26, index: PUSH_PALETTE.cyan, name: "cyan" },
  { min: 51, index: PUSH_PALETTE.green, name: "green" },
  { min: 76, index: PUSH_PALETTE.yellow, name: "yellow" },
  { min: 101, index: PUSH_PALETTE.red, name: "red" },
];

/** The palette index a press of this strength lights. */
export function colourForVelocity(velocity: number): number {
  let index = VELOCITY_BANDS[0].index;
  for (const band of VELOCITY_BANDS) if (velocity >= band.min) index = band.index;
  return index;
}

/** What that index looks like on screen, so the page can mirror the hardware. */
export function cssForIndex(index: number): string {
  const v = PUSH_PAD_RGB[index];
  return v === undefined ? "#0e1013" : rgbCss(v);
}

/**
 * THE STRUCTURE TEST - the frame that settled where the palette comes from.
 *
 * A Push 2 scheme described the palette as four greys at 0-3 then fourteen hues every
 * four indices from 5. Painted on a Push 3 (2026-08-30) it failed: index 2 is a red and
 * index 3 an orange, and 33-57 is one pale region rather than a hue ladder. Live's own
 * `COLOR_TABLE` later agreed with the hardware and not with the scheme.
 *
 * The frame stays because it is still the cheapest check that the paint path is intact:
 * the L in the top-left corner goes to the hardware as an L, or something between here
 * and the pads is mirrored. An L is unique under all eight symmetries of a square, so a
 * photograph of it cannot be read a row or a corner out - which is exactly the mistake
 * that had page 1 of the old photographs upside down.
 */
export interface StructureCell {
  x: number;
  /** 0 is the TOP row, as the hardware counts it. */
  yFromTop: number;
  index: number;
  /** What the Push 2 scheme predicted. Kept as the falsified claim, not as a fact. */
  expect: string;
}

const HUES_LOW = ["red", "amber", "yellow", "lime", "green", "spring", "turquoise"];
const HUES_HIGH = ["cyan", "sky", "ocean", "blue", "orchid", "magenta", "pink"];

export const STRUCTURE_TEST: StructureCell[] = [
  { x: 0, yFromTop: 0, index: 3, expect: "marker" },
  { x: 1, yFromTop: 0, index: 3, expect: "marker" },
  { x: 0, yFromTop: 1, index: 3, expect: "marker" },
  { x: 0, yFromTop: 3, index: 1, expect: "dark grey" },
  { x: 1, yFromTop: 3, index: 2, expect: "grey (it is a red)" },
  { x: 2, yFromTop: 3, index: 3, expect: "white (it is an orange)" },
  ...HUES_LOW.map((expect, i) => ({ x: i, yFromTop: 5, index: 5 + i * 4, expect })),
  ...HUES_HIGH.map((expect, i) => ({ x: i, yFromTop: 7, index: 33 + i * 4, expect })),
];
