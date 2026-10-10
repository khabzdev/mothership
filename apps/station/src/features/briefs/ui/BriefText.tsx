import { briefBlocks, inline } from "../blocks";

function Inlines({ text }: { text: string }) {
  return (
    <>
      {inline(text).map((part, i) =>
        part.kind === "bold" ? (
          <strong key={i}>{part.text}</strong>
        ) : part.kind === "code" ? (
          <code key={i}>{part.text}</code>
        ) : (
          part.text
        ),
      )}
    </>
  );
}

/** A brief's markdown as React elements (never raw HTML). */
export function BriefText({ text }: { text: string }) {
  return (
    <div className="brief-text">
      {briefBlocks(text).map((block, i) =>
        block.kind === "heading" ? (
          <h3 key={i} className="brief-text__heading">
            <Inlines text={block.text} />
          </h3>
        ) : block.kind === "list" ? (
          <ul key={i} className="brief-text__list">
            {block.items.map((item, j) => (
              <li key={j}>
                <Inlines text={item} />
              </li>
            ))}
          </ul>
        ) : (
          <p key={i} className="brief-text__para">
            <Inlines text={block.text} />
          </p>
        ),
      )}
    </div>
  );
}
