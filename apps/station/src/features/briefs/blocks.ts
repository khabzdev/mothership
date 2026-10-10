/** The few markdown shapes a brief uses, as data the UI renders as React elements. */
export type Block =
  | { kind: "heading"; text: string }
  | { kind: "para"; text: string }
  | { kind: "list"; items: string[] };

export type Inline = { kind: "text" | "bold" | "code"; text: string };

const HASH_HEADING = /^\s*#{1,6}\s+(.*?)\s*#*\s*$/;
const BOLD_HEADING = /^\s*\*\*([^*]+)\*\*\s*:?\s*$/;
const LIST_ITEM = /^\s*(?:[-*]|\d+\.)\s+(.*)$/;

function headingOf(line: string): string | null {
  const m = HASH_HEADING.exec(line) ?? BOLD_HEADING.exec(line);
  return m ? m[1]!.trim() : null;
}

/** Headings, lists and paragraphs of a brief's text. */
export function briefBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: "para", text: para.join(" ") });
    para = [];
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const heading = headingOf(line);
    if (heading !== null) {
      flush();
      blocks.push({ kind: "heading", text: heading });
      continue;
    }
    const item = LIST_ITEM.exec(line);
    if (item) {
      flush();
      const last = blocks[blocks.length - 1];
      if (last?.kind === "list") last.items.push(item[1]!.trim());
      else blocks.push({ kind: "list", items: [item[1]!.trim()] });
      continue;
    }
    // Text right after a list goes in a new paragraph, not onto the list.
    para.push(line);
  }
  flush();
  return blocks;
}

/** `**bold**` and `` `code` `` runs of a line; unclosed markers stay plain text. */
export function inline(text: string): Inline[] {
  const parts: Inline[] = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`/g;
  let at = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > at) parts.push({ kind: "text", text: text.slice(at, m.index) });
    parts.push(m[1] !== undefined ? { kind: "bold", text: m[1] } : { kind: "code", text: m[2]! });
    at = m.index + m[0].length;
  }
  if (at < text.length) parts.push({ kind: "text", text: text.slice(at) });
  return parts;
}
