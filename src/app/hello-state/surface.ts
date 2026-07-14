import { defineSurface, state } from "@m4l-jweb/surface";

export default defineSurface({
  params: {},
  banks: [],
  state: {
    config: state({ default: { testValue: 42 } }),
  },
});
