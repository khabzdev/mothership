import type { Finding } from "../model";

function FindingRow({ finding }: { finding: Finding }) {
  return (
    <li className="inspection__finding">
      {finding.file && (
        <code className="inspection__place">
          {finding.line ? `${finding.file}:${finding.line}` : finding.file}
        </code>
      )}
      <span className="inspection__title">{finding.title}</span>
      <span className="inspection__why">{finding.why}</span>
    </li>
  );
}

/** A headed list of findings, shared by the Inspection window and /lite; empty renders nothing. */
export function FindingList({ heading, findings }: { heading: string; findings: Finding[] }) {
  if (!findings.length) return null;
  return (
    <section>
      <h3 className="inspection__heading">{heading}</h3>
      <ul className="inspection__list">
        {findings.map((f, i) => (
          <FindingRow key={i} finding={f} />
        ))}
      </ul>
    </section>
  );
}
