import { useStateSync, useWindow } from "@m4l-jweb/surface/react";
import { useDevice } from "../shared/device";
import { Frame } from "../shared/Frame";
import surface from "./surface";

/**
 * The device view. `useWindow()` sends `window_testWindow_open`; the [route] the
 * build generated catches it and bangs an [open( message into the [pcontrol] wired
 * to the window's subpatcher. The window's own page is Window.tsx.
 *
 * It also reads the `note` slot the WINDOW writes - the same persisted [dict], from
 * a different page. That the text typed in the floating window shows up here is the
 * end-to-end proof that the window's [jweb] now reaches [js] and its state.
 */
export default function HelloWindow() {
  const device = useDevice();
  const testWindow = useWindow(surface, "testWindow");
  const [note] = useStateSync(surface, "note");

  return (
    <Frame title="HELLO WINDOW" device={device}>
      <dt>window</dt>
      <dd style={{ display: "flex", gap: "8px" }}>
        <button onClick={() => testWindow.open()} style={{ padding: "4px 8px" }}>
          Open
        </button>
        <button onClick={() => testWindow.close()} style={{ padding: "4px 8px" }}>
          Close
        </button>
      </dd>
      <dt>note from window</dt>
      <dd>{note.text ? note.text : <span style={{ opacity: 0.5 }}>(empty - type in the window)</span>}</dd>
    </Frame>
  );
}
