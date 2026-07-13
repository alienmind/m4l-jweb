/**
 * @m4l-jweb/surface/dev - a mocked Live, next to your app, in a browser tab.
 *
 * `pnpm dev` used to hand you `window.maxSimulate()` on the console. That is a
 * shim, not an environment: to see a sequencer run you had to type ticks in by
 * hand, and to see what your device was actually saying you had nothing at all.
 *
 * This is the other half of the device, mocked:
 *
 *   - A TRANSPORT. Play/stop and a BPM field driving a real clock that emits
 *     `tick <playing> <beats>` and `tempo <bpm>` at the same 50 ms cadence the
 *     wrapper polls Live at. A sequencer becomes developable without a DAW.
 *   - A MESSAGE LOG. Every selector crossing the bridge, both directions. The
 *     bridge is the only channel between the two halves of a device, so tapping
 *     it shows you the device's entire contract, live. This is the single best
 *     debugging tool the stack has and it costs almost nothing.
 *
 * THE HONEST LIMIT: a mock is a mock. It cannot tell you about MIDI timing
 * jitter, real DSP, or LiveAPI's behaviour on a loaded set. What it gives you is
 * the whole message-level contract, exercised without Live - which is the part
 * that is tedious to test and easy to get wrong. Keep "load it in Live" for what
 * genuinely needs Live.
 *
 * NEVER SHIPPED. This module must not appear in the bundle embedded in a .amxd.
 * Import it only behind `import.meta.env.DEV` (see src/main.tsx), and note that
 * tests/bundle.test.mjs asserts HARNESS_MARKER is absent from the built ui.html.
 */
import { useEffect, useRef, useState } from "react";
import { simulate, tapMessages, type BridgeMessage } from "@m4l-jweb/bridge";
import { BANK_SIZE, formatValue, type ParamSpec, type Surface } from "./index";
import { useSurface } from "./react";

/**
 * A string that must never reach a production bundle. The build test greps the
 * emitted ui.html for it: if this module survives tree-shaking, the test fails
 * rather than a dev panel shipping inside someone's device.
 */
export const HARNESS_MARKER = "m4l-jweb:dev-harness:do-not-ship";

/** The wrapper polls Live's transport at 20 Hz. The mock lies at the same rate. */
const TICK_MS = 50;
const LOG_LIMIT = 200;

type AnySurface = Surface<Record<string, ParamSpec>>;

