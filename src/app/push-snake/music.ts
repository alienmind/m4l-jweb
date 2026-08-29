/**
 * music.ts (push-snake) - four mixes of one loop, one of them audible at a time.
 *
 * Four loop layers and a win track.
 *
 * The layers are the tension: level 1 is the sparsest arrangement and level 4 the
 * densest, and the game climbs through them as the snake grows, one step per two
 * segments, staying on 4 once it gets there. All four are 18.823537 s at 22.05 kHz -
 * the same length to the sample, which is what the sync below needs.
 *
 * `theme.ogg` is the main tune - 88.2 s at 48 kHz. It is not a fifth layer and could not
 * be one: a different length cannot share the layers' clock, and it is a different piece
 * rather than a denser mix of the same one. It plays once, on its own bus, twice in a
 * session: as a welcome when the device loads, and again when the gauge fills.
 *
 * ------------------------------------------------------------------------------
 * ALL FOUR PLAY AT ONCE, IN SYNC, AND ONLY ONE IS AUDIBLE.
 *
 * The obvious build - stop track A, start track B - cannot transition cleanly: the new
 * source starts at zero, or at an offset guessed from `currentTime`, and either way the
 * groove restarts or lurches. Starting all four together at the same instant and
 * crossfading their GAINS instead makes every transition sample-accurate for free,
 * forever, because the four sources never drift: they are four buffers on one clock.
 *
 * It costs four decoded buffers and four gain nodes, which is nothing, and it is why
 * THE FOUR FILES MUST BE THE SAME LENGTH AND TEMPO. They are four mixes of one
 * performance, not four different pieces.
 *
 * ------------------------------------------------------------------------------
 * THE AUDIO REACHES THE TRACK, not the laptop's speakers.
 *
 * It plays through the AudioContext the device already has, whose output the `webaudio`
 * chain sums into the device's signal path ([jweb~]'s outlets). A plain `<audio>`
 * element would go to the OS output device instead - past the fader, past the meters,
 * past anything Live is recording - which is the whole reason the sound is decoded and
 * played rather than simply played.
 *
 * ------------------------------------------------------------------------------
 * MISSING OR UNDECODABLE TRACKS ARE NOT AN ERROR. The four assets ship as empty
 * placeholders until somebody renders them, and a game that refused to start because
 * its soundtrack was a zero-byte file would be a worse device than a silent one. Each
 * layer is decoded independently: what decodes plays, what does not is silence, and the
 * console says which.
 */

/**
 * The four mixes, sparsest first.
 *
 * Imported rather than fetched by path: vite inlines every asset as a `data:` URI in a
 * single-file build (`vite-plugin-singlefile` sets `assetsInlineLimit` to inline
 * everything), so the tracks travel INSIDE the .amxd's payload and the page never has
 * to reach the filesystem. A `file://` page cannot `fetch()` a sibling file - Chromium
 * gives each file a unique opaque origin - so a path-based build would work on the dev
 * server and be silent in Live, which is exactly the failure this repo exists to avoid.
 *
 * OGG VORBIS, and that is a decision rather than a preference: MP3 carries encoder
 * delay at the start and padding at the end, `decodeAudioData` decodes both as silence,
 * and a looped MP3 therefore has a short gap at every wrap - on every layer, forever.
 * Ogg loops cleanly. The extension is otherwise not load-bearing (vite treats `.mp3`,
 * `.opus` and `.wav` as assets too, and `decodeAudioData` takes whatever Chromium can
 * decode), so changing format is changing these four lines.
 */
import level1 from "./music/level-1.ogg";
import level2 from "./music/level-2.ogg";
import level3 from "./music/level-3.ogg";
import level4 from "./music/level-4.ogg";
import themeTrack from "./music/theme.ogg";

const TRACKS = [level1, level2, level3, level4];

/** How many tension levels there are. Level 0 is the sparsest mix. */
export const MUSIC_LEVELS = TRACKS.length;

