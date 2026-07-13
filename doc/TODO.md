# M4L-JWEB: what is left to do

The backlog for the library itself - things any device built on M4L-JWEB could use,
not one device's business logic. **In order.** Everything here is buildable today:
nothing is gated on an unknown.

- The **design** of what already exists is [ARCHITECTURE.md](ARCHITECTURE.md), which
  also records **what we measured in Live** (the `set` semantics, `buffer~`, and
  `[maxurl]`'s two nasty failure modes). Read that section before building 3.1 or 3.2
  - it is what they are built against.
- The two rules everything follows: **`[js]` is a control plane, not a data plane**
  (bulk data travels via disk, never through Max messages), and **gate every unknown
  behind a cheap spike** that can fail in an afternoon rather than a week.

---

## 1. Fetch-to-disk - and `[node.script]` is deleted

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

## 2. Sound from samples: the `samples` and `instrument` chains

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

## 3. Push banks

Patcher-JSON archaeology: configure banks once in the Max editor, save, diff the JSON -
the way the container format was found. **Write the round-trip test first; do not guess
the shape.**

Nothing is blocked on it: Live falls back to declaration order and Push shows every
parameter, and the harness's Push preview already renders the declared banks.

## 4. Delete the spike device

`src/app/spike/`, `patcher/chains.mjs`, `wrapper/device.ts`, and the manifest entry.
Its three questions are answered and the answers are in ARCHITECTURE.md. (Spike 1.1a
below does **not** need it - any device with a parameter can answer that.)

## 5. Two spikes worth running, neither blocking

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

## 6. Extract the contract pattern - `defineWatch()`, `defineSamples()`

**Only after 2 has shipped**, when there are two real instances to generalise from.
`defineSurface()` is not a parameters feature; it is one instance of a rule: *you
declare what the Max side has, the build derives everything else* - objects, wiring,
protocol selectors, a typed React hook, and a harness mock, the same five artifacts
every time.

- **6.1 Lift the shared codegen.** Declaration -> boxes -> wiring -> selectors is one
  pipeline. Leave the user-facing APIs bespoke: `params`, `slots` and `watch` have
  nothing meaningful in common. Same for the harness: a mock registry every contract
  plugs into.
- **6.2 `defineWatch()`** - the real prize. It kills hard rule 4 **by construction**: a
  LiveAPI object created during `loadbang` is dead, forever, with no error, and today
  that is enforced by a comment and a code review. Declare what to observe and the
  codegen emits the observers into `bang()`, unconditionally, because that is the only
  place it ever emits them. `liveapi.ts` becomes generated.
- **6.3 `defineDevice()`** - fold in the manifest, which is already a declaration:
  untyped, in another language, with no derived hook and no mock. **The end state: you
  do not write `[js]` at all.**

**Do not build the generic contract compiler first** and then express the Surface in
terms of it. An abstraction extracted from one example is a guess. Two instances, then
lift. And **fetch-to-disk is not one of these**: it is a service, not a declaration -
you call `fetchToFile(url, path)` and await it. Resist inventing `defineFetch()` for
symmetry.

## 7. Loose ends

- **Verify below Live 12.** `[jweb]` dates to Max 8, so Live 10/11 *should* work.
  Nobody has checked.
- **Port a real device onto the template.** The pattern came out of a working Strudel
  device; folding that back onto the packages is what will find the leaks.
- **Live's per-device parameter budget.** A Surface with 60 params may hit a wall. No
  device has come close, so nobody knows where it is.
- **Retake the README screenshots** whenever the example devices change shape again.
- **A VST3 backend**, so a device runs outside Live. Assessed in
  [PATCHBOARD-VST3.md](PATCHBOARD-VST3.md): the app, the bridge, the surface and the
  harness port; the LiveAPI wrapper does not, and the headless build is what you trade
  away. **One repo, not a fork** - the shared traps *are* the product, and duplicating
  them is how they drift. Its first step is a `Target` seam extracted from
  `packages/build` **while there is still only one target**, which is worth doing on its
  own merits.

---

## Done

Each of these shipped, and each is described where it is now true rather than here -
the design in [ARCHITECTURE.md](ARCHITECTURE.md), the migrations in
[CHANGELOG.md](../CHANGELOG.md).

| | |
|---|---|
| **Stage 0** | The mocked-Live harness (message log + mock transport), the MIDI contract owned by the library (`CHAIN_IN`/`CHAIN_OUT`, `sendNote`/`onNote`), and `defineSurface()`'s declaration and types. |
| **Stage 1** | All three spikes, **run in Live, on hardware**. `set` semantics, `[buffer~]` from `[js]`, `[maxurl]` to disk. Findings in [ARCHITECTURE.md](ARCHITECTURE.md#what-max-actually-does-the-measured-facts). |
| **Stage 2 - the Surface** (0.4.0) | A parameter is declared **once** and the build derives the `live.*` object, the wiring in both directions, the protocol selectors, a typed `useParam()`, and the harness's parameter panel and Push preview. Confirmed in Live, on a Push. It exposed three silent bugs: the cut `live.thisdevice` cord, `parameter_range` being a key Max ignores, and a missing unit style printing a float as an integer. |
| **Stage 2.6 - composable audio chains** (0.5.0) | The build owns `plugin~`/`plugout~`; a chain claims a **stage**; the order of the list **is** the signal path. A duplicate box id fails the build. Before this, two audio chains **summed in parallel, silently**. Confirmed by ear against a reversed twin of the same device - [LISTENING.md](LISTENING.md). |

Also done, off-plan: one folder and one bundle per device; the `init` template with a
drift test; `hello-midi` as a real pulse generator; and `examples/transposer` deleted,
because nothing built, typechecked or tested it.
