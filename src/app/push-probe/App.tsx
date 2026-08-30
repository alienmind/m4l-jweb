/**
 * push-probe - the spike for doc/PUSH-USECASES.md (and MAX-FACTS.md, "Grabbing a Push control").
 *
 * U1-U6 are answered and written up in doc/MAX-FACTS.md, "Grabbing a Push control".
 * What is left is the machinery answering them proved correct, the two things still
 * open (the colour names, and what the other matrix controls carry), and a small
 * playground that exercises the round trip end to end: press a pad, the page picks a
 * colour from how hard you hit it, the pad lights and STAYS lit until you press it
 * again.
 *
 * That latch is not a toy. It is the first thing in this repo holding a model of the
 * grid and reconciling the hardware to it - which is the whole job of `usePadGrid`,
 * minus the diff. If it feels wrong here it will feel wrong there.
 *
 * The device view is a FIXED 169 px and clips silently at the bottom: one button row
 * and one pane row, and the grid is 8 cells of 10 px. A row added here costs a row
 * of the grid.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { bindInlet, outlet } from "@m4l-jweb/bridge";
import { useSurface } from "@m4l-jweb/surface/react";
import { useDevice } from "../shared/device";
import { Frame } from "../shared/Frame";
import { IN, OUT } from "./protocol";
import { colourForVelocity, cssForIndex, nearestIndex, STRUCTURE_TEST, VELOCITY_BANDS } from "./palette";
import surface from "./surface";

/**
 * One event off the grabbed control's `value` observer.
 *
 * NAMED FROM MEASUREMENT: pressing the four corners of a Push 3 gave
 * `value <velocity> <x> <y> <1>`, with y = 7 on the BOTTOM row and y = 0 on the top.
 * So `yFromTop` is what the hardware says, and section 2.3's API counts the other
 * way - they are not the same number, and the difference is a mirrored device.
 */
interface PadEvent {
  velocity: number;
  x: number;
  /** As the hardware counts it: 0 is the TOP row. */
  yFromTop: number;
  /** Atom 4. Always 1 so far, press and release. Unnamed until it is understood. */
  extra: number;
  /** Max's clock, so a gap is the HARDWARE's gap and not Chromium's. */
  at: number;
}

/**
 * The image to render onto the pads.
 *
 * A GLOB rather than a plain import: the picture is optional, and a static import of
 * a missing module is a build error rather than an undefined. Drop any PNG at
 * `src/app/push-probe/image.png` and it is picked up on the next build; without one
 * the button says so instead of failing.
 *
 * Vite inlines a small asset as a data URL, so the picture travels inside the
 * device's own bundle like every other payload - nothing to find on disk at runtime,
 * which matters because a [jweb] page is a `file://` page with no working directory
 * anyone should rely on.
 */
