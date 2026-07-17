/**
 * surface.ts (hello-clip) - no parameters.
 *
 * This device reads and writes the CLIP on its track, which is note data, not a Live
 * parameter. Nothing here is automatable or on Push, so the surface is empty - but the
 * file still exists, because every device declares its surface in one place and the
 * build imports it.
 */
import { defineSurface } from "@m4l-jweb/surface";

export default defineSurface({ params: {} });
