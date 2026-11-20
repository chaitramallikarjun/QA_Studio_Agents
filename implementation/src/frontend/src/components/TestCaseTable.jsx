import React from 'react';

function Gherkin({ text }) {
  return (
    <pre className="gherkin">
      {String(text).split('\n').map((line, i) => {
        const m = line.match(/^\s*(Given|When|Then|And|But)\b(.*)$/);
        return <div key={i}>{m ? <><b>{m[1]}</b>{m[2]}</> : line}</div>;
      })}
    </pre>
  );
}

export default function TestCaseTable({ testCases }) {
  if (!testCases.length) return <div className="state empty">No test cases were generated.</div>;
  return (
    <div className="table-wrap">
      <table className="grid tc">
        <thead>
          <tr>
            <th>Scenario#</th><th>REQ</th><th>Module</th><th>Functionality</th><th>Title</th><th>Type</th><th>Tags</th><th>Priority</th><th>Status</th><th>Test Steps (Gherkin)</th><th>Expected</th><th>Confidence</th>
          </tr>
        </thead>
        <tbody>
          {testCases.map((t) => (
            <tr key={t.id}>
              <td><b>{t.id}</b></td>
              <td>{t.reqIds.join(', ')}</td>
              <td>{t.module}</td>
              <td>{t.functionality}</td>
              <td>{t.title}<div className="muted small">{t.technique}</div></td>
              <td><span className={`tag t-${t.type.toLowerCase()}`}>{t.type}</span></td>
              <td>{t.tags.map((g) => <span key={g} className="tag">{g}</span>)}</td>
              <td>{t.priority}</td>
              <td><span className="pill">{t.status}</span></td>
              <td><Gherkin text={t.steps} />{t.preconditions && <div className="muted small">Pre: {t.preconditions}</div>}</td>
              <td>{t.expectedResult}<div className="muted small" title="Source quote">“{t.sourceQuote}”</div></td>
              <td className={t.confidence === 'Low' ? 'low' : ''}>{t.confidence}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
