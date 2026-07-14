/**
 * The floating window's page - a SEPARATE bundle from the device view.
 *
 * `entry: "Window"` in surface.ts names this file, and scripts/build-ui.mjs builds
 * it into its own self-contained html which the wrapper extracts next to the .amxd
 * and hands to the [jweb] inside the window's subpatcher.
 *
 * It is a whole second page, not a second view of the same one: it has its own
 * Chromium context, its own bridge, and - the reason the feature exists - its own
 * size. The device view is clipped at ~169 px tall and does not scroll, so anything
 * that needs room (a pattern editor, a waveform, a big grid) has nowhere to go
 * inside it.
 *
 * NOTE it does NOT share React state with the device view. Two pages, two runtimes:
 * they talk to each other only by going through Max, exactly as two devices would.
 */
export default function HelloFloatingWindow() {
  return (
    <main style={{ padding: "24px", fontFamily: "system-ui, sans-serif", lineHeight: 1.5 }}>
      <h1 style={{ margin: "0 0 8px", fontSize: "18px" }}>Floating window</h1>
      <p style={{ margin: 0, opacity: 0.75 }}>
        A second [jweb], in a subpatcher of its own, opened by [pcontrol]. It has as much room as it likes - the device view below is fixed at about
        169 px tall and clips whatever does not fit.
      </p>
    </main>
  );
}