const images = import.meta.glob("./image.{png,gif,jpg,jpeg,webp}", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
const IMAGE_URL: string | undefined = Object.values(images)[0];

const LOG_LIMIT = 400;
const EVENT_LIMIT = 64;

/** The key for a pad in the latch, in the HARDWARE's coordinates (y from the top). */
const padKey = (x: number, yFromTop: number) => `${x},${yFromTop}`;

export default function PushProbe() {
  const device = useDevice();
  // The two dials the encoders carry - see surface.ts. Read only, here.
  const [params] = useSurface(surface);
  const [log, setLog] = useState<string[]>([]);
  const [events, setEvents] = useState<PadEvent[]>([]);
  const [grabbed, setGrabbed] = useState(false);

  /**
   * WHAT IS LIT, in hardware coordinates: pad key -> palette index.
   *
   * The page's model of the grid, and the only one - the hardware has no readable
   * state, so a pad missing from here is a pad we have lost track of. `probe_blanked`
   * exists precisely so Max can say it wiped the grid underneath us.
   */
  const [lit, setLit] = useState<Record<string, number>>({});
  /**
   * The raw MPE stream, newest first.
   *
   * THE EXPERIMENT: the grabbed Button_Matrix carries press and release with a
   * velocity and nothing else - no aftertouch, no slide, measured over four rounds.
   * The donor device that owns the pads ALSO declares `is_mpe 1`, which is what makes
   * Live send it per-note expression as ordinary MIDI. If anything appears in this
   * list while the grid is held, the two paths coexist and expression is reachable
   * after all - on the note path, not through the grab.
   */
  const [mpe, setMpe] = useState<string[]>([]);
  /** Which non-matrix controls `probe_other` is currently holding, so they can be given back. */
  const [otherHeld, setOtherHeld] = useState<Record<string, boolean>>({});
  const logEnd = useRef<HTMLDivElement | null>(null);

  const send = useCallback((selector: string, ...args: unknown[]) => outlet(selector, ...args), []);
  const note = useCallback((line: string) => setLog((prev) => [...prev, line].slice(-LOG_LIMIT)), []);

  /** Paint one cell and record it, so the model and the hardware move together. */
  const paint = useCallback((x: number, yFromTop: number, colour: number) => {
    outlet(OUT.probe_paint, x, yFromTop, colour);
    setLit((prev) => {
      const next = { ...prev };
      if (colour) next[padKey(x, yFromTop)] = colour;
      else delete next[padKey(x, yFromTop)];
      return next;
    });
  }, []);

  useEffect(() => {
    // A log line crosses as a SYMBOL, and Max splits a symbol on whitespace - so it
    // arrives as several atoms. Rejoin with single spaces: a probe log has no
    // meaningful whitespace, which is why it can be handled this cheaply.
    bindInlet(IN.probe_log, (...args) => setLog((prev) => [...prev, args.map(String).join(" ")].slice(-LOG_LIMIT)));

    bindInlet(IN.probe_pad, (velocity, x, yFromTop, extra, at) => {
      const e: PadEvent = { velocity: Number(velocity), x: Number(x), yFromTop: Number(yFromTop), extra: Number(extra), at: Number(at) };
      setEvents((prev) => [e, ...prev].slice(0, EVENT_LIMIT));

      // THE LATCH. A press toggles; a release is ignored entirely.
      //
      // Ignoring the release is what makes this a toggle rather than a momentary
      // light, and it is why the handler cannot be "paint on down, clear on up" - the
      // pad has to survive the finger leaving it. The colour comes from the velocity,
      // so the pad also records how hard it was hit.
      if (e.velocity <= 0) return;
      const key = padKey(e.x, e.yFromTop);
      setLit((prev) => {
        const next = { ...prev };
        if (prev[key]) {
          delete next[key];
          outlet(OUT.probe_paint, e.x, e.yFromTop, 0);
        } else {
          const colour = colourForVelocity(e.velocity);
          next[key] = colour;
          outlet(OUT.probe_paint, e.x, e.yFromTop, colour);
        }
        return next;
      });
    });

    // Straight off [mpeparse] outlet 9, uninterpreted - the atoms, in order. The
    // reference names the fields and not the values of `messageNumber`, so nothing
    // here decodes it.
    bindInlet(IN.mpeevent, (...args) => setMpe((prev) => [args.map(String).join(" "), ...prev].slice(0, EVENT_LIMIT)));

    bindInlet(IN.probe_state, (on) => setGrabbed(Number(on) === 1));
    // Max blanked the grid on its deferred first frame, so our model is stale.
    bindInlet(IN.probe_blanked, () => setLit({}));
  }, []);

  useEffect(() => {
    logEnd.current?.scrollIntoView({ block: "nearest" });
  }, [log]);

  /**
   * Draw the image onto the pads.
   *
   * The decode is entirely the browser's: draw into an 8x8 canvas, which scales and
   * resamples whatever it was given, then read the 64 pixels back and match each to a
   * palette index. An 8x8 source (yours is) skips the resampler, so every pixel is
   * exactly one pad.
   *
   * Row 0 of an image is its TOP row, and so is y = 0 on the hardware, so nothing is
   * flipped here. Worth naming as a coincidence rather than a convention: everywhere
   * the API's own orientation is involved, y counts from the bottom and something has
   * to flip.
   */
  const renderImage = useCallback(() => {
    if (!IMAGE_URL) {
      note("no image: drop one at src/app/push-probe/image.png and rebuild");
      return;
    }
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 8;
      canvas.height = 8;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, 8, 8);
      const { data } = ctx.getImageData(0, 0, 8, 8);
      const next: Record<string, number> = {};
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const i = (y * 8 + x) * 4;
          const colour = nearestIndex(data[i], data[i + 1], data[i + 2], data[i + 3]);
          outlet(OUT.probe_paint, x, y, colour);
          if (colour) next[padKey(x, y)] = colour;
        }
      }
      setLit(next);
      note(`image rendered - ${img.naturalWidth}x${img.naturalHeight} source, 64 pads matched to the provisional palette`);
    };
    img.onerror = () => note("image failed to decode");
    img.src = IMAGE_URL;
  }, [note]);

  /**
   * Grab or release one control by name.
   *
   * A toggle rather than a grab-only button because a spike that can take the scene
   * column and not hand it back is a spike you have to delete the device to escape.
   */
  const toggleOther = useCallback(
    (name: string) => {
      const held = !!otherHeld[name];
      outlet(OUT.probe_other, name, held ? 0 : 1);
      setOtherHeld((prev) => ({ ...prev, [name]: !held }));
    },
    [otherHeld],
  );

  /**
   * Paint the structure test and say what each band should look like.
   *
   * The whole point is that the ANSWER is on the hardware and not in this log: the
   * log states the prediction, the pads state what happened, and the two either agree
   * or they do not. See STRUCTURE_TEST in palette.ts for what the pattern is and why
   * it carries an orientation marker.
   */
  const structureTest = useCallback(() => {
    setLit(() => {
      const next: Record<string, number> = {};
      for (const c of STRUCTURE_TEST) {
        outlet(OUT.probe_paint, c.x, c.yFromTop, c.index);
        next[padKey(c.x, c.yFromTop)] = c.index;
      }
      return next;
    });
    note("structure test - top-left L is the orientation marker, index 3");
    note("row 3 (x 0-2) = 1,2,3: dark grey, grey, white - the photographs say 2 is RED");
    note("row 5 (x 0-6) = 5,9,13,17,21,25,29: red amber yellow lime green spring turquoise");
    note("row 7 (x 0-6) = 33,37,41,45,49,53,57: cyan sky ocean blue orchid magenta pink");
  }, [note]);

  const clearAll = useCallback(() => {
    send(OUT.probe_clear);
    setLit({});
  }, [send]);

  return (
    <Frame title="PUSH PROBE" device={device}>
      <dt style={S.dt}>{grabbed ? "held" : "probe"}</dt>
      <dd>
        <div style={S.buttons}>
          <button style={S.btn} onClick={() => send(OUT.probe_scan)}>
            scan
          </button>
          <button style={S.btn} onClick={() => send(OUT.probe_names)}>
            names
          </button>
          <button style={grabbed ? S.btnOn : S.btn} onClick={() => send(OUT.probe_grab)}>
            grab
          </button>
          <button style={S.btn} onClick={() => send(OUT.probe_release)}>
            release
          </button>
          <button style={S.btn} onClick={clearAll}>
            clear pads
          </button>
          <button style={S.btn} onClick={renderImage} title={IMAGE_URL ? "src/app/push-probe/image.png" : "no image.png in the device folder"}>
            image{IMAGE_URL ? "" : " ?"}
          </button>
          {/* STILL OPEN: the colour NAMES are not derived from these photographs yet. */}
          <button style={S.btn} onClick={() => send(OUT.probe_palette, 0)}>
            pal 0-63
          </button>
          <button style={S.btn} onClick={() => send(OUT.probe_palette, 1)}>
            pal 64-127
          </button>
          {/* Item 1b of doc/TODO.md: does the Push 2 every-four structure hold on a Push 3? */}
          <button style={S.btn} onClick={structureTest} title="paint the greys and the two hue ladders, with an orientation marker">
            struct
          </button>
          {/*
            STILL OPEN: the controls beside Button_Matrix that nobody has looked at.
            The first is where per-pad expression would live if it is reachable
            through a grab at all - the matrix itself carries none.
          */}
          {[
            // Not a pad control at all - the scene column. THE point of this one: if the
            // MPE stream survives grabbing it, a device can own part of the surface and
            // keep expressive notes on the rest. If it dies, any grab silences the pads
            // and the rule `defineControls` enforces is the stricter one.
            "Scene_Launch_Buttons",
            // THE CONTINUOUS CONTROLS, and the reason the DJ layout in section 7 was
            // redrawn: a jog wheel and a touch strip are the gestures the pads cannot
            // give (no slide, no pressure). Whether either emits a usable stream under
            // a grab is unmeasured, and it decides whether that layout is buildable.
            "Jogwheel",
            "Touch_Strip_Control",
            "Mpe_Pitch_Bend_Elements",
            "Double_Press_Matrix",
            "Single_Press_Event_Matrix",
          ].map((name) => (
            <button key={name} style={otherHeld[name] ? S.btnOn : S.btn} title={name} onClick={() => toggleOther(name)}>
              {name.split("_")[0].toLowerCase()}?
            </button>
          ))}
          <button
            style={S.btn}
            onClick={() => {
              setLog([]);
              setEvents([]);
              setMpe([]);
            }}
          >
            clear log
          </button>
          <span style={S.dim}>
            A {Math.round(Number(params.probea))} B {Math.round(Number(params.probeb))}
          </span>
        </div>
      </dd>

      {/* Spans both dl columns: the dt label would cost width the grid needs. */}
      <dd style={S.wide}>
        <div style={S.panes}>
          {/*
            Drawn with the BOTTOM row at the bottom - section 2.3's orientation, not
            the hardware's. The latch is keyed in hardware coordinates and flipped
            here, in ONE place, which is exactly what the library will have to do.
          */}
          <div style={S.grid}>
            {Array.from({ length: 64 }, (_, i) => {
              const x = i % 8;
              const yFromTop = Math.floor(i / 8);
              const colour = lit[padKey(x, yFromTop)];
              return (
                <div
                  key={i}
                  title={`x ${x}, y ${7 - yFromTop}${colour ? ` = ${colour}` : ""}`}
                  style={{ ...S.cell, background: colour ? cssForIndex(colour) : "#0e1013" }}
                  // Clicking a cell toggles it exactly as a pad press does, at a
                  // velocity in the middle band - so the whole round trip can be
                  // exercised with no hardware in the room.
                  onClick={() => paint(x, yFromTop, colour ? 0 : colourForVelocity(64))}
                />
              );
            })}
          </div>

          <ol style={S.events}>
            <li style={S.dim}>x,y vel gap</li>
            {events.map((e, i) => (
              <li key={`${e.at}-${i}`} style={S.event}>
                <span style={S.dim}>
                  {e.x},{7 - e.yFromTop}
                </span>{" "}
                {/* The velocity in the colour it would light, so the ramp is legible. */}
                <span style={{ color: e.velocity ? cssForIndex(colourForVelocity(e.velocity)) : "#4d5460" }}>{e.velocity}</span>{" "}
                {/* The gap since the PREVIOUS event, on Max's clock. */}
                <span style={S.dim}>{i + 1 < events.length ? `+${e.at - events[i + 1].at}` : ""}</span>
              </li>
            ))}
            {!events.length && <li style={S.dim}>grab, then press a pad</li>}
          </ol>

          {/*
            THE OTHER DOOR. Empty means Live is sending this device no MPE - either
            nothing is playing the pads, or holding the grid takes them off the note
            path entirely, which is itself the answer.
          */}
          <ol style={S.events}>
            <li style={S.dim}>mpeevent {mpe.length ? "" : "(none)"}</li>
            {mpe.map((line, i) => (
              <li key={i} style={S.event}>
                {line}
              </li>
            ))}
          </ol>

          <div style={S.log}>
            {/* The velocity ramp itself, so the pads read as a scale rather than a scatter. */}
            <div>
              {VELOCITY_BANDS.map((b) => (
                <span key={b.index} style={{ color: cssForIndex(b.index), marginRight: 5 }}>
                  {b.min}+
                </span>
              ))}
            </div>
            {log.map((line, i) => (
              <div key={i} style={S.line}>
                {line}
              </div>
            ))}
            <div ref={logEnd} />
          </div>
        </div>
      </dd>
    </Frame>
  );
}

