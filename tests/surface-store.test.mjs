/**
 * surface-store.test.mjs - the state behind useParam(), driven through the real bridge.
 *
 * No DOM and no React here, which is the reason the store is its own module: the
 * subtle parts of a two-way parameter binding are the WIRE ENCODING (Max stores
 * every parameter as a number - a menu is an index, a toggle is 0/1) and the ECHO
 * GUARD (a value arriving from automation must not fight a user mid-drag). Both
 * are pure logic, and both fail silently in a device: a menu shows the wrong
 * option, or a slider jumps backwards under the mouse.
 *
 * `simulate()` fakes an inbound message from the device, exactly as the wrapper
 * would send it; `tapMessages()` sees what the app sends back.
 */
import { expect, test, vi } from "vitest";
import { simulate, tapMessages } from "@m4l-jweb/bridge";
import { defineSurface, dial, menu, toggle, state } from "@m4l-jweb/surface";
import { GUARD_MS, paramStore, stateStore } from "@m4l-jweb/surface/store";

/** A fresh surface per test: the store is keyed by the declaration and lives forever, by design. */
const makeSurface = () =>
  defineSurface({
    params: {
      cutoff: dial({ range: [40, 18000], unit: "Hz", default: 18000, short: "Cutoff" }),
      running: toggle({ default: false, short: "Run" }),
      slot: menu({ options: ["A", "B", "C"], default: "A", short: "Slot" }),
    },
  });

/** Everything the app sent, as [selector, ...args]. */
function sent() {
  const out = [];
  const stop = tapMessages((m) => m.direction === "out" && out.push([m.selector, ...m.args]));
  return { out, stop };
}

test("the app's state starts at the declared defaults - before Live has said anything", () => {
  // A parameter object loads at its `parameter_initial`, so this is not a guess at
  // Live's state: it is the same value, from the same declaration.
  const store = paramStore(makeSurface());
  expect(store.get()).toEqual({ cutoff: 18000, running: false, slot: "A" });
});

test("a value from the device updates the app, decoded from the wire", () => {
  const store = paramStore(makeSurface());

  simulate("cutoff", 280);
  simulate("running", 1);
  simulate("slot", 2); // Max sends a menu as an INDEX

  expect(store.get()).toEqual({ cutoff: 280, running: true, slot: "C" });
});

test("writing a parameter sends `set_<id>`, encoded as the number Max stores", () => {
  const store = paramStore(makeSurface());
  const { out, stop } = sent();

  store.write("cutoff", 280);
  store.write("running", true);
  store.write("slot", "B");
  stop();

  expect(out).toEqual([
    ["set_cutoff", 280],
    ["set_running", 1], // a toggle is 0/1
    ["set_slot", 1], // a menu is an index
  ]);
  // ...and the app's own state moves at once, optimistically: the patcher writes
  // the object with `set`, which is silent, so waiting for an echo would mean
  // waiting forever.
  expect(store.get()).toEqual({ cutoff: 280, running: true, slot: "B" });
});

test("an inbound value does NOT fight the user mid-drag", () => {
  // The failure this prevents: a slider that jumps backwards under the mouse
  // because an automation lane sent a value between two drag events.
  const store = paramStore(makeSurface());

  store.write("cutoff", 280); // the user is dragging
  simulate("cutoff", 9000); // ...and Live sends something else

  expect(store.get().cutoff, "the user's hand wins while they are still moving").toBe(280);
});

test("...but the guard expires, so automation is not ignored forever", () => {
  // The store measures the window with performance.now(), so THAT is the clock to
  // fake - advancing setTimeout's would prove nothing.
  vi.useFakeTimers({ toFake: ["performance"] });
  try {
    const store = paramStore(makeSurface());
    store.write("cutoff", 280);

    vi.advanceTimersByTime(GUARD_MS + 1);
    simulate("cutoff", 9000);

    expect(store.get().cutoff).toBe(9000);
  } finally {
    vi.useRealTimers();
  }
});

