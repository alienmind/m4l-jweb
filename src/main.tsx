import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";

/**
 * ONE DEVICE PER BUNDLE.
 *
 * `@device` is an alias resolved in vite.config.ts to `src/app/<device>/`, where
 * <device> comes from the dev/build script (see scripts/). So this entry point is
 * shared but contains no branching, and each bundle holds exactly one device: a
 * MIDI device's bundle carries no audio code, and vice versa.
 *
 * That separation is not tidiness. Every .amxd embeds its own UI bundle, so a
 * device ships what it is, not what its siblings are.
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

/**
 * The device's parameter surface, for the harness to render - the same
 * declaration the Max objects are generated from, so the panel and the Push
 * preview cannot drift from what Live will show.
 *
 * A GLOB rather than `import "@device/surface"`, because surface.ts is OPTIONAL:
 * a device with no parameters has no such file, and a static import of a missing
 * module is a build error, not an undefined.
 *
 * The glob sits INSIDE the `import.meta.env.DEV` branch, and that placement is
 * load-bearing. A glob resolves to every match, so hoisting it to a `const` would
 * put EVERY device's declaration in EVERY bundle - one device shipping its
 * siblings' parameters - and the single-file build inlines dynamic chunks, so
 * being lazy is not enough on its own. Written here, the whole expression is dead
 * code once DEV is replaced by `false`, and rollup drops all of it.
 * `tests/bundle.test.mjs` asserts a device carries no sibling's parameters.
 */
const surface = import.meta.env.DEV
  ? (((await import.meta.glob("./app/*/surface.ts", { import: "default" })[`./app/${__DEVICE__}/surface.ts`]?.()) as never) ?? null)
  : null;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {DevHarness ? (
      <div className="dev-layout">
        <DevHarness surface={surface} />
        <App />
      </div>
    ) : (
      <App />
    )}
  </StrictMode>,
);
