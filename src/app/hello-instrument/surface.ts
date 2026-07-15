/**
 * hello-instrument has no Live parameters: the `instrument` chain is played by the
 * note contract (`voice_play`), not driven by a dial. Adding one to look busy would
 * put a knob in every automation lane that controls nothing.
 */
import { defineSurface } from "@m4l-jweb/surface";

export default defineSurface({ params: {} });