test("our own value coming back is absorbed, and reopens the guard at once", () => {
  const store = paramStore(makeSurface());

  store.write("cutoff", 280);
  simulate("cutoff", 280); // the same value, echoed by Live
  expect(store.get().cutoff).toBe(280);

  // The echo cleared the guard, so the NEXT value - a genuine one - lands
  // immediately rather than waiting out the window.
  simulate("cutoff", 9000);
  expect(store.get().cutoff).toBe(9000);
});

test("every subscriber sees every change - the bridge holds only ONE handler per selector", () => {
  // Two components reading `cutoff` cannot each bindInlet("cutoff"): the second
  // binding would replace the first, and one of them would silently never update
  // again. The store binds once and fans out. This asserts the fan-out.
  const store = paramStore(makeSurface());
  const a = vi.fn();
  const b = vi.fn();
  store.subscribe(a);
  store.subscribe(b);

  simulate("cutoff", 1000);

  expect(a).toHaveBeenCalled();
  expect(b).toHaveBeenCalled();
});

test("one surface, one store - a second call does not rebind and lose the first", () => {
  const surface = makeSurface();
  expect(paramStore(surface)).toBe(paramStore(surface));
});

/* ------------------------------------------------------------------ *
 * State Store
 * ------------------------------------------------------------------ */

const makeStateSurface = () =>
  defineSurface({
    params: {},
    state: { config: state({ default: { voices: 4 } }) },
  });

test("stateStore starts at defaults and emits get_state", () => {
  const { out, stop } = sent();
  const store = stateStore(makeStateSurface());

  expect(store.get()).toEqual({ config: { voices: 4 } });
  expect(out).toContainEqual(["get_state", "config"]);
  stop();
});

test("stateStore parses inbound JSON and updates", () => {
  const store = stateStore(makeStateSurface());
  simulate("state_config", '{"__value":{"voices": 8, "tuning": "drop-d"}}');
  expect(store.get()).toEqual({ config: { voices: 8, tuning: "drop-d" } });
});

/**
 * EVERY VALUE TRAVELS IN AN ENVELOPE, because a Max [dict] is a key/value map and
 * cannot hold anything else.
 *
 * The wrapper stores a slot with `Dict.parse(json)`. A dict has KEYS. So an OBJECT
 * round-tripped and nothing else did: a `state<string>` sent `"c1 e1"` and a
 * `state<FxParam[]>` sent `["cutoff"]`, and parse() had nowhere to put either. The
 * dict stayed empty, stringify() gave back `{}`, and the app read its own default back
 * forever.
 *
 * It wore two disguises and cost real debugging as both: a drum map (an object)
 * persisted while the pattern text (a string) silently did not - which looks exactly
 * like Live losing your work - and the fx `named` slot (an array) came back `{}` on
 * every load, which was written off as the state-DEFAULT seeding gap. That gap is real;
 * this was not it. `named` had never persisted at all.
 */
test("a STRING slot survives the round trip - a [dict] cannot hold a bare scalar", () => {
  const surface = defineSurface({ params: {}, state: { code: state({ default: "c1 e1" }) } });
  const { out, stop } = sent();
  const store = stateStore(surface);

  store.write("code", "bd sd hh");
  const [, , json] = out.find((m) => m[0] === "sync_state");
  // Enveloped, so the dict has the key it needs to hold a string at all.
  expect(JSON.parse(json)).toEqual({ __value: "bd sd hh" });

  // ...and what the dict hands back must unwrap to the STRING itself, not to an
  // envelope the app is left holding.
  simulate("state_code", '{"__value":"c3 e3 g3"}');
  expect(store.get().code).toBe("c3 e3 g3");
  stop();
});

test("an ARRAY slot survives too - this is the fx `named` slot that never persisted", () => {
  const surface = defineSurface({ params: {}, state: { named: state({ default: [] }) } });
  const store = stateStore(surface);
  simulate("state_named", '{"__value":["cutoff","gain"]}');
  expect(store.get().named).toEqual(["cutoff", "gain"]);
});

