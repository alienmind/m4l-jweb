import { useState } from "react";
import { readClip, readSelectedClip, writeClip, type ClipNote } from "@m4l-jweb/bridge";
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
 * C-major scale. Two reads, and the difference is the lesson: "Read selected clip"
 * reads the clip the CURSOR is on (Live's highlighted slot - an empty slot reports no
 * clip), while "Read track clip" reads this device's own track (playing-else-first,
 * ignoring the selection - what m4l-strudel needs). Round-trip: write, then read, and
 * the notes should match.
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

  // `which` is the source: the clip the CURSOR is on (selected), or this device's own
  // TRACK (playing-else-first, selection ignored). They differ - which is the point of
  // having both: clicking an empty slot and reading "selected" reports no clip, where
  // "track" would fall back to whatever clip the track already has.
  async function read(which: "selected" | "track") {
    // Clear first, so a failed or empty read never leaves a previous read's notes on
    // screen looking like the current result.
    setNotes([]);
    setStatus(which === "selected" ? "Reading the highlighted clip..." : "Reading this track's playing/first clip...");
    try {
      const clip = which === "selected" ? await readSelectedClip() : await readClip();
      setNotes(clip.notes);
      // Three distinct outcomes, all made visible: notes read, a clip that exists but
      // is empty, and (in the catch) no clip at all. "0 notes" and "no clip" are not
      // the same thing - one is an empty clip, the other is read_error.
      setStatus(
        clip.notes.length === 0
          ? `Clip found (${clip.loopEnd} beats) but it has no notes.`
          : `Read ${clip.notes.length} notes over ${clip.loopEnd} beats.`,
      );
    } catch (err) {
      // read_error (no clip) or a timeout - both land here and both show.
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
      <dd style={{ display: "flex", gap: 6 }}>
        <button onClick={() => read("selected")} style={{ padding: "4px 8px" }}>
          Read selected clip
        </button>
        <button onClick={() => read("track")} style={{ padding: "4px 8px" }}>
          Read track clip
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