/**
 * How many segments the snake gains before the arrangement moves up.
 *
 * Three, not two: at two, the full mix arrived at segment 8 of 20 and the first three
 * layers were each heard for about fifteen seconds. Three gives every layer a real turn
 * and puts the densest mix at segment 11.
 */
const SEGMENTS_PER_LEVEL = 3;

/** How long a level change takes. Long enough not to click, short enough to feel like a cue. */
const CROSSFADE_S = 0.25;

/**
 * How many bars one loop is, which is what makes a level change land ON a bar.
 *
 * The layers are 18.823537 s. Eight bars of 4/4 in that time is 102.0000 BPM exactly - to
 * four decimal places, which is not a coincidence - so a bar is 2.352942 s. Nothing reads
 * the tempo from the file; this constant is the whole assumption, and it is the one line
 * to change if the tune is ever re-cut at a different length or metre.
 *
 * Getting it wrong is not fatal. Eight when the truth is four means changes land on
 * half-bars, which is still musical. It is only mid-bar changes that sound like a mistake.
 */
const BARS_PER_LOOP = 8;
/** The fade in at the start of a run and out at the end of one. */
const FADE_IN_S = 0.4;
const FADE_OUT_S = 0.6;

/**
 * Which mix a snake of this length should be playing.
 *
 * It follows LENGTH, which means a crash drops it back down - the snake restarts at two
 * and so does the arrangement. That is deliberate: the music is a readout of how fast
 * the game currently is, and after a crash the game is slow again. Making it monotonic
 * would mean the full mix under a two-segment snake, which reads as the device having
 * lost track of what is happening.
 */
export const musicLevelFor = (length: number) => Math.max(0, Math.min(MUSIC_LEVELS - 1, Math.floor((length - 2) / SEGMENTS_PER_LEVEL)));

export interface MusicPlayer {
  /** Decode (once) and start all four loops in sync, fading the current level in. */
  start(): Promise<void>;
  /**
   * Play the main tune once - the welcome on load, and again on a win.
   *
   * It stops the loops first. Nothing waits for a decode: if the theme is not there the
   * device is simply quiet.
   */
  playTheme(): void;
  /**
   * Stop the loops and play the full track once, for a win.
   *
   * It is NOT a fifth layer and cannot be one: it is 88.2 s at 48 kHz where the four
   * layers are 18.8 s at 22.05 kHz. Different length, so it cannot share their clock;
   * different piece, so it is not a denser mix of them. It is the whole arrangement, and
   * the one moment in a run that deserves the whole arrangement is filling the gauge.
   */

  /** Fade out and release the sources. `start()` may be called again afterwards. */
  stop(): void;
  /** 0 .. MUSIC_LEVELS-1. Crossfades; out of range is clamped. */
  setLevel(level: number): void;
  /** 0 .. 1, the `music` Live parameter. */
  setVolume(v: number): void;
  /** How many of the four actually decoded. 0 means the device is simply silent. */
  loaded(): number;
}

/**
 * A `data:` URI's bytes, without `fetch`.
 *
 * `fetch` on a data: URI works in a normal page, and this is not a normal page: it is a
 * `file://` document inside Max's embedded Chromium, where origin rules are their own
 * thing and a failure would be silent and only visible in Live. `atob` has no origin.
 */
function bytesFromDataUri(uri: string): ArrayBuffer {
  const binary = atob(uri.slice(uri.indexOf(",") + 1));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out.buffer;
}

async function fetchBytes(url: string): Promise<ArrayBuffer> {
  // A data: URI in the built device; an http URL from the dev server, where a real
  // fetch is both available and correct.
  if (url.startsWith("data:")) return bytesFromDataUri(url);
  const res = await fetch(url);
  return res.arrayBuffer();
}

/**
 * Build the player. Nothing is decoded until `start()`, so a device that is never run
 * costs nothing and a device whose tracks are placeholders still loads instantly.
 */
