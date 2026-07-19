import { defineSurface } from "@m4l-jweb/surface";

// No Live parameters: hello-render is driven entirely from its buttons. It exists to
// prove the saveToFile pipe (S2) and the renderplay transport loop (S3), not to expose
// automatable controls.
export default defineSurface({ params: {} });
