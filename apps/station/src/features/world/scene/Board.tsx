import { useEffect, useMemo } from "react";
import { CanvasTexture, SRGBColorSpace } from "three";
import { BOARDS, type BoardId } from "../layout";

/** A card pinned to a board: what it says, and its colour. */
export interface BoardCard {
  key: string;
  label: string;
  title: string;
  color: string;
  /** A small status dot (CI, assignment), if any. */
  dot?: string;
}

const PX = 512;
const NOTE = { cols: 4, rows: 2, gap: 26 };
const TITLES: Record<BoardId, string> = { mission: "MISSION BOARD", launch: "LAUNCH BOARD" };

/** Wrap `text` into at most `lines` lines that fit `width`. */
function wrap(c: CanvasRenderingContext2D, text: string, width: number, lines: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (c.measureText(next).width <= width) line = next;
    else {
      out.push(line);
      line = word;
      if (out.length === lines) break;
    }
  }
  if (out.length < lines && line) out.push(line);
  if (out.length === lines && text.length > out.join(" ").length)
    out[lines - 1] = `${out[lines - 1]}…`;
  return out;
}

function paint(
  canvas: HTMLCanvasElement,
  board: BoardId,
  cards: BoardCard[],
  trim: string,
  note: string,
) {
  const c = canvas.getContext("2d")!;
  const { width: w, height: h } = canvas;
  c.fillStyle = "#1b1e26";
  c.fillRect(0, 0, w, h);
  c.fillStyle = "#14171e";
  c.fillRect(24, 96, w - 48, h - 120);
  // Header plate.
  c.fillStyle = trim;
  c.fillRect(0, 0, w, 12);
  c.fillStyle = "#ece6d6";
  c.font = '800 54px "Big Shoulders Display", "Arial Narrow", sans-serif';
  c.textBaseline = "middle";
  c.fillText(TITLES[board], 32, 56);
  c.textAlign = "right";
  c.font = '500 26px "Martian Mono", ui-monospace, monospace';
  c.fillStyle = "#9a9382";
  c.fillText(note, w - 32, 58);
  c.textAlign = "left";

  const cw = (w - 48 - NOTE.gap * (NOTE.cols + 1)) / NOTE.cols;
  const ch = (h - 120 - NOTE.gap * (NOTE.rows + 1)) / NOTE.rows;
  cards.slice(0, NOTE.cols * NOTE.rows).forEach((card, i) => {
    const x = 24 + NOTE.gap + (i % NOTE.cols) * (cw + NOTE.gap);
    const y = 96 + NOTE.gap + Math.floor(i / NOTE.cols) * (ch + NOTE.gap);
    const tilt = ((i * 37) % 7) / 7 - 0.5;
    c.save();
    c.translate(x + cw / 2, y + ch / 2);
    c.rotate(tilt * 0.06);
    c.fillStyle = "#00000055";
    c.fillRect(-cw / 2 + 5, -ch / 2 + 7, cw, ch);
    c.fillStyle = card.color;
    c.fillRect(-cw / 2, -ch / 2, cw, ch);
    // Pin.
    c.fillStyle = "#ef476f";
    c.beginPath();
    c.arc(0, -ch / 2 + 12, 8, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = "#2b2d42";
    c.font = '700 34px "Martian Mono", ui-monospace, monospace';
    c.fillText(card.label, -cw / 2 + 16, -ch / 2 + 48);
    if (card.dot) {
      c.fillStyle = card.dot;
      c.beginPath();
      c.arc(cw / 2 - 22, -ch / 2 + 46, 12, 0, Math.PI * 2);
      c.fill();
    }
    c.font = '600 25px "Instrument Sans", ui-sans-serif, sans-serif';
    wrap(c, card.title, cw - 28, 4).forEach((line, n) =>
      c.fillText(line, -cw / 2 + 14, -ch / 2 + 82 + n * 30),
    );
    c.restore();
  });
  if (!cards.length) {
    c.fillStyle = "#5e584b";
    c.font = '500 30px "Martian Mono", ui-monospace, monospace';
    c.textAlign = "center";
    c.fillText("Nothing pinned up", w / 2, h / 2 + 40);
    c.textAlign = "left";
  }
}

/**
 * A tack board on the north bulkhead (agent-office's Issues and PR boards): its open cards pinned
 * up as notes, in the deck's trim. E in front of it opens it.
 */
export function Board({
  board,
  cards,
  note,
  trim,
}: {
  board: BoardId;
  cards: BoardCard[];
  note: string;
  trim: string;
}) {
  const b = BOARDS[board];
  const surface = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = PX * 2;
    canvas.height = Math.round((PX * 2 * b.height) / b.width);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 8;
    return { canvas, texture };
  }, [b.height, b.width]);

  useEffect(() => {
    const draw = () => {
      paint(surface.canvas, board, cards, trim, note);
      surface.texture.needsUpdate = true;
    };
    draw();
    void document.fonts?.ready.then(draw);
  }, [surface, board, cards, trim, note]);
  useEffect(() => () => surface.texture.dispose(), [surface]);

  return (
    <group position={[b.x, 1.65, b.z + 0.17]}>
      {/* Set back so its face doesn't fight the board's picture. */}
      <mesh position={[0, 0, -0.035]}>
        <boxGeometry args={[b.width + 0.16, b.height + 0.16, 0.04]} />
        <meshToonMaterial color={trim} />
      </mesh>
      <mesh>
        <planeGeometry args={[b.width, b.height]} />
        <meshBasicMaterial map={surface.texture} toneMapped={false} />
      </mesh>
    </group>
  );
}
