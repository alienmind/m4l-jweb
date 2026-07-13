/**
 * surface.test.mjs - the Surface's validation rules.
 *
 * The type system already stops a bank naming a parameter that does not exist.
 * What it does not stop is a bank of nine, a default outside its range, or a
 * short name Push will truncate - and every one of those fails SILENTLY in Live
 * rather than loudly. Live shows eight encoders and simply never renders the
 * ninth; Push truncates the label and says nothing.
 *
 * So they throw at declaration time. That is not a weaker guarantee than a type:
 * the build imports surface.ts to generate the patcher, so a violation fails
 * `pnpm build` and fails CI. It is only a less pretty error message.
 */
import { expect, test } from "vitest";
import { BANK_SIZE, defaults, defineSurface, dial, formatValue, menu, toggle, window, state } from "@m4l-jweb/surface";

const ok = () =>
  defineSurface({
    params: {
      density: dial({ range: [0, 1], default: 0.5, format: (v) => `${Math.round(v * 100)}%`, short: "Dens" }),
      octave: dial({ range: [-4, 4], step: 1, default: 0, short: "Oct" }),
      running: toggle({ default: false, short: "Run" }),
      slot: menu({ options: ["A", "B"], default: "A", short: "Slot" }),
    },
    banks: [{ name: "Perform", params: ["density", "octave", "running", "slot"] }],
  });

test("a valid surface keeps declaration order - which is Push's fallback order", () => {
  expect(ok().ids).toEqual(["density", "octave", "running", "slot"]);
});

test("defaults() gives the app its state before Live has replied", () => {
  expect(defaults(ok())).toEqual({ density: 0.5, octave: 0, running: false, slot: "A" });
});

test("a dial default outside its range is rejected", () => {
  expect(() => defineSurface({ params: { d: dial({ range: [0, 1], default: 2, short: "D" }) } })).toThrow(/outside its range/);
});

test("a menu default that is not an option is rejected", () => {
  expect(() => defineSurface({ params: { m: menu({ options: ["A"], default: "B", short: "M" }) } })).toThrow(/not one of its options/);
});

test("a bank of more than eight is rejected - Push would silently drop the rest", () => {
  const params = {};
  const ids = [];
  for (let i = 0; i <= BANK_SIZE; i++) {
    params[`p${i}`] = dial({ range: [0, 1], default: 0, short: `P${i}` });
    ids.push(`p${i}`);
  }
  expect(() => defineSurface({ params, banks: [{ name: "Too many", params: ids }] })).toThrow(/Push shows 8 per page/);
});

test("a parameter in two banks is rejected", () => {
  expect(() =>
    defineSurface({
      params: { a: dial({ range: [0, 1], default: 0, short: "A" }) },
      banks: [
        { name: "One", params: ["a"] },
        { name: "Two", params: ["a"] },
      ],
    }),
  ).toThrow(/more than one bank/);
});

test("a short name Push would truncate is rejected", () => {
  expect(() => defineSurface({ params: { a: dial({ range: [0, 1], default: 0, short: "Resonance" }) } })).toThrow(/truncate/);
});

test("a menu keeps its options as LITERALS - the value type is the union, not `string`", () => {
  // Not a type test in disguise: this is what makes Push print "1/16" instead of
  // "2". The options must survive as a real list on the spec (they become
  // `parameter_enum`), and `useParam` must give the app the union so a typo fails
  // the build. Writing `menu()`'s argument as Omit<MenuSpec<O>, "kind"> silently
  // broke the inference - TS cannot infer O through a mapped type, so it fell back
  // to `string` - and the labels never reached Live.
  const s = defineSurface({ params: { rate: menu({ options: ["off", "1/4", "1/8"], default: "off", short: "Rate" }) } });
  expect(s.params.rate.options).toEqual(["off", "1/4", "1/8"]);
  expect(formatValue(s.params.rate, "1/8")).toBe("1/8");
});

test("formatValue falls back sensibly when no format is given", () => {
  const s = ok();
  expect(formatValue(s.params.density, 0.5)).toBe("50%"); // its own format
  expect(formatValue(s.params.octave, 2)).toBe("2"); // step 1 -> integer
  expect(formatValue(s.params.running, true)).toBe("on");
  expect(formatValue(s.params.slot, "B")).toBe("B");
});

test("window and state definitions are kept on the surface", () => {
  const s = defineSurface({
    params: { mix: dial({ range: [0, 1], default: 0.5, short: "Mix" }) },
    windows: { map: window({ title: "Map", width: 400, height: 300, entry: "MapApp" }) },
    state: { config: state({ default: { voices: 4 } }) }
  });
  expect(s.windows.map.title).toBe("Map");
  expect(s.state.config.default.voices).toBe(4);
});
