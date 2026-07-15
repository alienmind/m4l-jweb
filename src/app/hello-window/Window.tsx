import { useStateSync } from "@m4l-jweb/surface/react";
import surface from "./surface";

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
 *
 * WHAT THIS PROVES: the window's [jweb] can now TALK BACK. `useStateSync` here emits
 * `get_state`/`sync_state` on the window's own bridge; the subpatcher tags them
 * `window testWindow ...` and routes them to [js], which reads and writes the SAME
 * [dict] the device view uses and answers this window by name. Type below, and the
 * text survives a save/close/reopen of the set - and the device view sees it too.
 */
export default function HelloFloatingWindow() {
  const [note, setNote] = useStateSync(surface, "note");

  return (
    <main style={{ padding: "24px", fontFamily: "system-ui, sans-serif", lineHeight: 1.5 }}>
      <h1 style={{ margin: "0 0 8px", fontSize: "18px" }}>Floating window</h1>
      <p style={{ margin: "0 0 16px", opacity: 0.75 }}>
        A second [jweb], in a subpatcher of its own, opened by [pcontrol] - and now able to send messages back to the device. The text below is a
        persisted state slot the window writes and the device view reads.
      </p>
      <label style={{ display: "block", fontSize: "13px", opacity: 0.75, marginBottom: "4px" }}>Shared note</label>
      <input
        value={note.text}
        onChange={(e) => setNote({ text: e.target.value })}
        placeholder="type here - it persists, and the device view sees it"
        style={{ width: "100%", padding: "8px", fontSize: "14px", boxSizing: "border-box" }}
      />
    </main>
  );
}
