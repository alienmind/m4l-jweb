/**
 * clip.test.mjs - the bridge's clip I/O contract, without Max.
 *
 * `readClip()` / `writeClip()` are the shaped API over the wrapper's `read_notes` /
 * `write_clip`. This pins the two things the bridge owns: the flat message it SENDS
 * (Max has no nested arguments, so a note list is spread four atoms at a time) and the
 * reply it PARSES back into notes. The Max side - that `[js]` emits the `notes` list as
 * a single array rather than crashing on `outlet.apply` - is proven in Live by the
 * hello-clip device; here we prove our half.
 */
import { expect, test } from "vitest";
import { readClip, writeClip, simulate, tapMessages } from "@m4l-jweb/bridge";

/** Capture the outbound messages a function produces. */
function captureOut(fn) {
  const out = [];
  const off = tapMessages((m) => {
    if (m.direction === "out") out.push([m.selector, ...m.args]);
  });
  try {
    fn();
  } finally {
    off();
  }
  return out;
}

test("writeClip sends a FLAT list - Max has no nested arguments", () => {
  const notes = [
    { pitch: 60, start: 0, duration: 0.5, velocity: 100 },
    { pitch: 64, start: 0.5, duration: 0.5, velocity: 80 },
  ];
  const out = captureOut(() => writeClip(4, notes));
  // write_clip <lengthBeats> <n> <pitch start duration velocity> ...
  expect(out).toEqual([["write_clip", 4, 2, 60, 0, 0.5, 100, 64, 0.5, 0.5, 80]]);
});

test("readClip asks for the clip and resolves with the parsed notes", async () => {
  let sent;
  const off = tapMessages((m) => {
    if (m.direction === "out" && m.selector === "read_notes") sent = true;
  });
  const p = readClip();
  off();
  expect(sent, "readClip must send read_notes").toBe(true);

  // The wrapper's reply: notes <loopEnd> <n> <pitch start duration> ... (no velocity).
  simulate("notes", 4, 2, 60, 0, 0.5, 67, 1, 0.25);
  const clip = await p;
  expect(clip.loopEnd).toBe(4);
  expect(clip.notes).toEqual([
    { pitch: 60, start: 0, duration: 0.5 },
    { pitch: 67, start: 1, duration: 0.25 },
  ]);
});

test("read_error rejects, so an empty track is not a silent hang", async () => {
  const p = readClip();
  simulate("read_error");
  await expect(p).rejects.toThrow(/no clip/);
});

test("reads are answered in order", async () => {
  const a = readClip();
  const b = readClip();
  simulate("notes", 2, 1, 60, 0, 1); // answers a (FIFO)
  simulate("notes", 8, 1, 72, 0, 2); // answers b
  expect((await a).loopEnd).toBe(2);
  expect((await b).loopEnd).toBe(8);
});
