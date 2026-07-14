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
  simulate("state_config", '{"voices": 8, "tuning": "drop-d"}');
  expect(store.get()).toEqual({ config: { voices: 8, tuning: "drop-d" } });
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
  expect(out).toContainEqual(["sync_state", "config", '{"voices":16}']);
  expect(store.get().config).toEqual({ voices: 16 });

  stop();
});
