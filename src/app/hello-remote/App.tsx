import { useEffect, useRef, useState } from "react";
import { bindRemote, resolveParamId, writeRemote } from "@m4l-jweb/bridge";
import { useParam } from "@m4l-jweb/surface/react";
import { useDevice } from "../shared/device";
import { Frame } from "../shared/Frame";
import surface from "./surface";

/**
 * hello-remote - the modulation path, self-contained.
 *
 * A device usually modulates SOMEONE ELSE'S parameter; this one modulates its own, so
 * the whole `remote` path is testable with one device and nothing else:
 *
 *   resolveParamId("target")  ask the wrapper for this parameter's LOM id
 *   bindRemote(0, id)         point live.remote~ slot 0 at it
 *   writeRemote(0, v)         stream a value; the chain ramps it into a signal
 *
 * `target` is in `layout.native`, so you watch a real knob move in Live's device view.
 *
 * A bound `live.remote~` owns the parameter EXCLUSIVELY - while modulation is on, the
 * dial, automation and Push are locked out, which is correct and is why the manual
 * slider below drives the parameter THROUGH the remote (writeRemote), not by dragging.
 *
 *   pnpm dev:hello-remote
 *
 * runs the UI in a browser, but there is no Live parameter to bind in the mock - the
 * bind and the sweep need Live.
 */
export default function HelloRemote() {
  const device = useDevice();
  const [target] = useParam(surface, "target");
  const [lomId, setLomId] = useState<number | null>(null);
  const [status, setStatus] = useState("Resolving the target parameter...");
  const [sweeping, setSweeping] = useState(false);
  const [manual, setManual] = useState(50);

  // Resolve and bind ONCE the page is up. A LOM id is a handle into the running set and
  // is never persisted - re-resolved on every load, which is exactly a mount here.
  useEffect(() => {
    let cancelled = false;
    resolveParamId("target").then(
      (id) => {
        if (cancelled) return;
        setLomId(id);
        if (id) {
          bindRemote(0, id);
          setStatus(`Bound live.remote~ slot 0 to target (LOM id ${id}). Sweep or drag below.`);
        } else {
          setStatus('No Live parameter named "target" resolved - is the remote chain in the manifest?');
        }
      },
      (e) => !cancelled && setStatus(`resolveParamId failed: ${String(e)}`),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  // The LFO: a browser timer (not the transport, so no need to press play) writing a
  // sine 0..100 down slot 0. target is linear, so the value IS the landing point.
  const phase = useRef(0);
  useEffect(() => {
    if (!sweeping || !lomId) return;
    const id = setInterval(() => {
      phase.current += 0.08;
      const v = 50 + 50 * Math.sin(phase.current);
      writeRemote(0, v);
    }, 50);
    return () => clearInterval(id);
  }, [sweeping, lomId]);

  return (
    <Frame title="HELLO REMOTE" device={device}>
      <dt>target (live)</dt>
      <dd>{typeof target === "number" ? `${target.toFixed(1)} %` : String(target)}</dd>

      <dt>bind</dt>
      <dd>{lomId === null ? "resolving..." : lomId === 0 ? "unresolved" : `LOM id ${lomId}`}</dd>

      <dt>sweep</dt>
      <dd>
        <button onClick={() => setSweeping((s) => !s)} disabled={!lomId} style={{ padding: "4px 8px" }}>
          {sweeping ? "Stop LFO" : "Start LFO"}
        </button>
      </dd>

      <dt>manual</dt>
      <dd>
        <label className="slider">
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={manual}
            disabled={!lomId || sweeping}
            onChange={(e) => {
              const v = Number(e.target.value);
              setManual(v);
              writeRemote(0, v); // through the remote, not by dragging the (locked) dial
            }}
          />
          <strong>{manual} %</strong>
        </label>
      </dd>

      <dt>status</dt>
      <dd>{status}</dd>
    </Frame>
  );
}
