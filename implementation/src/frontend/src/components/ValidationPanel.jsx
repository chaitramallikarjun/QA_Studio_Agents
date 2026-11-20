import React from 'react';

export default function ValidationPanel({ data }) {
  const v = data.validation;
  const high = v.critic.filter((c) => c.severity === 'high').length;
  const ok = v.errors.length === 0 && high === 0;
  return (
    <details className="card validation" open={!ok}>
      <summary className="card-head">
        <h2>Accuracy report</h2>
        <span className={`pill ${ok ? 'final' : 'draft'}`}>{ok ? 'All checks passed' : `${v.errors.length} errors · ${high} high review issues`}</span>
      </summary>
      <div className="card-body small">
        <p>
          {data.requirements.length} verified requirements · {data.source.rejectedRequirements.length} discarded (quote not in Jira) · {v.duplicatesRemoved.length} duplicates removed · {v.attempts.length} generation attempt(s)
        </p>
        {[['Automated check errors', v.errors], ['Warnings', v.warnings]].map(([title, list]) =>
          list.length ? (
            <div key={title}>
              <h4>{title}</h4>
              <ul>{list.map((e, i) => <li key={i}><b>{e.location}</b>: {e.problem}</li>)}</ul>
            </div>
          ) : null,
        )}
        {v.critic.length > 0 && (
          <>
            <h4>Reviewer agent findings</h4>
            <ul>{v.critic.map((c, i) => <li key={i}><span className={`sev ${c.severity}`}>{c.severity}</span> <b>{c.location}</b>: {c.problem} <i>{c.fix}</i></li>)}</ul>
          </>
        )}
        {data.source.rejectedRequirements.length > 0 && (
          <>
            <h4>Discarded (unverifiable) requirements</h4>
            <ul>{data.source.rejectedRequirements.map((r, i) => <li key={i}>{r.statement}</li>)}</ul>
          </>
        )}
        <h4>Verified requirements</h4>
        <table className="grid">
          <thead><tr><th>REQ</th><th>Requirement</th><th>Category</th><th>Source quote</th></tr></thead>
          <tbody>{data.requirements.map((r) => <tr key={r.id}><td>{r.id}</td><td>{r.statement}</td><td>{r.category}</td><td>“{r.quote}” <span className="muted">({r.segment})</span></td></tr>)}</tbody>
        </table>
      </div>
    </details>
  );
}
