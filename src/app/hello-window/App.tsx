import { useWindow } from "@m4l-jweb/surface/react";
import { useDevice } from "../shared/device";
import { Frame } from "../shared/Frame";
import surface from "./surface";

export default function HelloWindow() {
  const device = useDevice();
  const drumWindow = useWindow(surface, "testWindow");

  return (
    <Frame title="HELLO WINDOW" device={device}>
      <dt>window</dt>
      <dd>
        {/* 
          NOTE: The Floating Window feature is currently PARKED due to Max's internal 
          message routing limitations. Clicking this button will successfully send the 
          signal to Max, but the window will not open. See doc/WINDOW.md for details.
        */}
        <button onClick={() => drumWindow.open()} style={{ padding: "4px 8px" }}>
          Open Floating Window (Broken)
        </button>
      </dd>
    </Frame>
  );
}
