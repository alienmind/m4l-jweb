# How m4l-jweb compares to JUCE

*JUCE is the obvious thing to be measured against, so this document does the
measuring honestly. It covers where the two overlap, where this project wins,
and - the section that matters - where it plainly loses.*

**Entries marked `*` are what changes if [PATCHBOARD-VST3.md](PATCHBOARD-VST3.md)
is implemented.** They are not shipped today. Everything unmarked is true of the
repo as it stands.

---

## The one-sentence version

> **JUCE is a plugin runtime you compile. m4l-jweb is a code generator that ships
> text into a runtime the user already has installed.**

Almost every difference below falls out of that sentence. JUCE gives you C++,
a DSP library, and a compiler, and the plugin *is* the engine. m4l-jweb writes a
Max patcher, an ES5 `[js]` wrapper and a React bundle into a `.amxd`, and Ableton
supplies the engine that runs them.

That is why `pnpm build` produces installable devices on a machine that has never
had Max on it. It is also why this project cannot, today, produce a plugin for
any host but Live.

---

## They are not really competitors

It is worth saying plainly, because the framing decides everything else.

| | JUCE 8 | m4l-jweb |
|---|---|---|
| **What it is** | A C++ application framework | A TypeScript build system + declarative device DSL |
| **What it produces** | A compiled binary plugin | A generated patcher in a container |
| **Who runs your DSP** | You do. You wrote it | Max does. You named a chain |
| **Target host** | Every DAW | Ableton Live (Suite, or Standard + M4L add-on) |
| **Access to the DAW's session** | None. A plugin is a black box | **LiveAPI** - clips, scenes, tracks, transport |
| **Build requirements** | C++ toolchain, CMake, code signing, notarization | Node 20 + pnpm. That is the whole list |
| **Language you write** | C++ (DSP + editor), or C++ + web UI | TypeScript, everywhere |

