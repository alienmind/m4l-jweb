/**
 * files.ts (hello-downloads) - what this device does with disk.
 *
 * It fetches: the app hands Max a URL and [maxurl] streams it to a file on its own
 * thread, with not one byte crossing the message bridge. It never writes bytes it
 * already holds, so `saves` stays off - and the manifest carries no `download`
 * chain, because this declaration is what derives it.
 */
import { defineFiles } from "@m4l-jweb/surface";

export default defineFiles({
  fetches: true,
});