/**
 * [jweb] hands each argument to Max, and MAX SPLITS A SYMBOL ON WHITESPACE. The wrapper
 * rejoins the pieces with ONE space, which holds for exactly as long as the payload has
 * no meaningful whitespace - true of a compact JSON object, and false of a pattern,
 * which is nothing but whitespace. `c1  e1` would come back as `c1 e1`: the user's text
 * quietly reformatted, with no error anywhere.
 *
 * So the payload carries no literal space at all. Max cannot split what is not there.
 */
test("spaces are escaped on the wire, so Max cannot split the payload", () => {
  const surface = defineSurface({ params: {}, state: { code: state({ default: "" }) } });
  const { out, stop } = sent();
  const store = stateStore(surface);

  store.write("code", "c1  e1\nc2 e2");
  const [, , json] = out.find((m) => m[0] === "sync_state");
  expect(json, "a literal space would be split into separate Max atoms").not.toContain(" ");
  // Still valid JSON, and it still says exactly what the user typed - runs of spaces
  // and all. `\n` needs no help: JSON.stringify already escapes it.
  expect(JSON.parse(json)).toEqual({ __value: "c1  e1\nc2 e2" });
  stop();
});

test("an empty dict means `nothing saved yet`, and answers with the default", () => {
  // A fresh instance's slot comes back `{}` - Live has never saved it. Blanking the app
  // here is what put a black screen on the fx device.
  const store = stateStore(makeStateSurface());
  simulate("state_config", "{}");
  expect(store.get().config).toEqual({ voices: 4 });
});

/**
 * AN EMPTY STRING IS A VALUE. An empty DICT is an absence. They are not the same thing,
 * and confusing them makes an editor uneditable.
 *
 * A consumer read `saved.length ? saved : theDefault` and so restored its default the
 * instant the editor was empty - which is every select-all-and-cut, and every delete of
 * the last character on the way to rewriting a line. The pattern healed back under the
 * user's hands and cut/paste was impossible.
 *
 * The store must hand back exactly what was stored, so that "" survives the round trip
 * and only a genuinely unsaved slot falls back.
 */
test("an empty STRING round-trips as itself, and does not read as `unsaved`", () => {
  const surface = defineSurface({ params: {}, state: { code: state({ default: "c1 e1" }) } });
  const { out, stop } = sent();
  const store = stateStore(surface);

  store.write("code", "");
  expect(store.get().code, "the user cleared the editor - that is a value").toBe("");
  // ...and it goes out as an envelope holding "", not as an empty dict.
  const [, , json] = out.find((m) => m[0] === "sync_state");
  expect(JSON.parse(json)).toEqual({ __value: "" });

  // ...and comes back as "" rather than reverting to the declared default.
  simulate("state_code", '{"__value":""}');
  expect(store.get().code).toBe("");
  stop();
});

test("a value written before the envelope existed still loads", () => {
  // Anything an older build stored could only have been an object, since nothing else
  // could be stored at all. Opening an existing set must not reset its drum map.
  const store = stateStore(makeStateSurface());
  simulate("state_config", '{"voices":12}');
  expect(store.get().config).toEqual({ voices: 12 });
});

test("stateStore ignores invalid JSON without crashing", () => {
  const store = stateStore(makeStateSurface());
  const before = store.get().config;
  simulate("state_config", "{ invalid json }");
  expect(store.get().config).toEqual(before);
});

/**
 * THE ID IS AN ARGUMENT, NOT PART OF THE SELECTOR.
 *
 * This emitted `sync_state_config`, and Max dispatches on the FIRST WORD - so it
 * looked for a `sync_state_config()` the wrapper does not have, found nothing, and
 * fell into anything(), which swallows other people's messages by design. Every
 * write was dropped. The read path (`get_state <id>`) had it right all along, so
 * state loaded and never saved.
 *
 * The wrapper handles `function sync_state(id)`. That is the contract this pins.
 */
test("stateStore writes state out as `sync_state <id> <json>` - the selector the wrapper handles", () => {
  const { out, stop } = sent();
  const store = stateStore(makeStateSurface());

  store.write("config", { voices: 16 });
  expect(out).toContainEqual(["sync_state", "config", '{"__value":{"voices":16}}']);
  expect(store.get().config).toEqual({ voices: 16 });

  stop();
});
