/**
 * files.ts (hello-downloads) - what this device does with disk.
 *
 * It fetches: the app hands Max a URL and [maxurl] streams it to a file on its own
 * thread, with not one byte crossing the message bridge. The manifest carries no
 * `download` chain, because this declaration is what derives it.
 *
 * It saves too, and that is not decoration. `saveToFile()` had NO example device for
 * its whole life: the fetch path was exercised in Live on every release and the save
 * path never was, so the two halves of the same chain had very different amounts of
 * evidence behind them. A library primitive with no device is a primitive nobody has
 * run.
 */
import { defineFiles } from "@m4l-jweb/surface";

export default defineFiles({
  fetches: true,
  saves: true,
});
