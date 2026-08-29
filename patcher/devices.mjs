/**
 * devices.mjs - the device manifest. THIS is what you edit to change the shape
 * of a device; the patcher itself is generated from it (see
 * @m4l-jweb/build). Patch cords become code review.
 *
 * Fields
 *   name        output basename -> dist/<pkg>/<name>.amxd
 *   type        "midi" (MIDI effect) | "instrument" | "audio" (audio effect)
 *   chains      canned wiring, applied in order. Vocabulary:
 *                 "midiout"     jweb -> route midinote -> pipe -> makenote
 *                               -> midiformat -> midiout. The app emits
 *                               `midinote <pitch> <vel> <durMs> <chan> <delayMs>`;
 *                               it computes WHEN, Max places it precisely.
 *                 "lowpass"     onepole~ in the signal path, on a `cutoff` param.
 *                 "gain"        *~ in the signal path, on a `gain` param.
 *                 "delay"       feedback delay sent from a dry/wet knob: `delay`,
 *                               `delaytime`, `delayfeedback`. Neutral (a wire) at
 *                               delay = 0 - the dry path is untouched, the tap is
 *                               summed on top.
 *                 "reverb"      cverb~ (ships in Live) sent from a `room` knob.
 *                               Wet-only, so the dry/wet is the chain's own;
 *                               neutral at room = 0.
 *                 "passthrough" nothing at all - an audio effect that passes its
 *                               input through untouched.
 *
 *               THE ORDER IS THE SIGNAL PATH. An audio device's plugin~/plugout~
 *               are created by the build; each audio chain claims one STAGE
 *               between them, so `["lowpass", "gain"]` is
 *               plugin~ -> onepole~ -> *~ -> plugout~, and reversing the list
 *               reverses the effects.
 *   unmatchedTo where messages the chains did not consume go. "js" sends them
 *               to the wrapper (ui_ready, write_clip, read_notes, ...).
 *
 * Parameters are NOT here. They are declared in `src/app/<device>/surface.ts` -
 * one declaration, from which the build derives the live.* objects, the wiring in
 * both directions, and the protocol selectors. This file used to carry a
 * `parameters` field that had to be kept in step with surface.ts by hand; the
 * Surface codegen subsumed it.
 */
/**
 * RELEASE BUNDLES - a zip for one device, on its own.
 *
 * The repo zip is for somebody installing the library. A bundle is for somebody who wants
 * one device and has never heard of the library. `push-snake` is a game with its own
 * name and its own audience, so it ships as a game: one .amxd and a README, and nothing
 * about chains or targets or TypeScript.
 *
 * It needs nothing else in the zip because the .amxd carries everything - the page, the
 * soundtrack, all of it. A device with `looseFiles` or a `site:` window would have those
 * added too; see packageBundles in @m4l-jweb/build.
 */
export const bundles = [
  {
    name: "push-snake",
    title: "Snake for Push",
    devices: ["push-snake"],
    readme: "doc/SNAKE.md",
  },
];