export function DevHarness({ surface }: { surface?: AnySurface | null }) {
  const [playing, setPlaying] = useState(false);
  const [bpm, setBpm] = useState(120);
  const [beats, setBeats] = useState(0);
  const [log, setLog] = useState<BridgeMessage[]>([]);

  // Log every message crossing the bridge, both directions.
  useEffect(() => tapMessages((m) => setLog((prev) => [m, ...prev].slice(0, LOG_LIMIT))), []);

  // Tempo is OBSERVED in the real device, not polled: it is sent once on attach
  // and then only on change. Mirror that - send it when it changes, not on tick.
  useEffect(() => simulate("tempo", bpm), [bpm]);

  // The transport clock. `beats` advances in musical time, so changing the BPM
  // mid-playback changes the rate, exactly as it does in Live.
  const beatsRef = useRef(0);
  const bpmRef = useRef(bpm);
  bpmRef.current = bpm;

  useEffect(() => {
    if (!playing) {
      // Live reports position 0 and is_playing 0 when stopped, and keeps
      // reporting it - a device that only listens for changes must still see this.
      simulate("tick", 0, beatsRef.current);
      return;
    }
    const id = setInterval(() => {
      beatsRef.current += (TICK_MS / 60000) * bpmRef.current;
      setBeats(beatsRef.current);
      simulate("tick", 1, beatsRef.current);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [playing]);

  function stop() {
    setPlaying(false);
    beatsRef.current = 0;
    setBeats(0);
    simulate("tick", 0, 0);
  }

  return (
    <aside data-harness={HARNESS_MARKER} style={S.panel}>
      <h2 style={S.h2}>LIVE (mocked)</h2>

      <section style={S.section}>
        <div style={S.row}>
          <button style={S.btn} onClick={() => setPlaying((p) => !p)}>
            {playing ? "pause" : "play"}
          </button>
          <button style={S.btn} onClick={stop}>
            stop
          </button>
          <label style={S.label}>
            BPM
            <input style={S.input} type="number" min={20} max={300} step={0.5} value={bpm} onChange={(e) => setBpm(Number(e.target.value))} />
          </label>
        </div>
        <div style={S.readout}>
          bar {Math.floor(beats / 4) + 1} | beat {(beats % 4).toFixed(2)}
        </div>
      </section>

      {surface && surface.ids.length > 0 && (
        <>
          <Params surface={surface} />
          <PushPreview surface={surface} />
        </>
      )}

      <section style={S.section}>
        <div style={S.row}>
          <h2 style={S.h2}>messages</h2>
          <button style={S.btn} onClick={() => setLog([])}>
            clear
          </button>
        </div>
        <ol style={S.log}>
          {log.map((m, i) => (
            <li key={`${m.at}-${i}`} style={S.line}>
              <span style={m.direction === "in" ? S.arrowIn : S.arrowOut}>{m.direction === "in" ? "->" : "<-"}</span>
              <span style={S.selector}>{m.selector}</span>
              <span style={S.args}>{m.args.map(String).join(" ")}</span>
            </li>
          ))}
          {!log.length && <li style={S.empty}>nothing yet - press play, or interact with the device</li>}
        </ol>
      </section>

      <p style={S.note}>
        Dev only. Not in the built device. A mock cannot tell you about MIDI jitter, DSP or a real Live set - load it in Live for those.
      </p>
    </aside>
  );
}

/**
 * THE DEVICE PARAMETERS - the half of the device that is real to Push.
 *
 * Rendered from the SAME declaration the Max objects are generated from, and
 * driven through the SAME store the app's `useParam` uses. So moving a control
 * here is not a simulation of a parameter change: it goes through the bridge as
 * `set_<id>`, exactly as the app's own controls do, and the app sees it come back
 * as a parameter change. What a `[live.dial]` would do, minus Live.
 */
function Params({ surface }: { surface: AnySurface }) {
  const [values, set] = useSurface(surface);

  return (
    <section style={S.section}>
      <h2 style={S.h2}>device parameters</h2>
      {surface.ids.map((id) => {
        const spec = surface.params[id];
        const value = values[id];
        return (
          <div key={id} style={S.paramRow}>
            <span style={S.paramName} title={id}>
              {spec.short}
            </span>

            {spec.kind === "dial" && (
              <input
                style={S.range}
                type="range"
                min={spec.range[0]}
                max={spec.range[1]}
                // A float parameter needs a fine grain, or the harness quantises
                // what Live would not. `step` on the declaration means the
                // parameter is genuinely stepped.
                step={spec.step ?? (spec.range[1] - spec.range[0]) / 1000}
                value={Number(value)}
                onChange={(e) => set(id, Number(e.target.value))}
              />
            )}

            {spec.kind === "toggle" && <input style={S.check} type="checkbox" checked={Boolean(value)} onChange={(e) => set(id, e.target.checked)} />}

            {spec.kind === "menu" && (
              <select style={S.select} value={String(value)} onChange={(e) => set(id, e.target.value)}>
                {spec.options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            )}

            <span style={S.paramValue}>{formatValue(spec, value)}</span>
          </div>
        );
      })}
    </section>
  );
}

/**
 * THE PUSH PREVIEW - what a performer will actually be looking at.
 *
 * Eight encoders to a page, `short` names above, `format`ted values below. Push
 * shows Live parameters and nothing else, so this is the whole of your device as
 * far as the hardware is concerned. Getting it wrong - a label truncated to
 * gibberish, a value that reads "0" when it means 280 Hz - is normally a
 * hardware-in-the-loop discovery. Here it is a browser tab.
 *
 * With no banks declared, Live falls back to declaration order, and so does this.
 */
function PushPreview({ surface }: { surface: AnySurface }) {
  const [values] = useSurface(surface);
  const [page, setPage] = useState(0);

  const banks = surface.banks?.length
    ? surface.banks.map((b) => ({ name: b.name, ids: [...b.params] }))
    : chunk(surface.ids, BANK_SIZE).map((ids, i) => ({ name: `Bank ${i + 1}`, ids }));

  const bank = banks[Math.min(page, banks.length - 1)];

  return (
    <section style={S.section}>
      <div style={S.row}>
        <h2 style={S.h2}>push preview</h2>
        <span style={S.bankName}>
          {bank.name} ({Math.min(page, banks.length - 1) + 1}/{banks.length})
        </span>
        {banks.length > 1 && (
          <button style={S.btn} onClick={() => setPage((p) => (p + 1) % banks.length)}>
            next
          </button>
        )}
      </div>
      <div style={S.push}>
        {bank.ids.map((id) => {
          const spec = surface.params[id];
          return (
            <div key={id} style={S.cell}>
              {/* Push gives an encoder ~8 characters. defineSurface() rejects a
                  longer `short` outright, so this cannot silently truncate. */}
              <div style={S.cellName}>{spec.short}</div>
              <div style={S.cellValue}>{formatValue(spec, values[id])}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

const chunk = <T,>(xs: readonly T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n) as T[]);
  return out;
};

const mono = "ui-monospace, SFMono-Regular, Menlo, monospace";

const S: Record<string, React.CSSProperties> = {
  panel: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    padding: 12,
    background: "#14161a",
    color: "#c8ccd4",
    font: `12px ${mono}`,
    minWidth: 280,
    maxWidth: 360,
    borderRight: "1px solid #262a31",
  },
  h2: { margin: 0, font: `600 11px ${mono}`, letterSpacing: "0.08em", textTransform: "uppercase", color: "#7d8694" },
  section: { display: "flex", flexDirection: "column", gap: 6 },
  row: { display: "flex", gap: 6, alignItems: "center" },
  btn: {
    background: "#242932",
    color: "#c8ccd4",
    border: "1px solid #333a45",
    borderRadius: 3,
    padding: "3px 9px",
    font: `11px ${mono}`,
    cursor: "pointer",
  },
  label: { display: "flex", gap: 4, alignItems: "center", marginLeft: "auto", color: "#7d8694" },
  input: {
    width: 62,
    background: "#0e1013",
    color: "#c8ccd4",
    border: "1px solid #333a45",
    borderRadius: 3,
    padding: "3px 5px",
    font: `11px ${mono}`,
  },
  readout: { color: "#7d8694" },
  paramRow: { display: "grid", gridTemplateColumns: "52px 1fr 64px", gap: 6, alignItems: "center" },
  paramName: { color: "#7d8694", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  paramValue: { color: "#8fd0a4", textAlign: "right", overflow: "hidden", whiteSpace: "nowrap" },
  range: { width: "100%", accentColor: "#8fd0a4" },
  check: { justifySelf: "start", accentColor: "#8fd0a4" },
  select: {
    background: "#0e1013",
    color: "#c8ccd4",
    border: "1px solid #333a45",
    borderRadius: 3,
    padding: "2px 4px",
    font: `11px ${mono}`,
  },
  bankName: { color: "#7d8694", marginLeft: "auto" },
  push: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 2 },
  cell: { background: "#0e1013", border: "1px solid #262a31", borderRadius: 2, padding: "4px 5px", overflow: "hidden" },
  cellName: { color: "#7d8694", fontSize: 10, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  cellValue: { color: "#8fd0a4", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  log: { listStyle: "none", margin: 0, padding: 0, overflowY: "auto", maxHeight: 260, display: "flex", flexDirection: "column", gap: 1 },
  line: { display: "flex", gap: 6, whiteSpace: "nowrap" },
  arrowIn: { color: "#5aa9e6" },
  arrowOut: { color: "#e6a15a" },
  selector: { color: "#c8ccd4" },
  args: { color: "#7d8694", overflow: "hidden", textOverflow: "ellipsis" },
  empty: { color: "#4d5460" },
  note: { margin: 0, color: "#4d5460", lineHeight: 1.4 },
};
