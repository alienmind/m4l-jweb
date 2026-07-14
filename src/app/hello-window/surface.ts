import { defineSurface, window } from "@m4l-jweb/surface";

export default defineSurface({
  params: {},
  banks: [],
  windows: {
    testWindow: window({ title: "My Floating Window", width: 400, height: 300, entry: "App" }),
  },
});
