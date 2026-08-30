/**
 * palette.ts - a PROVISIONAL index -> colour table for the Push 3 pads.
 *
 * READ OFF A PHOTOGRAPH, and that is the honest status. `probe_palette` paints
 * index `base + y*8 + x` on every pad (y from the TOP), so two pictures put all 128
 * indices at known positions - and these values are what those pictures look like,
 * through a camera, at one white balance. They are good enough to pick a readable
 * colour and to match an image approximately. They are NOT the name table
 * `defineControls` will ship.
 *
 * What the real table needs is the photographs sampled properly - or, better, a
 * source inside Live that states the palette. Until then nothing in the library
 * should depend on these numbers, which is why they live in the throwaway device
 * and not in `@m4l-jweb/surface`.
 *
 * Index 0 is OFF. That one is measured, not guessed: the top-left pad is the only
 * dark one on page 0.
 */

/** One palette entry: the index Max wants, and roughly what it looks like. */
export interface Swatch {
  index: number;
  rgb: [number, number, number];
}

/**
 * A spread of the indices that read clearly in the photographs. Deliberately not
 * all 128: the washed-out pale rows (roughly 40-63) are hard to tell apart on a
 * photo and would make the nearest-colour match below worse, not better.
 */
export const SWATCHES: Swatch[] = [
  { index: 0, rgb: [0, 0, 0] }, // off
  // 1 and 17 came off the structure-test frame rather than the palette pages, and are
  // the only two entries here whose position in the picture is not in doubt.
  { index: 1, rgb: [255, 90, 150] }, // pink
  { index: 2, rgb: [255, 0, 0] },
  { index: 3, rgb: [255, 106, 0] },
  { index: 5, rgb: [255, 138, 106] },
  { index: 7, rgb: [224, 168, 120] },
  { index: 8, rgb: [255, 149, 0] },
  { index: 9, rgb: [255, 224, 0] },
  { index: 10, rgb: [200, 224, 0] },
  { index: 11, rgb: [51, 209, 58] },
  { index: 13, rgb: [74, 211, 154] },
  { index: 14, rgb: [74, 209, 209] },
  { index: 16, rgb: [53, 180, 224] },
  { index: 17, rgb: [0, 200, 255] }, // cyan
  { index: 18, rgb: [30, 79, 224] },
  { index: 21, rgb: [106, 90, 224] },
  { index: 22, rgb: [154, 90, 224] },
  { index: 23, rgb: [209, 90, 209] },
  { index: 25, rgb: [224, 21, 90] },
  { index: 26, rgb: [224, 90, 154] },
  { index: 29, rgb: [255, 180, 0] },
  { index: 32, rgb: [23, 201, 100] },
  { index: 34, rgb: [154, 154, 224] },
  { index: 37, rgb: [255, 180, 200] },
  { index: 64, rgb: [255, 0, 0] },
  { index: 65, rgb: [0, 208, 0] },
  { index: 66, rgb: [0, 128, 255] },
  { index: 69, rgb: [240, 240, 240] }, // the closest thing to white
];

/**
 * The nearest swatch to an RGB triple, by plain squared distance in sRGB.
 *
 * Not perceptual - a proper match would work in Oklab - but the table itself is a
 * photograph, so a better distance metric over worse data would be false precision.
 * A pixel that is transparent or near-black comes back as 0, which is off.
 */
export function nearestIndex(r: number, g: number, b: number, alpha = 255): number {
  if (alpha < 128) return 0;
  let best = 0;
  let bestDistance = Infinity;
  for (const s of SWATCHES) {
    const dr = r - s.rgb[0];
    const dg = g - s.rgb[1];
    const db = b - s.rgb[2];
    const d = dr * dr + dg * dg + db * db;
    if (d < bestDistance) {
      bestDistance = d;
      best = s.index;
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
  { min: 0, index: 18, name: "blue" },
  { min: 26, index: 16, name: "cyan" },
  { min: 51, index: 11, name: "green" },
  { min: 76, index: 9, name: "yellow" },
  { min: 101, index: 2, name: "red" },
];

/** The palette index a press of this strength lights. */
export function colourForVelocity(velocity: number): number {
  let index = VELOCITY_BANDS[0].index;
  for (const band of VELOCITY_BANDS) if (velocity >= band.min) index = band.index;
  return index;
}

/** What that index looks like on screen, so the page can mirror the hardware. */
export function cssForIndex(index: number): string {
  const s = SWATCHES.find((sw) => sw.index === index);
  return s ? `rgb(${s.rgb[0]}, ${s.rgb[1]}, ${s.rgb[2]})` : "#0e1013";
}

/**
 * THE STRUCTURE TEST - one press that settles item 1b of doc/TODO.md.
 *
 * A Push 2 colour scheme states the palette as a STRUCTURE rather than a list: four
 * greys at 0-3, then fourteen hues every four indices from 5. The table above says
 * something else - it puts pure red at index 2, where that scheme puts GREY. One of
 * the two is wrong, and the cheapest way to find out which is to paint the claim and
 * look at it.
 *
 * The pattern is four bands, in hardware coordinates (y from the TOP):
 *
 * - an L-shaped MARKER at the top-left corner, three pads of index 3. Its only job is
 *   orientation: an L is unique under all eight symmetries of a square, so a
 *   photograph of the result cannot be read a row or a corner out - which is exactly
 *   the error that would put red at 2 instead of 5.
 * - row 3: indices 1, 2, 3. The Push 2 scheme says dark grey, grey, white. The
 *   photographs say index 2 is pure red. This row alone decides it.
 * - row 5: 5, 9, 13, 17, 21, 25, 29 - red, amber, yellow, lime, green, spring,
 *   turquoise if the every-four spacing holds.
 * - row 7: 33, 37, 41, 45, 49, 53, 57 - cyan, sky, ocean, blue, orchid, magenta, pink.
 *
 * IT WAS RUN, AND THE SCHEME DOES NOT HOLD (Push 3, 2026-08-30). Index 2 came back a
 * red and index 3 an orange, so there is no block of greys; row 7 came back one pale
 * pastel region rather than a second hue ladder. The photographs above were right about
 * every index they name. Written up in doc/MAX-FACTS.md, "The Push 2 colour scheme does
 * not describe a Push 3", and the consequences are item 1b of doc/TODO.md: there is no
 * formula to generate, the Push 2 sources describe different hardware, and it is one
 * table per generation.
 *
 * The frame stays because it is still the cheapest way to check the paint path end to
 * end: the L goes to the hardware as an L, in the top-left corner, or something between
 * here and the pads is mirrored.
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
  { x: 1, yFromTop: 3, index: 2, expect: "grey (the photographs say RED)" },
  { x: 2, yFromTop: 3, index: 3, expect: "white" },
  ...HUES_LOW.map((expect, i) => ({ x: i, yFromTop: 5, index: 5 + i * 4, expect })),
  ...HUES_HIGH.map((expect, i) => ({ x: i, yFromTop: 7, index: 33 + i * 4, expect })),
];