const mono = "ui-monospace, SFMono-Regular, Menlo, monospace";

/**
 * THE HEIGHT BUDGET, and it is why these numbers are what they are.
 *
 * 169 px total. The device's own padding takes 16, the Frame header about 23, the
 * gap 6 - leaving roughly 124 for everything here. One button row wraps to ~34, and
 * eight pad rows at 10 px plus a 1 px gap is 88. That fits, with nothing to spare, so
 * a row added to this page costs a row of the grid.
 */
const CELL = 10;
const PANE_H = 8 * (CELL + 1);

const S: Record<string, React.CSSProperties> = {
  dt: { alignSelf: "start" },
  wide: { gridColumn: "1 / -1" },
  buttons: { display: "flex", flexWrap: "wrap", gap: 2, alignItems: "center" },
  btn: { background: "#242932", color: "#c8ccd4", border: "1px solid #333a45", borderRadius: 3, padding: "0 5px", font: `10px ${mono}` },
  btnOn: { background: "#2f5f42", color: "#dff3e6", border: "1px solid #4a8a63", borderRadius: 3, padding: "0 5px", font: `10px ${mono}` },
  panes: { display: "flex", gap: 6, alignItems: "flex-start" },
  grid: { display: "grid", gridTemplateColumns: `repeat(8, ${CELL}px)`, gap: 1, flex: "0 0 auto" },
  cell: { width: CELL, height: CELL, border: "1px solid #262a31", borderRadius: 1, cursor: "pointer" },
  events: { listStyle: "none", margin: 0, padding: 0, width: 92, height: PANE_H, overflowY: "auto", font: `9px ${mono}` },
  event: { whiteSpace: "nowrap" },
  log: { flex: 1, height: PANE_H, overflowY: "auto", font: `9px ${mono}`, color: "#c8ccd4" },
  line: { whiteSpace: "pre-wrap", wordBreak: "break-word" },
  dim: { color: "#7d8694" },
};