export default [
  {
    /**
     * hello-clip - read and WRITE the MIDI clip on this device's track.
     *
     * No chains: clip I/O is pure LiveAPI in the wrapper (`read_notes`/`write_clip`),
     * so the bare selectors just need `unmatchedTo: "js"` to reach `[js]`. It exists as
     * its own test because reading a clip is the code path that emits a variadic note
     * list out of `[js]` - the one that must go out as a single array, never via
     * `outlet.apply` (which crashes the engine; see doc/MAX-FACTS.md).
     */
    name: "hello-clip",
    type: "midi",
    chains: [],
    unmatchedTo: "js",
  },
  {
    /**
     * hello-remote - the modulation path (`remote` chain), self-contained.
     *
     * `remotes: 1` puts one `live.remote~` in the device; the app resolves its OWN
     * `target` parameter's LOM id, binds slot 0 to it, and streams values that sweep it
     * - so resolveParamId + bindRemote + writeRemote are all testable with one device
     * and no other. `target` is a native dial, so the sweep is a visible knob in Live.
     */
    name: "hello-remote",
    type: "audio",
    chains: ["passthrough", "remote"],
    remotes: 1,
    unmatchedTo: "js",
  },
  {
    name: "hello-midi",
    type: "midi",
    // midiin feeds played notes to the app as `notein`; midiout takes the notes
    // the app generates. The app is a small generator: it decides WHEN a note
    // falls and [pipe] places it on Max's scheduler.
    chains: ["midiin", "midiout"],
    // Parameters: src/app/hello-midi/surface.ts (density, rate).
    unmatchedTo: "js",
  },
  {
    /**
     * An audio EFFECT: it sits on an audio track, takes audio in and gives audio
     * out. Three stages, and THIS LINE IS THE SIGNAL PATH:
     *
     *   plugin~ -> onepole~ -> overdrive~ -> *~ -> plugout~
     *              "lowpass"    "drive"    "gain"
     *
     * The build creates the device's plugin~/plugout~; each chain claims one stage
     * between them, in declaration order. Swap "drive" and "gain" here and the
     * device is rewired - and you can HEAR the difference, because distortion and a
     * level change do not commute (a filter and a level change do: reordering
     * "lowpass" and "gain" would generate a different patcher and sound the same).
     *
     * Each chain requires the parameter named after it - cutoff, drive, gain - from
     * src/app/hello-audio/surface.ts, and fails the build without it.
     */
    name: "hello-audio",
    type: "audio",
    chains: ["lowpass", "drive", "gain"],
    unmatchedTo: "js",
  },
  {
    /**
     * NOT AN EXAMPLE - A TEST CASE, and the only one in this repo whose assertion is
     * made with your EARS. Keep it.
     *
     * hello-audio's signal path, backwards. It shares hello-audio's app folder
     * (`ui`), its surface and its three dials, so the ONLY difference between the two
     * devices in the whole build is the order of three words below. That is what
     * makes it evidence rather than a demo.
     *
     *   hello-audio      filter -> distort -> level    loud and dirty: it distorts at
     *                                                  full level, and no filter comes
     *                                                  after to tame the harshness
     *   hello-audio-rev  level -> distort -> filter    quiet and clean: the level is
     *                                                  cut BEFORE the distortion, so
     *                                                  it barely clips, and the filter
     *                                                  smooths what does
     *
     * If they sound the SAME, the generated series is a lie and the stages are summing
     * in parallel - the bug Stage 2.6 fixed, which shipped silently before it. (They
     * DID sound different, in Live, which is what closed 2.6.)
     *
     * The pair only proves anything because `drive` is NONLINEAR. Reversing two linear
     * stages (a filter and a level) generates a different patcher and sounds
     * identical, so an A/B built from `lowpass` and `gain` alone would "fail" in
     * exactly the way a broken build does. Same trap inside the test: at Drive = 1 and
     * Gain = 1 both stages are pass-throughs and the two devices are SUPPOSED to sound
     * alike. Push Drive up and pull Gain well below 1, or you are testing nothing.
     */
    name: "hello-audio-rev",
    type: "audio",
    ui: "hello-audio", // the same app, the same parameters, the opposite signal path
    chains: ["gain", "drive", "lowpass"],
    unmatchedTo: "js",
  },
  {
    /**
     * hello-downloads
     * Tests the fetch-to-disk capability, which bypasses the lack of disk access in [jweb].
     *
     * NO `download` CHAIN HERE, and that is the point: it declares what it does with
     * disk in `src/app/hello-downloads/files.ts`, and the build derives [maxurl] and
     * the device-folder message from that one declaration. A device that writes files
     * and forgets the chain used to build, load and fail silently at the last step.
     */
    name: "hello-downloads",
    type: "audio",
    chains: ["passthrough"],
    unmatchedTo: "js",
  },
  {
    /**
     * hello-sampler - the first device in this repo that ORIGINATES a sound.
     *
     * An INSTRUMENT (`type: "instrument"`), which nothing else here builds: it sits on
     * a MIDI track and is the source of that track's audio rather than a stage in
     * someone else's signal path.
     *
     * The two chains are the whole sample-browser path, in order: `download` puts the
     * file on disk ([maxurl] writes it; the bytes never cross the bridge), and
     * `samples` reads it into a [buffer~] and plays it through [groove~] INTO THE
     * TRACK. A page cannot preview a sample by playing it itself - [jweb] has no
     * signal outlets, so its audio goes to the OS output device, past the fader and
     * the monitor cue.
     *
     * `slots` names the buffers. One is enough for a preview; a drum map wants eight.
     */
    name: "hello-sampler",
    type: "instrument",
    chains: ["webaudio"],
    unmatchedTo: "js",
  },
  {
    /**
     * hello-instrument - the marquee: a POLYPHONIC repitched sampler.
     *
     * Where hello-sampler plays one preview voice through a single [groove~], this
     * plays N voices through a [poly~], so overlapping notes each get their own voice
     * and Max steals the oldest when they run out. The `instrument` chain freezes the
     * voice patch (`hello-instrument-voice.maxpat`) into the .amxd as a dependency,
     * the same way a factory M4L instrument ships its voice abstraction.
     *
     * `download` puts a WAV on disk and `instrument` reads it into the shared
     * [buffer~] and plays it, repitched per note, through the track. ONE slot: a
     * repitched one-shot sampler is a whole instrument; a per-pad drum rack is the
     * next step, not this.
     */
    name: "hello-instrument",
    type: "instrument",
    // `webaudio` carries the page's sound out; `midiin` brings the track's notes IN, so
    // a MIDI device (hello-midi, a clip, a keyboard) placed before it PLAYS it. An
    // instrument that ignores MIDI is a noise box, not an instrument.
    chains: ["webaudio", "midiin"],
    unmatchedTo: "js",
  },
  {
    /**
     * hello-synth - a MIDI-playable synthesizer, generated in the page.
     *
     * The pair to hello-instrument, and deliberately the other half of the problem:
     * that device PLAYS RECORDED AUDIO (fetch, decode, repitch), this one GENERATES
     * it (an OscillatorNode per held note). Same two chains, because both are real
     * instruments: `webaudio` carries the sound out, `midiin` brings the notes in.
     *
     * It also exercises note-OFFS, which hello-instrument does not need: a struck
     * sample decays by itself, an oscillator rings until told to stop.
     *
     * Was `hello-render` until 0.9.9, when it proved the offline WAV render + Max loop
     * pipeline. That pipeline is retired, and a demo of a double buffer with nothing
     * left to double-buffer proves nothing - so it became the synth the name now says.
     */
    name: "hello-synth",
    type: "instrument",
    chains: ["webaudio", "midiin"],
    unmatchedTo: "js",
  },
  {
    /**
     * hello-state
     * Demonstrates the state persistence API (`useStateSync`).
     * Proves that arbitrary JSON blobs can be saved cleanly into the Ableton Live Set and automatically restored.
     */
    name: "hello-state",
    type: "audio",
    chains: ["passthrough"],
    unmatchedTo: "js",
  },
  {
    /**
     * push-probe - THE SPIKE, and it is not an example. See
     * doc/PUSH-USECASES.md and doc/MAX-FACTS.md.
     *
     * Six things about grabbing a Push control are unmeasured, and five of them gate
     * every line of `defineControls`. This device asks the hardware and prints the
     * answers; when they are written into doc/MAX-FACTS.md ("Grabbing a Push control")
     * it can be deleted from this manifest and nothing will miss it.
     *
     * `mode: "probe"` is the only thing that makes it the probe. `wrapper/device.ts` is
     * concatenated into EVERY device this repo builds, so the probe's handlers exist in
     * all of them and refuse to run unless the [js] object-box argument says `probe` -
     * hello-midi carrying an inert handler is fine, hello-midi grabbing the pads of
     * somebody's set is not.
     *
     * IT GRABS NOTHING ON LOAD. Every call that touches the hardware is behind a
     * button, because a spike that seizes a control surface the moment it is dropped
     * on a track is a spike you cannot get out of. Live hung during one round of this,
     * with the cause still unattributed - so no automatic grabs, ever.
     *
     * `mpe: true` + the `mpein` chain are the OTHER DOOR. The grabbed Button_Matrix
     * carries press and release with a velocity and nothing else - no aftertouch, no
     * slide, measured. The donor device that owns the pads also declares `is_mpe 1`,
     * which is what makes Live send it per-note expression as MIDI. So the question
     * this device now asks is whether a device can hold the grid AND receive that
     * expression at the same time, which is the combination the donor implies works.
     */
    name: "push-probe",
    type: "midi",
    mode: "probe",
    mpe: true,
    chains: ["mpein"],
    unmatchedTo: "js",
  },
  {
    /**
     * hello-headless - NO BROWSER. The device that makes the claim honest.
     *
     * `target: "headless"` and the build emits only the `[js]` wrapper and the patcher:
     * no `[jweb]`, no HTML payload, no Chromium. Its interface is declared exactly as
     * every other device's is - `defineSurface` - and its logic is
     * `src/app/hello-headless/headless.ts`, compiled to ES5 and concatenated after the
     * wrapper. There is no `App.tsx` and no `protocol.ts`, because there is no bridge
     * to have a contract across: this device is one half.
     *
     * A MIDI arpeggiator, because it exercises what the target has to prove and nothing
     * it does not: parameters in BOTH directions (a dial reaches `function rate()`,
     * `outlet(0, "set_x", v)` goes back), a packaged CHAIN reached through the same
     * `ctx.appIn` seam a page would use, a `Task` clock that beats a hidden page's
     * Worker, and `layout.native` as the entire device view.
     */
    name: "hello-headless",
    type: "midi",
    target: "headless",
    chains: ["midiout"],
  },
  {
    /**
     * push-snake - THE DEVICE THAT PROVES THE PADS, and the first thing built on
     * `defineControls()`. Full design in doc/PUSH-USECASES.md, use case 1.
     *
     * A device rather than a demo because its bugs are visible from across the room:
     * a y flip in the wrong place is an upside-down snake, and a frame diff that
     * drops a cell is a trail that never rubs out.
     *
     * NO `takeover` CHAIN LISTED, and that is deliberate. The chain is derived from
     * the `controls` declaration in src/app/push-snake/surface.ts, exactly as
     * `download` is derived from a files.ts - a device whose observers were missing
     * because the manifest forgot them would load, grab the grid, and report every
     * press to nobody.
     *
     * `instrument` + `webaudio`: the page's AudioContext IS the track's audio, so the
     * same page that owns the grid owns the sound. No window, no second bundle.
     */
    name: "push-snake",
    type: "instrument",
    chains: ["webaudio"],
    unmatchedTo: "js",
  },
  {
    /**
     * hello-window
     * Demonstrates the floating window API (`useWindow`): a second page, in a window
     * of its own, for a UI that does not fit in the device view's fixed ~169 px. The
     * window is declared in surface.ts; the build generates the subpatcher, its
     * [jweb] and the [pcontrol] that opens it.
     */
    name: "hello-window",
    type: "audio",
    chains: ["passthrough"],
    unmatchedTo: "js",
  },
];
