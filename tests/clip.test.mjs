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
import { AudioClipError, createAudioClip, decodeBase64, readClip, readSelectedClip, writeClip, simulate, tapMessages } from "@m4l-jweb/bridge";

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

test("readSelectedClip asks for the highlighted slot and parses the same reply", async () => {
  let selector;
  const off = tapMessages((m) => {
    if (m.direction === "out") selector = m.selector;
  });
  const p = readSelectedClip();
  off();
  expect(selector).toBe("read_selected_clip");
  simulate("notes", 2, 1, 60, 0, 1);
  expect((await p).notes).toEqual([{ pitch: 60, start: 0, duration: 1 }]);
});

test("an empty highlighted slot rejects with a slot-specific message", async () => {
  const p = readSelectedClip();
  simulate("read_error", "no_selection");
  await expect(p).rejects.toThrow(/highlighted slot/);
});

test("reads are answered in order", async () => {
  const a = readClip();
  const b = readClip();
  simulate("notes", 2, 1, 60, 0, 1); // answers a (FIFO)
  simulate("notes", 8, 1, 72, 0, 2); // answers b
  expect((await a).loopEnd).toBe(2);
  expect((await b).loopEnd).toBe(8);
});

/* ------------------------------------------------------------------ *
 * createAudioClip - a rendered file into a Live clip slot
 *
 * The wrapper half is LiveAPI and can only be proven in Live. What the bridge owns is
 * the payload: ONE base64 atom, because a path and a clip name both contain spaces and
 * Max splits a message on them - two variadic fields in one flat message cannot be
 * told apart again.
 * ------------------------------------------------------------------ */

test("createAudioClip sends its whole spec as ONE base64 atom", () => {
  const out = captureOut(() =>
    createAudioClip("C:/Ableton Library/User Library/x.wav", { target: "selected" }, { name: 's("bd sd")', loopEnd: 4, warp: true }),
  );
  expect(out.length).toBe(1);
  const [selector, requestId, payload] = out[0];
  expect(selector).toBe("create_audio_clip");
  expect(typeof requestId).toBe("string");
  // A path with three spaces in it and a name with one, and the message is still two atoms.
  expect(String(payload)).not.toMatch(/\s/);
  expect(JSON.parse(decodeBase64(String(payload)))).toEqual({
    path: "C:/Ableton Library/User Library/x.wav",
    target: "selected",
    name: 's("bd sd")',
    loopEnd: 4,
    warp: true,
  });
});

test("a track target carries its indices", () => {
  const out = captureOut(() => createAudioClip("x.wav", { target: "track", track: 3, slot: 0 }));
  const spec = JSON.parse(decodeBase64(String(out[0][2])));
  expect(spec).toEqual({ path: "x.wav", target: "track", track: 3, slot: 0 });
});

test("clip_created resolves the request that asked", async () => {
  let id;
  const off = tapMessages((m) => {
    if (m.direction === "out" && m.selector === "create_audio_clip") id = m.args[0];
  });
  const p = createAudioClip("x.wav");
  off();
  simulate("clip_created", id);
  await expect(p).resolves.toBeUndefined();
});

test("clip_error rejects with the REASON machine-readable and the message readable", async () => {
  let id;
  const off = tapMessages((m) => {
    if (m.direction === "out" && m.selector === "create_audio_clip") id = m.args[0];
  });
  const p = createAudioClip("x.wav");
  off();
  // The wrapper's message is human text, so Max delivers it split on its spaces.
  simulate("clip_error", id, "not_audio_track", "the", "target", "is", "not", "an", "audio", "track");
  await expect(p).rejects.toThrow(/not an audio track/);
  await p.catch((e) => {
    expect(e).toBeInstanceOf(AudioClipError);
    // The branch a device needs: this failure has a way out (bounce to a new track),
    // and needs_live_1205 does not.
    expect(e.reason).toBe("not_audio_track");
  });
});

test("a reply for an unknown request is ignored, not thrown", () => {
  expect(() => simulate("clip_created", "nobody")).not.toThrow();
  expect(() => simulate("clip_error", "nobody", "failed", "x")).not.toThrow();
});
