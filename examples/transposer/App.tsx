/**
 * App.tsx (transposer) - a one-knob MIDI transposer, the whole device.
 *
 * Notes arrive from the `midiin` chain as `notein <pitch> <velocity>`, the
 * live.dial arrives as `semitones <n>`, and each note goes back out as
 * `midinote <pitch> <vel> <durMs> <chan> <delayMs>` for the `midiout` chain to
 * place. That is the entire device: no MIDI library, no scheduling code.
 */
import { useEffect, useRef, useState } from "react";
import { bindInlet, inJweb, outlet } from "@/lib/maxBridge";
import { IN, OUT } from "./protocol";

declare const __APP_VERSION__: string;

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const noteName = (pitch: number) => `${NOTE_NAMES[pitch % 12]}${Math.floor(pitch / 12) - 1}`;

export default function App() {
	const [semitones, setSemitones] = useState(0);
	const [last, setLast] = useState<{ from: number; to: number } | null>(null);

	// The inlet handler is bound once, but it must read the CURRENT knob value -
	// a ref keeps it out of the effect's dependency list without going stale.
	const semisRef = useRef(0);
	semisRef.current = semitones;

	useEffect(() => {
		bindInlet(IN.semitones, (n) => setSemitones(Math.round(Number(n))));

		bindInlet(IN.notein, (pitch, velocity) => {
			const p = Number(pitch);
			const v = Number(velocity);
			if (v === 0) return; // note-off: makenote already owns the release

			// Clamp rather than wrap: a transposed note off the keyboard is a bug
			// the player can hear, and MIDI has no pitch 128.
			const shifted = Math.max(0, Math.min(127, p + semisRef.current));

			// pitch, velocity, duration (ms), channel, delay (ms).
			// Delay 0 = play now; a sequencer would compute a lookahead here and
			// let [pipe] place the note precisely.
			outlet(OUT.midinote, shifted, v, 250, 1, 0);
			setLast({ from: p, to: shifted });
		});

		outlet(OUT.ui_ready);
	}, []);

	return (
		<main className="device">
			<header>
				<h1>TRANSPOSER</h1>
				<span className={`badge ${inJweb ? "live" : "dev"}`}>{inJweb ? "in Max" : "browser dev"}</span>
			</header>

			<dl>
				<dt>shift</dt>
				<dd>
					{semitones > 0 ? "+" : ""}
					{semitones} semitones
				</dd>
				<dt>last note</dt>
				<dd>{last ? `${noteName(last.from)} -> ${noteName(last.to)}` : "-"}</dd>
			</dl>

			<footer>
				<span>ui {__APP_VERSION__}</span>
				<span>turn the Semitones dial (also on Push, and automatable)</span>
			</footer>
		</main>
	);
}
