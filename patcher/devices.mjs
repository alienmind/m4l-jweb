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
     * Demonstrates using the `download` chain that interfaces with `[maxurl]`.
     */
    name: "hello-downloads",
    type: "audio",
    chains: ["passthrough", "download"],
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
