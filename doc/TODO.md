# M4L-JWEB: what is left to do

The backlog for the library itself - things any device built on M4L-JWEB could use,
not one device's business logic.

- The **design** of what already exists is [ARCHITECTURE.md](ARCHITECTURE.md), which
  also records **what we measured in Live**. Read that section before building new features.
- The two rules everything follows: **`[js]` is a control plane, not a data plane**
  (bulk data travels via disk, never through Max messages), and **gate every unknown
  behind a cheap spike** that can fail in an afternoon rather than a week.

---

## Priority 1: Small Things & Low-Hanging Fruits

### 1. Delete the spike device
`src/app/spike/`, `patcher/chains.mjs`, `wrapper/device.ts`, and the manifest entry.
Its three questions are answered and the answers are in ARCHITECTURE.md. (Spike 1.1a
below does **not** need it - any device with a parameter can answer that.)

### 2. Two spikes worth running, neither blocking
Cheap, and each one closes a question that is currently open.

**1.1a - does a `set`-written parameter reach the automation lane?** Near-certain (a
`set` write moves a *Push* knob, so the parameter itself is written), but not measured,
and it is the last unverified claim under the Surface's write path. Arm automation on
the track, drag `hello-audio`'s Cutoff slider - which writes `set_cutoff` - and look at
the lane. If Live does not record it, the app is writing a picture of a knob, and the
write direction needs `[live.remote~]` instead.

**3.2b - can a device write a parameter's MODULATION rather than its VALUE?** *This one
decides a design, so run it before building any of it.* Live's parameter model has a
value **and** a modulation amount - every `live.dial` in Ableton's factory devices
carries `parameter_modmode` - and only value is modelled today. It matters because an
app writing `set_cutoff` at the wrapper's 20 Hz **steps audibly** on a filter sweep and
**fights the user's automation lane**, so `.lpf(sine.range(200, 2000))` currently has no
honest implementation. One dial, both write paths, an armed lane, and *look* - do not
guess `parameter_modmode` from its name.

Either answer produces a feature, so this is not a fork in the road:

- **A generated `lfo` stage**, whatever the spike says: the app configures a shape and a
  rate ONCE, a Max-native `cycle~`/`phasor~` runs at audio rate, and it reaches the
  parameter's consumers through `fanParamInto()` exactly as the dial does. The app never
  streams values. (An LFO is a stage - 2.6 already gave it a home.)
- **If modulation is writable**, the same chain drives the *parameter* rather than only
  its consumers: the modulation is visible in Live, and the user's automation still wins
  on the value.

### 3. Loose ends
- **Verify below Live 12.** `[jweb]` dates to Max 8, so Live 10/11 *should* work.
  Nobody has checked.
- **Live's per-device parameter budget.** A Surface with 60 params may hit a wall. No
  device has come close, so nobody knows where it is.
- **Retake the README screenshots** whenever the example devices change shape again.

---

## Priority 2: Strudel Framework Requirements

These features are the requirements identified for the `m4l-strudel` implementation.

### 1. Declarative Floating Windows (Popups) (FEAT-STRUDEL-001)

#### What
A declarative API in `m4l-jweb` to define floating Max windows (popups) containing secondary `jweb` views, and a React hook to open/close them from the main device UI.

#### Why
The Ableton Live device view restricts Max for Live interfaces to a fixed height (typically ~169px). Complex interactions—such as `m4l-strudel`'s drum mapping table where a user needs to see and edit dozens of mappings—are extremely clunky within this constraint. 
Since `jweb` cannot natively spawn HTML popups that break out of the Max device bounds on Windows/macOS without clipping or OS-level windowing issues, the idiomatic Max solution is required: opening a floating subpatcher via `[pcontrol]`.

Building this by hand per device breaks the framework's declarative abstractions. `m4l-jweb` needs to manage the Max patching, routing, and React state bindings for these windows automatically.

#### Suggested Design: `defineWindow`

**1. Declaration in `surface.ts`**
Just as Live parameters are declared in `surface.ts` so the build can generate `live.dial` objects, windows should be declared here so the build can generate `pcontrol` subpatchers.

```typescript
// src/app/midi-drums/surface.ts
import { defineSurface, dial, window } from "@m4l-jweb/surface";

export default defineSurface({
	params: {
		// ...
	},
	windows: {
		drumMap: window({ 
			title: "Strudel Drum Map", 
			width: 600, 
			height: 400,
			entry: "drumMap.tsx" // The React entrypoint for this window
		}),
	}
});
```

**2. The Build Step (`@m4l-jweb/build`)**
When `m4l-jweb patchers` runs, it reads `surface.windows`. For each window:
1. It creates a subpatcher containing a `[jweb]` object sized to `width` and `height`.
2. It wires a `[pcontrol]` object to the subpatcher.
3. It adds routing logic to the main patcher's `[jweb]` outlet (e.g., `[route window_drumMap_open window_drumMap_close]`) to drive the `[pcontrol]`.
4. The build process compiles the specified `entry` file (e.g. `drumMap.tsx`) into a separate HTML bundle loaded by the subpatcher's `jweb`.

