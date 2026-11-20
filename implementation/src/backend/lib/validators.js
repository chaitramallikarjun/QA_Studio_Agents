import { findQuote, normalizeText, sourceContains } from './source.js';

export const INSUFFICIENT = 'Insufficient information to determine.';
const BASIS = new Set(['Documented', 'Proposed', 'Insufficient']);

const tokens = (s) => new Set(normalizeText(s).split(/[^a-z0-9]+/).filter((t) => t.length > 2));
export function jaccard(a, b) {
  if (!a.size && !b.size) return 1;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Plan / strategy: exact section headings and order, valid basis and REQ references. */
export function validateDocument(doc, template, reqIds) {
  const errors = [];
  const warnings = [];
  const headings = (doc.sections || []).map((s) => String(s.heading || '').trim());
  const expected = template.sections;
  expected.forEach((h, i) => {
    if (!headings.includes(h)) errors.push({ location: h, problem: 'Template section missing.' });
    else if (headings[i] !== h) errors.push({ location: h, problem: 'Section out of template order.' });
  });
  headings.filter((h) => !expected.includes(h)).forEach((h) => errors.push({ location: h, problem: 'Section not in template.' }));

  for (const s of doc.sections || []) {
    if (!s.items?.length) errors.push({ location: s.heading, problem: 'Section is empty.' });
    (s.items || []).forEach((it, n) => {
      const loc = `${s.heading} #${n + 1}`;
      if (!BASIS.has(it.basis)) errors.push({ location: loc, problem: `Invalid basis "${it.basis}".` });
      const bad = (it.reqIds || []).filter((r) => !reqIds.has(r));
      if (bad.length) errors.push({ location: loc, problem: `Unknown requirement ids: ${bad.join(', ')}.` });
      if (it.basis === 'Documented' && !(it.reqIds || []).length) errors.push({ location: loc, problem: 'Documented item cites no requirement.' });
      if (it.basis === 'Insufficient' && String(it.text).trim() !== INSUFFICIENT) {
        warnings.push({ location: loc, problem: `Insufficient item should read exactly "${INSUFFICIENT}"` });
      }
    });
  }
  const citedReqs = new Set((doc.sections || []).flatMap((s) => (s.items || []).flatMap((i) => i.reqIds || [])));
  const uncited = [...reqIds].filter((r) => !citedReqs.has(r));
  if (uncited.length) warnings.push({ location: 'Traceability', problem: `Requirements not referenced: ${uncited.join(', ')}.` });
  return { errors, warnings };
}

/** Removes near-duplicate test cases (same type, ≥0.85 token overlap). */
export function dedupeTestCases(tcs) {
  const kept = [];
  const removed = [];
  for (const tc of tcs) {
    const sig = tokens(`${tc.title} ${tc.steps} ${tc.expectedResult}`);
    const dup = kept.find((k) => k.type === tc.type && jaccard(k._sig, sig) >= 0.85);
    if (dup) removed.push({ title: tc.title, duplicateOf: dup.title });
    else kept.push({ ...tc, _sig: sig });
  }
  return { kept: kept.map(({ _sig, ...rest }) => rest), removed };
}

export function validateTestCases(tcs, requirements, segments, template) {
  const errors = [];
  const warnings = [];
  const reqIds = new Set(requirements.map((r) => r.id));
  const types = new Set(template.types);
  const negTypes = new Set(template.negativeTypes);

  for (const tc of tcs) {
    const loc = tc.id || tc.title;
    if (!types.has(tc.type)) errors.push({ location: loc, problem: `Invalid type "${tc.type}".` });
    if (!template.techniques.includes(tc.technique)) warnings.push({ location: loc, problem: `Unrecognized technique "${tc.technique}".` });
    if (!template.priorities.includes(tc.priority)) errors.push({ location: loc, problem: `Invalid priority "${tc.priority}".` });
    if (!(tc.reqIds || []).length) errors.push({ location: loc, problem: 'No requirement id.' });
    const bad = (tc.reqIds || []).filter((r) => !reqIds.has(r));
    if (bad.length) errors.push({ location: loc, problem: `Unknown requirement ids: ${bad.join(', ')}.` });
    if (!/\bGiven\b/.test(tc.steps) || !/\bWhen\b/.test(tc.steps) || !/\bThen\b/.test(tc.steps)) {
      errors.push({ location: loc, problem: 'Steps are not valid Gherkin (Given/When/Then).' });
    }
    if (!findQuote(segments, tc.sourceQuote)) errors.push({ location: loc, problem: 'Source quote not found verbatim in Jira source.' });
    for (const m of String(tc.expectedResult || '').matchAll(/"([^"]{3,})"/g)) {
      if (!sourceContains(segments, m[1])) errors.push({ location: loc, problem: `Quoted text "${m[1]}" is not in the source (possible invented message).` });
    }
    if (tc.confidence === 'Low') warnings.push({ location: loc, problem: 'Low confidence — depends on an open question.' });
  }

  for (const r of requirements.filter((x) => x.testable)) {
    const covering = tcs.filter((t) => (t.reqIds || []).includes(r.id));
    if (!covering.length) errors.push({ location: r.id, problem: 'Testable requirement has no test case.' });
    else {
      if (!covering.some((t) => t.type === 'Positive')) warnings.push({ location: r.id, problem: 'No positive test case.' });
      if (r.negativeApplicable && !covering.some((t) => negTypes.has(t.type))) {
        errors.push({ location: r.id, problem: 'Requirement needs a negative/boundary test but has none.' });
      }
    }
  }
  return { errors, warnings };
}
