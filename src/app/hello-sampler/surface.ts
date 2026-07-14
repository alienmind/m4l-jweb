/**
 * hello-sampler has no Live parameters. The `samples` chain drives no DSP from a
 * dial - it loads a file and plays it - so declaring one to look busy would put a
 * knob in every automation lane that does nothing.
 */
import { defineSurface } from "@m4l-jweb/surface";

export default defineSurface({ params: {} });