**3. The React API (`@m4l-jweb/surface/react`)**
The developer gets a typed hook to control the window from the main UI, similar to `useParam`.

```tsx
// src/app/midi-drums/App.tsx
import { useWindow } from "@m4l-jweb/surface/react";
import surface from "./surface";

export default function App() {
	const drumMapWindow = useWindow(surface, "drumMap");
	
	return (
		<button onClick={() => drumMapWindow.open()}>
			Open Drum Kit Mapping
		</button>
	);
}
```

Because both `jweb` instances belong to the same Max device, they can share state (like the actual `drumMap` data) via the Max dictionary or standard bridge message passing, which can also be abstracted by the framework in the future.

### 2. Declarative Device Persistence (FEAT-STRUDEL-003)

#### What
A declarative API in `m4l-jweb` to define state that survives device reloads and travels with the Ableton Live set.

#### Why
Currently, complex app state (like a custom drum map, or an FX chain's text expression) only lives in `localStorage` or memory. This means it survives a device reload locally but **does not travel with the Live set** or survive moving the project to another machine. Moreover, two instances of a device on two tracks share the same `localStorage`, leading to state bleeding across tracks. Per-device persistence requires the wrapper to own the state and store it inside the Live set file (`.als`).

#### Suggested Design: `definePersistence` (or similar)

**1. Declaration in `surface.ts`**
Just as Live parameters are declared in `surface.ts`, persistent state chunks should be declared here so the build can generate the appropriate Max persistence objects (like `[dict]` or hidden `[pattr]` nodes) that Live knows to save with the project.

```typescript
// src/app/midi-drums/surface.ts
import { defineSurface, state } from "@m4l-jweb/surface";

export default defineSurface({
	params: {
		// normal automatable Live parameters
	},
	state: {
		drumMap: state({ default: {} }),
		expression: state({ default: "s(\"bd hh sd hh\")" })
	}
});
```

**2. The Build Step (`@m4l-jweb/build`)**
When `m4l-jweb patchers` runs, it reads `surface.state`. For each declared state key:
1. It creates an internal Max storage mechanism (like `[dict]` combined with `[pattr]` or `[dict.view]`) that Live natively persists when saving the set.
2. It wires communication channels between the `[jweb]` object and this internal storage.

**3. The React API (`@m4l-jweb/surface/react`)**
The developer gets a typed React hook to read/write this persistent state exactly like `useState` or `useParam`, but with the guarantee that the data is saved in the Live set.

```tsx
// src/app/midi-drums/App.tsx
import { useStateSync } from "@m4l-jweb/surface/react";
import surface from "./surface";

export default function App() {
	const [drumMap, setDrumMap] = useStateSync(surface, "drumMap");
	
	// Updating drumMap here will automatically sync the data back to Max, 
    // where it is saved in the Live set permanently.
}
```

---

## Priority 3: Core Library Enhancements

### 1. Fetch-to-disk - and `[node.script]` is deleted
`[jweb]` can `fetch()` but cannot write to disk. The only escape hatch today is
`[node.script]`, whose failure modes in Live run from silently ignoring `script start`
to crashing the host: the least reliable infrastructure in the project. `[maxurl]`
replaces it, and the shape it takes is already measured.

- A generated **`download` chain** around `[maxurl]`. Not `[js]` conjuring the object
  at runtime (silent failure in a frozen device), and not chunking bytes back through
  the bridge (many MB through a text protocol, for nothing).
- **Protocol, in the library** - any device wants this, so it is not a device's own
  `protocol.ts`:
  - UI -> device: `fetch_to_file <requestId> <url> <destPath>`
  - device -> UI: `fetch_done <requestId> <bytes>` / `fetch_error <requestId> <msg>`
  - the bridge wraps it as `fetchToFile(url, destPath): Promise<{ bytes }>`.
- **`fetchToFile` must:** check `status` **and** the `error` key (neither alone is
  sufficient); download to a **temp path and move it into place only on success** (a
  404 otherwise overwrites a good cached file with an error page); and surface the
  failure to the app with the status in it. Report progress as bytes land - outlet 1
  gives it for free.

### 2. Sound from samples: the `samples` and `instrument` chains
The download half needs 1, but the `samples` chain can be built and tested against an
already-extracted payload first, so start there.

- **`samples`** - a named `[buffer~]` per slot; `buffer_load <slot> <path>` replying
  `buffer_ready <slot> <frames> <ms>`. **Must not assume mono** (`replace` adopts the
  file's channel count) and must not treat a frame count as proof of a read.
- **`instrument`** - `[poly~]` voices around `groove~`/`play~`, a **stage** in the
  signal path like any other chain, driven by the note contract the bridge already
  exports. Polyphony and voice stealing are Max's problem, not the app's.
- This is the device that should finally exercise **`type: "instrument"`**, which
  nothing in this repo builds today.

**Unlocks** the first M4L-JWEB device that makes sound.

### 3. Push banks
Patcher-JSON archaeology: configure banks once in the Max editor, save, diff the JSON -
the way the container format was found. **Write the round-trip test first; do not guess
the shape.**

Nothing is blocked on it: Live falls back to declaration order and Push shows every
parameter, and the harness's Push preview already renders the declared banks.

### 4. Extract the contract pattern - `defineWatch()`, `defineSamples()`
**Only after Priority 3.2 has shipped**, when there are two real instances to generalise from.
`defineSurface()` is not a parameters feature; it is one instance of a rule: *you
declare what the Max side has, the build derives everything else* - objects, wiring,
protocol selectors, a typed React hook, and a harness mock, the same five artifacts
every time.

- **4.1 Lift the shared codegen.** Declaration -> boxes -> wiring -> selectors is one
  pipeline. Leave the user-facing APIs bespoke: `params`, `slots` and `watch` have
  nothing meaningful in common. Same for the harness: a mock registry every contract
  plugs into.
- **4.2 `defineWatch()`** - the real prize. It kills hard rule 4 **by construction**: a
  LiveAPI object created during `loadbang` is dead, forever, with no error, and today
  that is enforced by a comment and a code review. Declare what to observe and the
  codegen emits the observers into `bang()`, unconditionally, because that is the only
  place it ever emits them. `liveapi.ts` becomes generated.
- **4.3 `defineDevice()`** - fold in the manifest, which is already a declaration:
  untyped, in another language, with no derived hook and no mock. **The end state: you
  do not write `[js]` at all.**

**Do not build the generic contract compiler first** and then express the Surface in
terms of it. An abstraction extracted from one example is a guess. Two instances, then
lift. And **fetch-to-disk is not one of these**: it is a service, not a declaration -
you call `fetchToFile(url, path)` and await it. Resist inventing `defineFetch()` for
symmetry.

---

## Priority 4: Advanced Native Architectures

### 1. Native Audio Bridge (JS to Max MSP) (FEAT-STRUDEL-002)

#### What
A high-performance bridge mechanism to stream raw PCM audio bytes generated within the JS runtime (e.g., from WebAudio in the Chromium Embedded Framework, or a Node.js process) directly into Max's MSP signal graph (`~` cords). 

#### Why
Currently, if a JavaScript engine (like Strudel's own WebAudio-based synthesizer) generates sound inside a `[jweb]` or `[node.script]` object, that audio is sent directly to the operating system's default audio output device. It completely bypasses Ableton Live's track routing, volume faders, panning, and effect chains. 
To build a true **Strudel INSTRUMENT** device—one that acts like a standard Ableton synth plugin rather than a MIDI sequencer or an effect—the generated audio must enter the Max signal graph.

#### Why this requires an architecture change
Max for Live does **not** provide any built-in audio outlets for its JavaScript hosting objects:
- `[jweb]` has no `~` outlets. Its Chromium process handles audio internally.
- `[node.script]` has no `~` outlets.

Bridging realtime, sample-accurate audio (e.g., Float32 arrays at 44100Hz) over the existing `jweb` message-passing bridge (which serializes data to JSON strings) is impossible due to severe latency, jitter, and CPU overhead.

#### Suggested Design
To achieve this, `m4l-jweb` would need a native C++ Max external or a local socket-based audio bridge.
1. **Shared Memory / Ringbuffer**: A custom Max external (`jweb.audio~`) that reads from a shared memory block. On the JS side, an `AudioWorklet` writes the generated WebAudio PCM data into this shared memory.
2. **Localhost Streaming**: Alternatively, using a local UDP/TCP stream from a Node backend to a native Max receiving object, though this introduces latency.

Until Max provides a native `[jweb~]` object that exposes CEF's audio output as a Max signal, true JS-generated audio instruments require significant native OS-level or C++ extensions beyond standard Max patching.

### 2. Architectural Loose Ends
- **Port a real device onto the template.** The pattern came out of a working Strudel
  device; folding that back onto the packages is what will find the leaks.
- **A VST3 backend**, so a device runs outside Live. Assessed in
  [PATCHBOARD-VST3.md](PATCHBOARD-VST3.md): the app, the bridge, the surface and the
  harness port; the LiveAPI wrapper does not, and the headless build is what you trade
  away. **One repo, not a fork** - the shared traps *are* the product, and duplicating
  them is how they drift. Its first step is a `Target` seam extracted from
  `packages/build` **while there is still only one target**, which is worth doing on its
  own merits.
