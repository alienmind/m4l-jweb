import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";

/**
 * ONE DEVICE PER BUNDLE.
 *
 * `@device` is an alias resolved in vite.config.ts to `src/app/<device>/`, where
 * <device> comes from the dev/build script (see scripts/). So this entry point is
 * shared but contains no branching, and each bundle holds exactly one device:
 * hello-midi's has no filter code in it, hello-audio's has no sequencer, and
 * neither carries the spike.
 *
 * That separation is not tidiness. Every .amxd embeds its own UI bundle, and a
 * device should ship what it IS, not what its siblings are.
 */
import App from "@device/App";

/**
 * The mocked-Live dev harness renders BESIDE the app in dev, and must never reach
 * a device.
 *
 * `import.meta.env.DEV` is replaced by the literal `false` in a production build,
 * so this branch - and with it the only reference to @m4l-jweb/surface/dev -
 * becomes dead code that rollup drops before the bundle is inlined into the
 * .amxd. tests/bundle.test.mjs asserts it actually did: a dev panel shipped
 * inside someone's device throws no error, it just sits there, in Live.
 */
const DevHarness = import.meta.env.DEV ? (await import("@m4l-jweb/surface/dev")).DevHarness : null;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {DevHarness ? (
      <div className="dev-layout">
        <DevHarness />
        <App />
      </div>
    ) : (
      <App />
    )}
  </StrictMode>,
);
