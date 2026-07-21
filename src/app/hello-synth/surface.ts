import { defineSurface } from "@m4l-jweb/surface";

// No Live parameters: hello-synth is played by MIDI and by its own pads. It exists to
// prove that audio SYNTHESIZED in the page reaches the track, not to expose automatable
// controls - a knob here would sit in every automation lane controlling nothing.
export default defineSurface({ params: {} });