export function createMusic(ctx: AudioContext): MusicPlayer {
  const master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);

  // The theme has its own bus, so it can come up while the loops go down without the two
  // fighting over one gain.
  const themeBus = ctx.createGain();
  themeBus.gain.value = 0;
  themeBus.connect(ctx.destination);
  let themeBuffer: AudioBuffer | null = null;
  let themeSource: AudioBufferSourceNode | null = null;

  let buffers: (AudioBuffer | null)[] = [];
  let sources: (AudioBufferSourceNode | null)[] = [];
  let gains: GainNode[] = [];
  let decoding: Promise<void> | null = null;
  let level = 0;
  let volume = 0.5;
  let playing = false;
  /** When the loops started, and how long one is - the two numbers a bar boundary needs. */
  let loopStart = 0;
  let loopSeconds = 0;

  async function decodeAll(): Promise<void> {
    buffers = await Promise.all(
      TRACKS.map(async (url, i) => {
        try {
          // A placeholder is zero bytes and decodeAudioData rejects it. That is the
          // expected state until the tracks are rendered, so it is a console line and
          // not a thrown error.
          return await ctx.decodeAudioData(await fetchBytes(url));
        } catch {
          console.info(`[push-snake] music level ${i + 1} is not a decodable audio file - that layer will be silent`);
          return null;
        }
      }),
    );

    try {
      themeBuffer = await ctx.decodeAudioData(await fetchBytes(themeTrack));
    } catch {
      console.info("[push-snake] the theme is not a decodable audio file - the welcome and the win will be silent");
      themeBuffer = null;
    }

    const lengths = buffers.filter((b): b is AudioBuffer => !!b).map((b) => b.duration.toFixed(3));
    if (new Set(lengths).size > 1) {
      // Not fatal - they still play - but the transitions stop being sample-accurate
      // the moment the loops disagree, and that is invisible until you hear it.
      console.warn(`[push-snake] the music layers are different lengths (${lengths.join(", ")}s); transitions will drift`);
    }
  }

  function stopSources() {
    for (const s of sources) {
      try {
        s?.stop();
      } catch {
        // Already stopped, or never started. Nothing to undo.
      }
    }
    sources = [];
    gains = [];
  }

  /** The gain one layer should sit at right now: `volume` if it is the level, 0 otherwise. */
  const target = (i: number) => (i === level ? 1 : 0);

  function stopTheme(fade = 0) {
    const at = ctx.currentTime;
    themeBus.gain.cancelScheduledValues(at);
    themeBus.gain.setValueAtTime(themeBus.gain.value, at);
    themeBus.gain.linearRampToValueAtTime(0, at + Math.max(0.01, fade));
    const held = themeSource;
    themeSource = null;
    if (!held) return;
    window.setTimeout(
      () => {
        try {
          held.stop();
        } catch {
          // Already ended - the track is 88 s and a game can outlast it.
        }
      },
      fade * 1000 + 50,
    );
  }

  /**
   * The next bar line, in AudioContext time.
   *
   * This is why a level change does not interrupt the music. Web Audio parameter
   * automation is scheduled, not immediate: a ramp can be told to start at a time in the
   * future and it lands there sample-accurately. So the crossfade is booked for the next
   * bar rather than run now, and the arrangement changes on the beat.
   *
   * Falls back to "now" before the loops are running, when there is no grid to snap to.
   */
  function nextBar(): number {
    const now = ctx.currentTime;
    if (!loopSeconds || !playing) return now;
    const bar = loopSeconds / BARS_PER_LOOP;
    const elapsed = Math.max(0, now - loopStart);
    // A hair of lead-in, so a change asked for a millisecond before a bar line does not
    // land on the one after it.
    return loopStart + Math.ceil((elapsed + 0.005) / bar) * bar;
  }

  return {
    async start() {
      // A new game silences the theme, whether it is the welcome or a win still playing
      // out. It is 88 s long, so without this the run would start under it.
      stopTheme(FADE_OUT_S);
      if (playing) return;
      playing = true;
      // A page that has never had a user gesture starts its context suspended, and a
      // Push pad is not a gesture in this page at all.
      if (ctx.state === "suspended") await ctx.resume();
      decoding ??= decodeAll();
      await decoding;
      if (!playing) return; // stopped while decoding

      stopSources();
      const at = ctx.currentTime;
      loopStart = at;
      loopSeconds = buffers.find((b): b is AudioBuffer => !!b)?.duration ?? 0;
      buffers.forEach((buf, i) => {
        if (!buf) {
          sources[i] = null;
          return;
        }
        const src = ctx.createBufferSource();
        const gain = ctx.createGain();
        src.buffer = buf;
        src.loop = true;
        gain.gain.value = target(i);
        src.connect(gain).connect(master);
        // ONE start time for all four. This is the line that makes every later
        // transition sample-accurate: the sources share a clock and never drift.
        src.start(at);
        sources[i] = src;
        gains[i] = gain;
      });

      master.gain.cancelScheduledValues(at);
      master.gain.setValueAtTime(master.gain.value, at);
      master.gain.linearRampToValueAtTime(volume, at + FADE_IN_S);
    },

    playTheme() {
      // The loops go down and the whole tune comes up. Nothing waits for a decode: if the
      // theme is not there, this is silence rather than an error.
      this.stop();
      stopTheme();
      decoding ??= decodeAll();
      void decoding.then(() => {
        if (!themeBuffer || playing) return; // a game started while it decoded
        const at = ctx.currentTime;
        const src = ctx.createBufferSource();
        src.buffer = themeBuffer;
        src.connect(themeBus);
        src.start(at);
        themeSource = src;
        themeBus.gain.cancelScheduledValues(at);
        themeBus.gain.setValueAtTime(0, at);
        themeBus.gain.linearRampToValueAtTime(volume, at + FADE_IN_S);
      });
    },

    stop() {
      if (!playing) return;
      playing = false;
      const at = ctx.currentTime;
      master.gain.cancelScheduledValues(at);
      master.gain.setValueAtTime(master.gain.value, at);
      master.gain.linearRampToValueAtTime(0, at + FADE_OUT_S);
      // Release AFTER the fade, or the last thing anyone hears is the cut.
      const held = sources.slice();
      sources = [];
      gains = [];
      window.setTimeout(
        () => {
          for (const s of held) {
            try {
              s?.stop();
            } catch {
              // Already stopped.
            }
          }
        },
        FADE_OUT_S * 1000 + 50,
      );
    },

    setLevel(next) {
      const clamped = Math.max(0, Math.min(MUSIC_LEVELS - 1, Math.round(next)));
      if (clamped === level) return;
      level = clamped;

      // BOOKED FOR THE NEXT BAR, not run now. Eating a fruit happens whenever the snake
      // gets there, which is mid-bar most of the time, and swapping the arrangement
      // underneath the music at that moment sounds like a mistake rather than a cue.
      const now = ctx.currentTime;
      const at = nextBar();
      gains.forEach((g, i) => {
        g.gain.cancelScheduledValues(now);
        // Hold what it is now, all the way to the bar line, then cross.
        g.gain.setValueAtTime(g.gain.value, now);
        g.gain.setValueAtTime(g.gain.value, at);
        g.gain.linearRampToValueAtTime(target(i), at + CROSSFADE_S);
      });
    },

    setVolume(v) {
      volume = Math.max(0, Math.min(1, v));
      const now = ctx.currentTime;
      if (themeSource) {
        themeBus.gain.cancelScheduledValues(now);
        themeBus.gain.setValueAtTime(themeBus.gain.value, now);
        themeBus.gain.linearRampToValueAtTime(volume, now + 0.05);
      }
      if (!playing) return;
      const at = ctx.currentTime;
      master.gain.cancelScheduledValues(at);
      master.gain.setValueAtTime(master.gain.value, at);
      // Short, not instant: a dragged dial should not zipper.
      master.gain.linearRampToValueAtTime(volume, at + 0.05);
    },

    loaded: () => buffers.filter(Boolean).length,
  };
}
