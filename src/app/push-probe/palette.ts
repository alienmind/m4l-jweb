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
