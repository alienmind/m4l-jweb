/**
 * Help.tsx (push-snake) - everything the pads mean, in one place.
 *
 * IT IS NOT A WINDOW, and that is the whole design. A declared `window()` is a second
 * page: its own bundle, its own Chromium context, its own copy of React, and no shared
 * state with the device view - a lot of machinery for four diagrams and a table.
 *
 * It is not an overlay either. `position: absolute; inset: 0` needs a positioned
 * ancestor, and `.device` is not one - in the dev harness the panel would escape the
 * 169 px box and cover the whole window. So it simply replaces the game in the layout
 * while it is open.
 *
 * THE DEVICE VIEW IS A FIXED ~169 px AND DOES NOT SCROLL. Anything taller clips
 * silently, and the reader never finds out there was more - so the body below scrolls
 * itself, inside a height that fits. That is the one thing to keep if this grows.
 */
import { PALETTE_CSS, type PadColour } from "@m4l-jweb/surface";

/** The three pads, in the order they sit on the bottom-left of the grid. */
const PADS: { colour: PadColour; label: string; does: string }[] = [
  { colour: "ocean", label: "left", does: "turn anticlockwise" },
  { colour: "amber", label: "centre", does: "hold to sprint" },
  { colour: "sky", label: "right", does: "turn clockwise" },
];

/** What the border ring is showing, and in which colour. */
const HUD: { colour: PadColour; what: string }[] = [
  { colour: "green", what: "length gauge - 20 cells, fill it to win" },
  { colour: "green", what: "three lives, bottom right, spent right to left" },
  { colour: "red", what: "a life you have lost" },
  { colour: "tan", what: "wall - the snake dies on it" },
];

function Swatch({ colour }: { colour: PadColour }) {
  return <span style={{ ...S.swatch, background: PALETTE_CSS[colour] }} />;
}

/**
 * The grid, drawn at a glance.
 *
 * Row 7 is the top, as it is on the Push. The bottom row is the only one that is not
 * gauge or wall, so it is the only one worth labelling.
 */
function Layout() {
  return (
    <div style={S.layout}>
      {Array.from({ length: 64 }, (_, i) => {
        const x = i % 8;
        const y = 7 - Math.floor(i / 8);
        const isPad = y === 0 && x < 3;
        const isLife = y === 0 && x >= 5;
        const isGauge = !isPad && !isLife && (x === 0 || x === 7 || y === 7);
        const colour: PadColour = isPad ? PADS[x]!.colour : isLife ? "green" : isGauge ? "green" : y === 0 ? "tan" : "black";
        return <span key={i} style={{ ...S.cell, background: PALETTE_CSS[colour], opacity: colour === "black" ? 0.35 : 1 }} />;
      })}
    </div>
  );
}

export function Help({ onClose }: { onClose: () => void }) {
  return (
    <div style={S.panel}>
      <div style={S.head}>
        <strong>Snake - how to play</strong>
        <button onClick={onClose} style={S.close}>
          close
        </button>
      </div>

      <div style={S.body}>
        <div style={S.row}>
          <Layout />
          <div style={S.notes}>
            <p style={S.p}>
              The snake lives in the inner 6x6. The border is a wall and it kills, so it is lit - on a grid with no visible edge, "I hit a wall" and
              "the device stopped responding" look the same.
            </p>
            <p style={S.p}>Eat fruit to grow. Every segment makes the snake 10% faster.</p>
          </div>
        </div>

        <table style={S.table}>
          <tbody>
            {PADS.map((p) => (
              <tr key={p.label}>
                <td style={S.td}>
                  <Swatch colour={p.colour} /> {p.label}
                </td>
                <td style={S.td}>{p.does}</td>
              </tr>
            ))}
            <tr>
              <td style={S.td}>
                <Swatch colour="green" /> all three
              </td>
              <td style={S.td}>while stopped: start a game</td>
            </tr>
          </tbody>
        </table>

        <p style={S.p}>
          The sprint is <strong>held, not toggled</strong>. Let go and the snake is back to its normal speed. The pad goes white while you hold it.
        </p>

        <table style={S.table}>
          <tbody>
            {HUD.map((h) => (
              <tr key={h.what}>
                <td style={S.td}>
                  <Swatch colour={h.colour} />
                </td>
                <td style={S.td}>{h.what}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <p style={S.p}>
          <strong>Winning and losing.</strong> Fill all twenty gauge cells and a green smiley blinks three times and stays. Lose all three lives and
          it is a red frown. Either way the face holds until you press a pad for the next game.
        </p>

        <p style={S.p}>
          <strong>A crash costs a life, not the run.</strong> The snake restarts at two segments and the gauge empties with it. That is what makes
          twenty hard.
        </p>

        <p style={S.p}>
          <strong>No Push in the room?</strong> The grid above the controls in the device view is live - click the three pads. Or use{" "}
          <kbd>&larr;</kbd> <kbd>&rarr;</kbd> to turn and hold <kbd>&uarr;</kbd> to sprint.
        </p>

        <p style={S.p}>
          <strong>Nothing on the Push?</strong> Turn <em>Takeovr</em> on. If it still does nothing, the line under the grid says which of four reasons
          it is - the Push may not be connected, or another instance of the device may have the grid.
        </p>

        <p style={S.p}>
          <strong>Parameters.</strong> <em>Diff</em> sets the starting speed, <em>Volume</em> is the game sounds, <em>Music</em> is the soundtrack,
          and <em>Sound</em> mutes both.
        </p>
      </div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  panel: { display: "flex", flexDirection: "column", minWidth: 0 },
  head: { display: "flex", alignItems: "center", gap: 8, paddingBottom: 4, borderBottom: "1px solid #444" },
  close: { marginLeft: "auto" },
  /*
   * THE SCROLLING HAPPENS HERE, and the height is a budget rather than a taste. The
   * device view is ~169 px: about 24 for the header, 16 for the padding and 20 for this
   * panel's own title row, which leaves roughly 105.
   */
  body: {
    maxHeight: 105,
    overflowY: "auto",
    paddingTop: 6,
    display: "flex",
    flexDirection: "column",
    gap: 6,
    fontSize: 10,
    lineHeight: 1.45,
  },
  row: { display: "flex", gap: 10, alignItems: "flex-start" },
  layout: { display: "grid", gridTemplateColumns: "repeat(8, 9px)", gap: 1, flex: "0 0 auto" },
  cell: { width: 9, height: 9, borderRadius: 2 },
  notes: { minWidth: 0 },
  p: { margin: 0, marginBottom: 4 },
  table: { borderCollapse: "collapse" },
  td: { padding: "1px 8px 1px 0", verticalAlign: "top", whiteSpace: "nowrap" },
  swatch: { display: "inline-block", width: 8, height: 8, borderRadius: 2, marginRight: 4, verticalAlign: "middle" },
};
