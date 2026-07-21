/**
 * hello-instrument has no Live parameters: it is played by notes and by its own pads,
 * not driven by a dial. Adding one to look busy would put a knob in every automation
 * lane that controls nothing.
 */
import { defineSurface } from "@m4l-jweb/surface";

export default defineSurface({ params: {} });
