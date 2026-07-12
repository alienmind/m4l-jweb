/**
 * App.tsx - the jweb UI. A hello-world React page wired to the Max bridge.
 *
 * It demonstrates the whole device loop end to end:
 *   - announce `ui_ready` on mount and show the state the wrapper replies with
 *     (mode, build stamp, tempo, transport ticks);
 *   - forward each transport tick into an optional Web Worker and render the
 *     count the worker sends back;
 *   - flag a stale install when the wrapper's build stamp does not match the
 *     one baked into this page.
 *
 * Replace the body with your device UI. The bridge surface never changes.
 */
import { useEffect, useRef, useState } from "react";
import { bindInlet, inJweb, uiReady } from "@m4l-jweb/bridge";
import { IN } from "./protocol";
import DemoWorker from "./worker.ts?worker&inline";

declare const __APP_VERSION__: string;

export default function App() {
	const [mode, setMode] = useState("dev");
	const [wrapperBuild, setWrapperBuild] = useState<string | null>(null);
	const [tempo, setTempo] = useState<number | null>(null);
	const [playing, setPlaying] = useState(false);
	const [beats, setBeats] = useState(0);
	const [workerTicks, setWorkerTicks] = useState(0);
	const workerRef = useRef<Worker | null>(null);

	useEffect(() => {
		const worker = new DemoWorker();
		worker.onmessage = (e: MessageEvent) => {
			const [type, value] = e.data as [string, number];
			if (type === "ticks") setWorkerTicks(value);
		};
		workerRef.current = worker;

		bindInlet(IN.mode, (m) => setMode(String(m)));
		bindInlet(IN.build, (b) => setWrapperBuild(String(b)));
		bindInlet(IN.tempo, (bpm) => setTempo(Number(bpm)));
		bindInlet(IN.tick, (isPlaying, position) => {
			setPlaying(Number(isPlaying) === 1);
			setBeats(Number(position));
			worker.postMessage(["tick"]);
		});

		// Handshake: the page loads asynchronously, so never assume the wrapper
		// already sent state - announce readiness and let it reply.
		uiReady();

		return () => worker.terminate();
	}, []);

	// The wrapper stamp is "<version> <iso date>"; the UI only bakes in the
	// version. A mismatch means a mixed install: Live embeds a copy of the
	// device in the set, so a reinstalled .amxd does NOT update instances
	// already on tracks.
	const stale = wrapperBuild !== null && wrapperBuild.split(" ")[0] !== __APP_VERSION__;

	return (
		<main className="device">
			<header>
				<h1>{{name}}</h1>
				<span className={`badge ${inJweb ? "live" : "dev"}`}>{inJweb ? "in Max" : "browser dev"}</span>
			</header>

			<dl>
				<dt>mode</dt>
				<dd>{mode}</dd>
				<dt>tempo</dt>
				<dd>{tempo === null ? "-" : `${tempo.toFixed(1)} BPM`}</dd>
				<dt>transport</dt>
				<dd>
					<span className={playing ? "dot on" : "dot"} /> {playing ? "playing" : "stopped"} @ {beats.toFixed(2)} beats
				</dd>
				<dt>worker ticks</dt>
				<dd>{workerTicks}</dd>
			</dl>

			<footer>
				<span>ui {__APP_VERSION__}</span>
				<span>wrapper {wrapperBuild ?? "-"}</span>
				{stale && <span className="warn">stale install - delete and re-drag the device</span>}
			</footer>
		</main>
	);
}
