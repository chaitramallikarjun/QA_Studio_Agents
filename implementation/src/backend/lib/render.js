const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');

export function renderDocument({ doc, status, sourceInfo, questions, requirements }) {
  const out = [];
  out.push(`# ${doc.title || 'Untitled'}`);
  out.push('');
  out.push(`> **Status:** ${status}. Not approved until a QA owner signs off.  `);
  out.push(`> **Source:** ${sourceInfo.keys.join(', ')} · **Model:** ${sourceInfo.model}`);
  out.push('');
  out.push('_Legend: **[D]** Documented in Jira · **[P]** Proposed testing activity · **[?]** Insufficient information_');
  for (const s of doc.sections) {
    out.push('', `## ${s.heading}`, '');
    for (const it of s.items) {
      const tag = it.basis === 'Documented' ? '[D]' : it.basis === 'Proposed' ? '[P]' : '[?]';
      const refs = it.reqIds.length ? ` _(${it.reqIds.join(', ')})_` : '';
      out.push(`- **${tag}** ${it.text}${refs}`);
    }
  }
  out.push('', '## Gaps & Questions for the author', '');
  if (!questions.length) out.push('No open questions were identified.');
  else {
    out.push('| # | Area | Finding | Question | Resolution |', '|---|---|---|---|---|');
    for (const q of questions) {
      const res = q.answer ? `Answered: ${q.answer}` : q.acceptGap ? 'Accepted as gap' : '**Open**';
      out.push(`| ${q.id} | ${cell(q.area)} | ${q.finding} | ${cell(q.question)} | ${cell(res)} |`);
    }
  }
  out.push('', '## Requirement traceability', '', '| REQ | Requirement | Source | Quote |', '|---|---|---|---|');
  for (const r of requirements) out.push(`| ${r.id} | ${cell(r.statement)} | ${r.segment} | “${cell(r.quote)}” |`);
  return out.join('\n') + '\n';
}
