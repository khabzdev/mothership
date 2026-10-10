import { RoundedBox } from "@react-three/drei";
import { useEffect, useMemo } from "react";
import { BoxGeometry, CanvasTexture, SRGBColorSpace } from "three";
import { BOARD_GAP, BOARD_TILT, BOARDS, type BoardId } from "../layout";
import { GLOW, KIT, PAINTED } from "./materials";

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
/** The face's bottom edge above the ground; the plinth under it reaches up to its frame. */
const FACE_Y = 0.6;
const FRAME = 0.08;
const PLINTH_GEOMETRY = new BoxGeometry(1, FACE_Y - FRAME, 0.6);
/** Canvas pixels per metre the paint numbers below are drawn at (a 4.2 m board on 2 × PX). */
const DRAWN_PPM = (PX * 2) / 4.2;
/** How much taller text stands on the board than the paint numbers draw it. */
const TEXT_SCALE = 2;
const NOTE = { rows: 2, gap: 26, lines: 3 };
const DISPLAY = '"Big Shoulders Display", "Arial Narrow", sans-serif';
const MONO = '"Martian Mono", ui-monospace, monospace';
const SANS = '"Instrument Sans", ui-sans-serif, sans-serif';
const TITLES: Record<BoardId, string> = {
  mission: "MISSION BOARD",
  launch: "LAUNCH BOARD",
  queue: "TASK QUEUE",
};

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
  // Scale every size with the canvas so text reads TEXT_SCALE× as tall on the board.
  const k = (TEXT_SCALE * w) / BOARDS[board].width / DRAWN_PPM;
  const font = (weight: number, px: number, family: string) =>
    `${weight} ${Math.round(px * k)}px ${family}`;
  const top = 96 * k;
  const margin = 24 * k;
  const gap = NOTE.gap * k;
  c.fillStyle = "#1b1e26";
  c.fillRect(0, 0, w, h);
  c.fillStyle = "#14171e";
  c.fillRect(margin, top, w - 2 * margin, h - top - margin);
  // Header plate.
  c.fillStyle = trim;
  c.fillRect(0, 0, w, 12 * k);
  c.fillStyle = "#ece6d6";
  c.font = font(800, 54, DISPLAY);
  c.textBaseline = "middle";
  c.fillText(TITLES[board], 32 * k, 56 * k);
  c.textAlign = "right";
  c.font = font(500, 26, MONO);
  c.fillStyle = "#9a9382";
  c.fillText(note, w - 32 * k, 58 * k);
  c.textAlign = "left";

  const cols = board === "queue" ? 2 : 3;
  const cw = (w - 2 * margin - gap * (cols + 1)) / cols;
  const ch = (h - top - margin - gap * (NOTE.rows + 1)) / NOTE.rows;
  cards.slice(0, cols * NOTE.rows).forEach((card, i) => {
    const x = margin + gap + (i % cols) * (cw + gap);
    const y = top + gap + Math.floor(i / cols) * (ch + gap);
    const tilt = ((i * 37) % 7) / 7 - 0.5;
    c.save();
    c.translate(x + cw / 2, y + ch / 2);
    c.rotate(tilt * 0.06);
    c.fillStyle = "#00000055";
    c.fillRect(-cw / 2 + 5 * k, -ch / 2 + 7 * k, cw, ch);
    c.fillStyle = card.color;
    c.fillRect(-cw / 2, -ch / 2, cw, ch);
    // Pin.
    c.fillStyle = "#ef476f";
    c.beginPath();
    c.arc(0, -ch / 2 + 12 * k, 8 * k, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = "#2b2d42";
    c.font = font(700, 34, MONO);
    c.fillText(card.label, -cw / 2 + 16 * k, -ch / 2 + 48 * k);
    if (card.dot) {
      c.fillStyle = card.dot;
      c.beginPath();
      c.arc(cw / 2 - 22 * k, -ch / 2 + 46 * k, 12 * k, 0, Math.PI * 2);
      c.fill();
    }
    c.font = font(600, 25, SANS);
    wrap(c, card.title, cw - 28 * k, NOTE.lines).forEach((line, n) =>
      c.fillText(line, -cw / 2 + 14 * k, -ch / 2 + (82 + n * 30) * k),
    );
    c.restore();
  });
  if (!cards.length) {
    c.fillStyle = "#5e584b";
    c.font = font(500, 30, MONO);
    c.textAlign = "center";
    c.fillText("Nothing pinned up", w / 2, h / 2 + 40 * k);
    c.textAlign = "left";
  }
}

/**
 * A tack board in the north wall (agent-office's Issues and PR boards): its open cards pinned up as
 * notes, in the deck's trim, its face tilted back on a low plinth and lit by a strip along its top.
 * E in front of it opens it.
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
    <group position={[b.x, 0, b.z + 0.15]}>
      {/* The plinth: neighbours' plinths meet across the gap, so the boards stand as one wall. */}
      <mesh
        geometry={PLINTH_GEOMETRY}
        position={[0, (FACE_Y - FRAME) / 2, 0.05]}
        scale={[b.width + BOARD_GAP, 1, 1]}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial color={KIT.charcoal} {...PAINTED} />
      </mesh>
      {/* A framed panel hinged at its bottom edge, leaning back. */}
      <group position={[0, FACE_Y, 0]} rotation={[-BOARD_TILT, 0, 0]}>
        <RoundedBox
          args={[b.width + FRAME * 2, b.height + FRAME * 2, 0.08]}
          radius={0.03}
          position={[0, b.height / 2, 0.04]}
          castShadow
          receiveShadow
        >
          <meshStandardMaterial color={KIT.charcoal} {...PAINTED} />
        </RoundedBox>
        <mesh position={[0, b.height / 2, 0.082]}>
          <planeGeometry args={[b.width, b.height]} />
          <meshStandardMaterial
            color="#000000"
            emissive="#ffffff"
            emissiveMap={surface.texture}
            emissiveIntensity={0.9}
            roughness={0.5}
          />
        </mesh>
        <mesh position={[0, b.height + FRAME + 0.02, 0.06]}>
          <boxGeometry args={[b.width, 0.04, 0.05]} />
          <meshStandardMaterial
            color={KIT.ice}
            emissive={KIT.ice}
            emissiveIntensity={GLOW}
            toneMapped={false}
          />
        </mesh>
      </group>
    </group>
  );
}
