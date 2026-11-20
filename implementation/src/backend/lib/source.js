export const MAX_SOURCE_CHARS = 60000;

export function normalizeText(s) {
  return String(s ?? '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function buildSegments(issues, clarifications = []) {
  const segs = [];
  const push = (id, text) => {
    if (text && String(text).trim()) segs.push({ id, text: String(text).trim() });
  };
  for (const i of issues) {
    push(`${i.key}.summary`, i.summary);
    push(`${i.key}.description`, i.description);
    push(`${i.key}.acceptanceCriteria`, i.acceptanceCriteria);
    (i.comments || []).forEach((c, n) => push(`${i.key}.comment.${n + 1}`, c.body));
  }
  for (const c of clarifications) push(`CLARIFICATION.${c.id}`, `Question: ${c.question}\nAnswer: ${c.answer}`);
  return segs;
}

export function formatSegments(segs) {
  const text = segs.map((s) => `[SEGMENT ${s.id}]\n${s.text}`).join('\n\n');
  return text.length > MAX_SOURCE_CHARS ? text.slice(0, MAX_SOURCE_CHARS) : text;
}

/** Returns the id of the segment that contains the quote verbatim (normalized), or null. */
export function findQuote(segs, quote, preferredId) {
  const q = normalizeText(String(quote || '').replace(/^\s*(\.\.\.|…)|(\.\.\.|…)\s*$/g, ''));
  if (q.length < 3) return null;
  const pref = segs.find((s) => s.id === preferredId);
  if (pref && normalizeText(pref.text).includes(q)) return pref.id;
  const hit = segs.find((s) => normalizeText(s.text).includes(q));
  return hit ? hit.id : null;
}

export function sourceContains(segs, text) {
  const t = normalizeText(text);
  return t.length > 0 && segs.some((s) => normalizeText(s.text).includes(t));
}
