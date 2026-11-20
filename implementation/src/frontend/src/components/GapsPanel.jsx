import React from 'react';

const ICON = { missing: '❌', ambiguous: '⚠️', conflict: '⛔' };

export default function GapsPanel({ questions, answers, setAnswers, onRegenerate, loading }) {
  if (!questions.length) return null;
  const update = (id, patch) => setAnswers((a) => ({ ...a, [id]: { ...a[id], ...patch } }));
  const pending = questions.filter((q) => {
    const a = answers[q.id];
    return !(a?.answer?.trim() || a?.acceptGap || q.resolved);
  }).length;

  return (
    <section className="card">
      <div className="card-head">
        <h2>Gaps &amp; questions for the author</h2>
        <span className="muted">{pending} unresolved</span>
      </div>
      <div className="card-body">
        <p className="muted small">Answer each question (confirmed by the product owner) or accept it as a known gap, then regenerate. The result stays <b>Draft</b> until every question is resolved.</p>
        <table className="grid">
          <thead>
            <tr><th>#</th><th>Area</th><th>Finding</th><th>Question</th><th>Answer</th><th>Accept as gap</th></tr>
          </thead>
          <tbody>
            {questions.map((q) => {
              const a = answers[q.id] || { answer: q.answer || '', acceptGap: q.acceptGap };
              return (
                <tr key={q.id}>
                  <td>{q.id}</td>
                  <td>{q.area}</td>
                  <td title={q.finding}>{ICON[q.finding]} {q.finding}</td>
                  <td>{q.question}{q.impact && <div className="muted small">{q.impact}</div>}</td>
                  <td><textarea rows={2} value={a.answer || ''} onChange={(e) => update(q.id, { answer: e.target.value, acceptGap: false })} /></td>
                  <td className="center"><input type="checkbox" checked={Boolean(a.acceptGap)} onChange={(e) => update(q.id, { acceptGap: e.target.checked, answer: '' })} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="right">
          <button className="btn primary" onClick={onRegenerate} disabled={loading}>↻ Regenerate with answers</button>
        </div>
      </div>
    </section>
  );
}