After Patchboard, this table gets less clean - because Patchboard's recommended
runtime **is JUCE 8**. The relationship stops being "us vs. them" and becomes
"what did we add on top of them." That question is answered in
[After Patchboard](#after-patchboard-what-is-actually-left-that-is-ours).

---

## Layer by layer

| Layer | JUCE 8 | m4l-jweb (today) | m4l-jweb (post-Patchboard) |
|---|---|---|---|
| **UI** | `WebBrowserComponent` (WebView2 / WKWebView), or JUCE's own widgets | React in `[jweb]` (Chromium) | React in a WebView `*` |
| **UI ↔ host bridge** | `withNativeIntegrationEnabled()` - a supported JS shim | `window.max.bindInlet` / `outlet`, hand-built | JUCE's shim, behind our `Transport` seam `*` |
| **Serving the UI** | `withResourceProvider()` - from memory | Base64 payload extracted to disk by the wrapper | From memory. **The payload hack dies** `*` |
| **Parameters** | `RangedAudioParameter`, declared in C++ | `surface.ts` → generated `live.*` objects | `surface.ts` → **both** a C++ header and `live.*` `*` |
| **UI ↔ parameter binding** | `WebSliderRelay` + `WebSliderParameterAttachment` | `useParam(surface, "cutoff")` | `useParam`, on top of the relays `*` |
| **DSP** | You write it, in C++ | A named chain (`lowpass`, `drive`, `gain`) | A chain selects a **compiled component** `*` |
| **MIDI scheduling** | You write the queue and the note-offs | `[pipe]` + `[makenote]`, free | ~150 lines of C++, written once `*` |
| **Transport** | `ProcessContext`, sample-accurate, per block | LiveAPI poll at 20 Hz | `ProcessContext` `*` |
| **Session access** | None | **LiveAPI. All of it** | LiveAPI on the M4L target only |
| **Dev without a DAW** | Standalone target, or `pluginval` | **Mocked Live in a browser**, with a message log | Mocked *host* in a browser `*` |
| **Editor size** | Whatever you declare; resizable | **169 px, fixed, clips silently** | Whatever you declare `*` |
| **Language floor** | C++17 | **ES5 in the wrapper**, enforced by an acorn gate | ES5 gate gone `*` |

---

## Where m4l-jweb is genuinely better

These are the parts worth defending, and they are not "it's easier because it's
TypeScript."

### 1. One declaration, many artifacts

JUCE has no `surface.ts`. You register a `RangedAudioParameter` in C++, write the
taper, write the string formatting, write the default. If you also want a Max for
Live device, you write every one of those a second time, as `live.*` objects, by
hand, in the Max editor.

```ts
cutoff: dial({ range: [40, 18000], unit: "Hz", exponent: 4, default: 18000, short: "Cutoff" })
```

That one line already generates the `live.dial`, its `parameter_mmin`/`mmax`, its
unit style, its exponent, its initial value, and the two-way wiring in the
patcher. Post-Patchboard it *also* generates the C++ registration, the
`toPlain`/`toNormalized` taper, and the `getParamStringByValue` formatting `*`.

**Nobody else generates the M4L side at all.** That is the part with no
competition.

### 2. The traps are tests, not documentation

This is the least visible advantage and the most valuable one. Every item below
produces a **correct-looking device with no runtime error**:

| The trap | What JUCE does about it | What this repo does |
|---|---|---|
| A parameter with no `default` loads at the bottom of its range | Nothing. Ship it | `defineSurface()` requires `default` |
| A selector nothing handles falls silently on the floor | Nothing. It is your dispatch table | `tests/protocol.test.mjs` fails the build |
| `short` names truncate rather than error | Nothing | Validated at declaration |
| A parameter written from the UI echoes back at the UI | Nothing (Max), gestures (VST3) | `fanParamInto()`, pinned by `tests/surface-codegen.test.mjs` |
| A UI write records **no automation** without begin/end gestures | The relays do it *if you go through them* | Same, plus the codegen keeps you on that path `*` |
| Parameter IDs derived from declaration order silently re-point saved automation | Nothing. Your problem | Hash IDs from the key; pin the hashes in a test `*` |

JUCE gives you the primitives. m4l-jweb gives you the primitives **plus the list
of ways they betray you silently**, checked in CI. That list was expensive to
find, and it is the actual product.

### 3. The device develops in a browser, with no DAW and no compiler

`pnpm dev:hello-midi` renders the device beside a mocked Live: a transport driving
real `tick`/`tempo` at the same 20 Hz cadence, a Push preview, and a log of every
message crossing the bridge in both directions. No Ableton, no Max, no toolchain.

JUCE's answer is a standalone build - which still needs the compiler, and still
does not mock a host.

### 4. Everything is text, so CI can ship it - and an LLM can write it

The patcher is generated, the container is written byte-for-byte, and every
invariant is enforced by the build (ES5 gate, container round-trip, protocol lint,
bundle separation). A contributor clones, installs, builds, and gets an artifact.
So does a runner. So, in practice, does an agent - it can implement a device end
to end and verify its own work.

The canonical M4L workflow, by contrast, ends with *a human clicking Save inside a
licensed Max editor*.

### 5. LiveAPI

Clips, scenes, tracks, the selected scene, the song's scale. Writing a generated
pattern into a clip slot. Following the transport's position in the arrangement.

**A VST3 cannot do any of this, and JUCE cannot give it to you**, because there is
nothing to give: a plugin is a black box that receives audio and events and returns
audio and events. It has no view of the session containing it.

This survives Patchboard **only on the M4L target**. It is the one capability that
is structurally ours.

---

## Where JUCE is plainly better

No hedging in this section.

| | JUCE 8 | m4l-jweb today |
|---|---|---|
| **Hosts** | Every DAW, every format (VST3, AU, AAX, standalone; CLAP via extensions) | **Ableton Live only**, and not Intro or Lite |
| **User requirements** | None beyond a DAW | A Live Suite licence, or Standard + the paid M4L add-on |
| **Transport accuracy** | `ProcessContext`, sample-accurate, every audio block | A **20 Hz poll** of LiveAPI, reverse-engineered |
| **Editor** | Any size, resizable | **169 px tall, fixed. It does not scroll - it clips** |
| **DSP freedom** | Anything you can write | Whatever chain exists. New DSP = a new chain |
| **Language** | C++17 throughout | **ES5** in the wrapper. No `let`, no arrows, no promises |
| **UI delivery** | `withResourceProvider()`, from memory | Base64 payload written to disk in 4 KB slices, because `File.writebytes` truncates silently around 16 KB |
| **Maturity** | Two decades, thousands of shipped plugins | A young repo with six example devices |
| **Community, docs, hiring** | Enormous | This README |
| **Commercial reach** | Sell to anyone with a DAW | Sell to Live Suite owners |

Two of the ugliest things in this repo - **the ES5 straitjacket** and **the
self-extracting payload** - exist purely because of Max. Neither is a design
choice. Both are scar tissue.

And the DSP point deserves its own sentence: `chains: ["lowpass", "drive", "gain"]`
is a beautiful one-word diff *right up until you want a filter that does not
exist*, at which point you are writing Max patcher JSON and a JUCE developer is
writing ten lines of C++.

---

## The overlap, stated without flinching

Patchboard's recommended runtime is **JUCE 8**, and not on vibes: JUCE 8 shipped
exactly the primitives this architecture was already built on.

| What we built by hand | What JUCE 8 supports natively |
|---|---|
| `window.max.bindInlet` / `outlet` | `WebBrowserComponent::Options::withNativeIntegrationEnabled()` |
| The base64 self-extracting UI payload | `withResourceProvider()` |
| `dial`, `toggle`, `menu` | `WebSliderRelay`, `WebToggleButtonRelay`, `WebComboBoxRelay` - **1:1** |
| Two-way parameter binding, incl. the `set` trap | `WebSliderParameterAttachment`, **which performs the gestures for you** |

That is not a coincidence and it is not theft in either direction - it is the same
architecture arrived at independently, which is mild evidence that the architecture
is right. But it does mean:

> **The upper half of this framework is, structurally, a JUCE 8 WebView plugin that
> happens to be pointed at Max instead.**

Anyone evaluating this project should know that, rather than discover it.

---

## After Patchboard: what is actually left that is ours

If Patchboard lands, the VST3 runtime *is* JUCE. So the honest question is what
Patchboard adds on top of a framework it now depends on. Three things:

| | |
|---|---|
| **1. One declaration, two artifacts** | `surface.ts` compiles to a C++ header **and** a Max patcher. JUCE cannot emit the second one, and hand-writing it is the cost Patchboard exists to remove |
| **2. The trap list, as CI** | Defaults, gestures, hashed parameter IDs, unrouted selectors, truncated short names. Every one is a silent failure in raw JUCE and a failing test here |
| **3. A host-agnostic browser harness** | `tick` and `tempo` were host concepts all along, never Ableton ones. The mocked-Live harness becomes a mocked-*host* harness with near-zero work |

And what we give up relative to raw JUCE:

- **An abstraction layer, with all that implies.** A JUCE developer reaches for any
  of several hundred classes. A Patchboard device author reaches for `dial`,
  `toggle`, `menu`, a chain name and a React component. That is a feature exactly
  until you want something the surface does not model - and then you are editing
  `packages/target-vst3/` and you would have been faster in raw JUCE.
- **The headless build, for the VST3 target.** *Clone, install, build, on any machine
  with Node* dies the moment a C++ toolchain enters the picture. Patchboard's answer
  is to keep the native runtime behind a wall (`pnpm build` never compiles it, the
  M4L target stays Node-only), which preserves the property **for the target that
  already had it** and no further.
- **Two targets, forever.** Every chain, every parameter kind, every trap, twice.
  That is precisely why they must share one declaration - but it is a real, permanent
  cost, not a rounding error.

**The honest positioning, post-Patchboard:** not a JUCE competitor - **a declarative
front-end for JUCE that also emits Max for Live.** The second target is the part
nobody else can do; the shared trap list is the part that is expensive to rebuild.
If the M4L target were ever dropped, the case gets much thinner, because "JUCE with
a nicer parameter DSL" is a considerably smaller idea than "one declaration, every
host."

---

## Which should you use?

The decision is not about taste, and it is not close once you answer one question.

> **Do the devices you want to build *talk to Live*, or do they *make sound and MIDI*?**

| If you are building... | Use |
|---|---|
| A device that reads or writes **clips, scenes, tracks, the selected scene** | **m4l-jweb.** There is no alternative. A VST3 cannot see the session, and JUCE cannot change that |
| A device that reads tempo/transport and **makes MIDI or audio**, for Live only | **m4l-jweb**, comfortably. You get the headless build, the browser harness and no C++ |
| The same thing, but for **every DAW** | **JUCE** today. **m4l-jweb** if Patchboard ships `*` - and it would be JUCE underneath either way |
| Serious custom DSP - convolution, physical modelling, anything `poly~`/`buffer~`-shaped | **JUCE.** Max hands you forty years of objects for free, but the moment you step outside them you are patching JSON |
| A commercial plugin sold to the general market | **JUCE.** Requiring Live Suite is a market decision before it is a technical one |
| A plugin you must ship this quarter, with a team that knows C++ | **JUCE.** Maturity, docs and hiring are not nothing |

There is a fair summary of the whole document in one line: **m4l-jweb is the only
way to build a Max for Live device like a software engineer, and everything else it
does, JUCE does too - or will do underneath it.**

---

## Not covered here

Other runtimes (nih-plug, iPlug2, the raw VST3 SDK) are surveyed in
[PATCHBOARD-VST3.md](PATCHBOARD-VST3.md#the-runtime-what-to-build-on), along with
the licensing question - **the VST3 SDK is GPLv3 or a Steinberg agreement, and this
repo is MIT.** That does not compose silently, and it is a decision that belongs
before any code is written, not after the plugin works.
