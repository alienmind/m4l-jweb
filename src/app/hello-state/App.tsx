import { useStateSync } from "@m4l-jweb/surface/react";
import { useDevice } from "../shared/device";
import { Frame } from "../shared/Frame";
import surface from "./surface";

/**
 * State that survives the SET, not just the session.
 *
 * `config` is typed from its declaration in surface.ts - no cast. Click the button,
 * save the set, close it, reopen it: the value is still there, and a second copy of
 * the device on another track has its own.
 *
 * (In the browser harness there is no Live to persist to, so it resets on reload.)
 */
export default function HelloState() {
  const device = useDevice();
  const [config, setConfig] = useStateSync(surface, "config");

  return (
    <Frame title="HELLO STATE" device={device}>
      <dt>config</dt>
      <dd>
        <button onClick={() => setConfig({ testValue: Math.random() })} style={{ padding: "4px 8px" }}>
          Update state: {config?.testValue?.toFixed(4)}
        </button>
      </dd>
    </Frame>
  );
}
