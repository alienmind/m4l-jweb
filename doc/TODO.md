# M4L-JWEB: what is left to do

The backlog for the library itself - things any device built on M4L-JWEB could use,
not one device's business logic.

- The **design** of what already exists is [ARCHITECTURE.md](ARCHITECTURE.md), which
  also records **what we measured in Live**. Read that section before building new features.
- The two rules everything follows: **`[js]` is a control plane, not a data plane**
  (bulk data travels via disk, never through Max messages), and **gate every unknown
  behind a cheap spike** that can fail in an afternoon rather than a week.

---

## Priority 1: Core Library Enhancements

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

### 2. Reversed-engineered Push Banks (Hardware Controller Mapping)
Currently, `m4l-jweb` allows you to declare parameter banks (groupings of 8 parameters for hardware like Ableton Push) in `surface.ts`,
and the web mock harness displays them perfectly. However, the build script does not yet inject this banking data into the generated `.amxd` file.
As a result, Live falls back to displaying all parameters in a single, unbanked list.

To fix this, we need to reverse-engineer Max's undocumented JSON format for storing bank data:
1. **Patcher-JSON archaeology:** Open a device in the Max editor, manually configure parameter banks, save it, and diff the resulting JSON to find exactly where and how Max stores this data.
2. **Write the round-trip test first:** Max is extremely picky and will corrupt patches if the JSON is malformed. Do not guess the shape. Write a strict unit test against the known-good JSON before implementing the generator logic.

### 3. Retake README Screenshots
Whenever the example devices change shape again.

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

## Priority 2: Native Audio Bridge (JS to Max MSP) (FEAT-STRUDEL-002)

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

## Priority 3: **A VST3 backend**, so a device runs outside Live. Assessed in
  [PATCHBOARD-VST3.md](PATCHBOARD-VST3.md): the app, the bridge, the surface and the
  harness port; the LiveAPI wrapper does not, and the headless build is what you trade
  away. **One repo, not a fork** - the shared traps *are* the product, and duplicating
  them is how they drift. Its first step is a `Target` seam extracted from
  `packages/build` **while there is still only one target**, which is worth doing on its
  own merits.
