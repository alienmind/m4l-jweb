import { useState } from "react";
import { readClip, writeClip, type ClipNote } from "@m4l-jweb/bridge";
import { useDevice } from "../shared/device";
import { Frame } from "../shared/Frame";

/**
 * hello-clip - read and WRITE the MIDI clip on this device's track.
 *
 * The one device that exercises clip I/O end to end, and the reason it exists as its
 * own test: reading a clip is the code path that sends a variadic note list out of
 * `[js]`, and that list must be emitted as ONE array (`outlet(0, ["notes", ...])`) -
 * NOT spread with `outlet.apply`, which crashes the `[js]` engine (see MAX-FACTS.md).
 * So "Read clip" here is the interactive proof that the array form actually lists in
 * Live, not just in the fake Max the unit tests run against.
 *
 * Drop it on a MIDI track. "Write scale" fills the first empty clip slot with a
 * C-major scale; "Read clip" reads the playing (or first) clip back and shows its
 * notes. Round-trip them: write, then read, and the notes should match.
 *
 *   pnpm dev:hello-clip
 *
 * drives the UI in a browser, but clip I/O needs Live - there is no clip in the mock.
 */
export default function HelloClip() {
  const device = useDevice();
  const [status, setStatus] = useState("Idle - drop me on a MIDI track.");
  const [notes, setNotes] = useState<{ pitch: number; start: number; duration: number }[]>([]);

  /** A one-bar C-major scale: eight eighth-notes, C4 up to C5. */
  const scale = (): ClipNote[] => {
    const pitches = [60, 62, 64, 65, 67, 69, 71, 72];
    return pitches.map((pitch, i) => ({ pitch, start: i * 0.5, duration: 0.5, velocity: 100 }));
  };

  async function read() {
    setStatus("Reading the playing/first clip on this track...");
    try {
      const clip = await readClip();
      setNotes(clip.notes);
      setStatus(`Read ${clip.notes.length} notes over ${clip.loopEnd} beats.`);
    } catch (err) {
      setNotes([]);
      setStatus(err instanceof Error ? err.message : String(err));
    }
  }

  function write() {
    const s = scale();
    writeClip(4, s);
    setStatus(`Wrote ${s.length} notes (C-major scale) over 4 beats to the first empty slot.`);
  }

  return (
    <Frame title="HELLO CLIP" device={device}>
      <dt>write</dt>
      <dd>
        <button onClick={write} style={{ padding: "4px 8px" }}>
          Write C-major scale
        </button>
      </dd>

      <dt>read</dt>
      <dd>
        <button onClick={read} style={{ padding: "4px 8px" }}>
          Read clip on this track
        </button>
      </dd>

      <dt>status</dt>
      <dd>{status}</dd>

      <dt>notes</dt>
      <dd style={{ fontFamily: "monospace", fontSize: 11, lineHeight: 1.4, maxHeight: 48, overflowY: "auto" }}>
        {notes.length === 0 ? "-" : notes.map((n) => `${n.pitch}@${n.start}`).join("  ")}
      </dd>
    </Frame>
  );
}
