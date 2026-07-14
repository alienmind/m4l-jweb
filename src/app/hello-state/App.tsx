import { useStateSync } from "@m4l-jweb/surface/react";
import { useDevice } from "../shared/device";
import { Frame } from "../shared/Frame";
import surface from "./surface";

export default function HelloState() {
  const device = useDevice();
  const [config, setConfig] = useStateSync(surface, "config");

  return (
    <Frame title="HELLO STATE" device={device}>
      <dt>config</dt>
      <dd>
        <button onClick={() => setConfig({ testValue: Math.random() })} style={{ padding: "4px 8px" }}>
          Update State: {(config as any)?.testValue?.toFixed(4)}
        </button>
      </dd>
    </Frame>
  );
}
