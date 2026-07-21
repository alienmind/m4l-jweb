import { useCallback, useEffect, useRef, useState } from "react";
import { onNote, onNoteOff } from "@m4l-jweb/bridge";
import { useDevice } from "../shared/device";
import { Frame } from "../shared/Frame";

/**
 * hello-synth - a MIDI-playable synthesizer, synthesized entirely in the page.
 *
 * The counterpart to hello-instrument: that one PLAYS RECORDED AUDIO, this one
 * GENERATES it. No files, no fetch, no decode - an OscillatorNode per voice, held open
 * while the key is down. If it makes sound on the track, `[jweb~]` is carrying a signal
 * the browser computed sample by sample.
 *
 * It also demonstrates the half of MIDI a one-shot does not need: **note-offs**. A
 * struck piano sample decays on its own, so hello-instrument binds only `onNote`. An
 * oscillator does not - it rings until something stops it - so this binds `onNoteOff`
 * too, and holds a voice per pitch between the two.
 *
 * HISTORY: this device was `hello-render`, and it proved the 0.9.x pipeline that wrote
 * a rendered WAV to disk and looped it back through Max with a two-slot crossfade. That
 * pipeline is gone (see m4l-strudel's DRAWER_OF_FAILED_IDEAS.md). The double buffer, the
 * A/B arm and the boundary fade all existed to hide the seam in a looped render, and
 * there is no loop any more - so what is left is the part that was never really about
 * rendering: audio computed in the page arrives on the track.
 */

const WAVES = ["sine", "triangle", "sawtooth", "square"] as const;
type Wave = (typeof WAVES)[number];

/** One octave of white keys, for playing it without a MIDI source. */
const PADS = [60, 62, 64, 65, 67, 69, 71, 72] as const;

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const noteName = (pitch: number) => `${NOTE_NAMES[pitch % 12]}${Math.floor(pitch / 12) - 1}`;
/** MIDI pitch to Hz. 69 = A4 = 440 Hz, twelve-tone equal temperament. */
const hz = (pitch: number) => 440 * Math.pow(2, (pitch - 69) / 12);

const ATTACK_S = 0.01;
const RELEASE_S = 0.12;
/** Headroom: eight voices at full gain would clip the track. */
const VOICE_GAIN = 0.22;
/** How long a pad click sounds, since a click carries no note-off of its own. */
const PAD_HOLD_MS = 500;

/** Lazily created: an AudioContext built at module scope can be left suspended. */
let ctx: AudioContext | null = null;
function audioContext(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

interface Voice {
  osc: OscillatorNode;
  amp: GainNode;
}

export default function HelloSynth() {
  const device = useDevice();
  const [wave, setWave] = useState<Wave>("sine");
  const [held, setHeld] = useState<number[]>([]);
  const [midiCount, setMidiCount] = useState(0);

  /** The sounding voices, by pitch. A held note lives here between on and off. */
  const voices = useRef(new Map<number, Voice>());
  // The MIDI handlers bind once, so they read the current waveform through a ref
  // rather than the value they closed over at mount.
  const waveRef = useRef(wave);
  waveRef.current = wave;

  const noteOff = useCallback((pitch: number) => {
    const voice = voices.current.get(pitch);
    if (!voice) return;
    voices.current.delete(pitch);
    const ac = audioContext();
    const now = ac.currentTime;
    // Ramp down rather than stopping dead: an oscillator cut mid-cycle is a click.
    voice.amp.gain.cancelScheduledValues(now);
    voice.amp.gain.setValueAtTime(voice.amp.gain.value, now);
    voice.amp.gain.linearRampToValueAtTime(0, now + RELEASE_S);
    voice.osc.stop(now + RELEASE_S + 0.01);
    voice.osc.onended = () => {
      voice.osc.disconnect();
      voice.amp.disconnect();
    };
    setHeld((h) => h.filter((p) => p !== pitch));
  }, []);

  const noteOn = useCallback(
    (pitch: number, velocity = 100) => {
      // Retrigger: the same key pressed again before its release finished gets a fresh
      // voice, and the old one is let go rather than left ringing forever.
      noteOff(pitch);

      const ac = audioContext();
      const osc = ac.createOscillator();
      osc.type = waveRef.current;
      osc.frequency.value = hz(pitch);

      const amp = ac.createGain();
      const now = ac.currentTime;
      amp.gain.setValueAtTime(0, now);
      amp.gain.linearRampToValueAtTime((velocity / 127) * VOICE_GAIN, now + ATTACK_S);

      osc.connect(amp);
      amp.connect(ac.destination);
      osc.start(now);

      voices.current.set(pitch, { osc, amp });
      setHeld((h) => (h.includes(pitch) ? h : [...h, pitch]));
    },
    [noteOff],
  );

  // MIDI from the track. Both halves: a sustaining voice needs the release. Bound ONCE
  // (the handlers are subscribers now, so binding twice would double every note) and
  // reading the current callbacks through refs.
  const noteOnRef = useRef(noteOn);
  noteOnRef.current = noteOn;
  const noteOffRef = useRef(noteOff);
  noteOffRef.current = noteOff;
  const bound = useRef(false);
  useEffect(() => {
    if (bound.current) return;
    bound.current = true;
    onNote((pitch, velocity) => {
      setMidiCount((n) => n + 1);
      noteOnRef.current(pitch, velocity);
    });
    onNoteOff((pitch) => noteOffRef.current(pitch));
  }, []);

  /** A pad click is a note with no release of its own, so give it a fixed length. */
  function strike(pitch: number) {
    noteOn(pitch);
    setTimeout(() => noteOff(pitch), PAD_HOLD_MS);
  }

  function panic() {
    for (const pitch of [...voices.current.keys()]) noteOff(pitch);
  }

  return (
    <Frame title="HELLO SYNTH" device={device}>
      <dt>Wave</dt>
      <dd>
        <div style={{ display: "flex", gap: "4px" }}>
          {WAVES.map((w) => (
            <button
              key={w}
              onClick={() => setWave(w)}
              aria-pressed={w === wave}
              style={{ padding: "4px 8px", fontWeight: w === wave ? 700 : 400, opacity: w === wave ? 1 : 0.6 }}
            >
              {w}
            </button>
          ))}
        </div>
      </dd>
      <dt>Keys</dt>
      <dd>
        <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
          {PADS.map((pitch) => (
            <button
              key={pitch}
              onClick={() => strike(pitch)}
              title={`${noteName(pitch)} - ${hz(pitch).toFixed(1)} Hz`}
              style={{
                padding: "6px 10px",
                outline: held.includes(pitch) ? "2px solid currentColor" : "none",
              }}
            >
              {noteName(pitch)}
            </button>
          ))}
        </div>
      </dd>
      <dt>Voices</dt>
      <dd>
        <button onClick={panic} style={{ padding: "6px 12px" }}>
          All notes off
        </button>
        <div style={{ marginTop: "2px", opacity: 0.75 }}>
          {held.length === 0 ? "Silent" : `${held.length} sounding: ${held.map(noteName).join(" ")}`}
        </div>
        <div style={{ marginTop: "2px", opacity: 0.75 }}>
          MIDI notes received: {midiCount}
          {midiCount === 0 && " - put a MIDI device (hello-midi, a clip, a keyboard) before this one"}
        </div>
      </dd>
    </Frame>
  );
}
