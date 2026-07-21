/**
 * midi-in.test.mjs - the bridge's incoming-MIDI contract, without Max.
 *
 * THE BUG THIS PINS: `bindInlet` keeps ONE handler per selector, so a second bind on
 * the same name REPLACES the first. `onNote` and `onNoteOff` both read `notein`, and
 * when each called `bindInlet` itself the second one silently won - a synth that bound
 * both went completely deaf to note-ONs while looking perfectly wired in the patcher.
 * They share one binding and fan out to subscriber sets now, and these tests fail if
 * anyone puts `bindInlet` back inside either of them.
 */
import { expect, test } from "vitest";
import { onNote, onNoteOff, simulate } from "@m4l-jweb/bridge";

test("onNote and onNoteOff coexist - binding one does not deafen the other", () => {
  const ons = [];
  const offs = [];
  onNote((pitch, velocity) => ons.push([pitch, velocity]));
  onNoteOff((pitch) => offs.push(pitch));

  simulate("notein", 60, 100); // press
  simulate("notein", 60, 0); //  release

  expect(ons).toEqual([[60, 100]]);
  expect(offs).toEqual([60]);
});

test("a release is velocity ZERO, and never reaches the note-on handler", () => {
  const ons = [];
  onNote((pitch, velocity) => ons.push([pitch, velocity]));
  simulate("notein", 64, 0);
  expect(ons).toEqual([]);
});

test("two onNote callers both hear the note - neither clobbers the other", () => {
  const a = [];
  const b = [];
  onNote((pitch) => a.push(pitch));
  onNote((pitch) => b.push(pitch));
  simulate("notein", 67, 90);
  expect(a).toEqual([67]);
  expect(b).toEqual([67]);
});
