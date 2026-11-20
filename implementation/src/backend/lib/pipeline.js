import crypto from 'node:crypto';
import { AppError } from './errors.js';
import { isIssueKey } from './jira.js';
import { buildSegments, findQuote, formatSegments } from './source.js';
import { fillPrompt, loadPrompt, loadTemplate } from './prompts.js';
import { dedupeTestCases, validateDocument, validateTestCases } from './validators.js';
import { renderDocument } from './render.js';

export const MAX_REPAIRS = 2;
const CATEGORIES = new Set(['functional', 'validation', 'security', 'performance', 'accessibility', 'usability', 'integration', 'data', 'other']);
const cache = new Map();
const hash = (...parts) => crypto.createHash('sha256').update(parts.join('\u0000')).digest('hex');
const pad = (n) => String(n).padStart(3, '0');

async function cached(key, fn) {
  if (cache.has(key)) return cache.get(key);
  const value = await fn();
  cache.set(key, value);
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  return value;
}

export function clearCache() {
  cache.clear();
}

async function loadIssues(input, scope, jira) {
  const trimmed = input.trim();
  if (!isIssueKey(trimmed)) {
    return [{ key: 'PROMPT', summary: '', description: trimmed, acceptanceCriteria: '', comments: [], type: 'Prompt' }];
  }
  const key = trimmed.toUpperCase();
  const root = await jira.getIssue(key);
  if (scope !== 'epic') return [root];
  const children = await jira.getChildren(key);
  return [root, ...children];
}

function sanitizeRequirements(raw, segments) {
  const out = [];
  const rejected = [];
  const seen = new Set();
  for (const r of raw?.requirements || []) {
    const seg = findQuote(segments, r.quote, r.segment);
    if (!seg) {
      rejected.push({ statement: r.statement, reason: 'Quote not found verbatim in source — discarded.' });
      continue;
    }
    const sig = String(r.quote).trim().toLowerCase();
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push({
      id: `REQ-${pad(out.length + 1)}`,
      statement: String(r.statement || '').trim(),
      quote: String(r.quote).trim(),
      segment: seg,
      category: CATEGORIES.has(r.category) ? r.category : 'other',
      testable: r.testable !== false,
      negativeApplicable: Boolean(r.negativeApplicable),
    });
  }
  return { requirements: out, rejected };
}

function reqsForPrompt(reqs) {
  return JSON.stringify(reqs.map(({ id, statement, quote, category, testable, negativeApplicable }) => ({ id, statement, quote, category, testable, negativeApplicable })), null, 1);
}

function resolveQuestions(questions, answers) {
  const byId = new Map((answers || []).map((a) => [a.id, a]));
  return questions.map((q) => {
    const a = byId.get(q.id);
    const answer = typeof a?.answer === 'string' ? a.answer.trim() : '';
    const acceptGap = Boolean(a?.acceptGap) && !answer;
    return { ...q, answer, acceptGap, resolved: Boolean(answer) || acceptGap };
  });
}

function gapsForPrompt(questions) {
  const open = questions.filter((q) => !q.answer);
  if (!open.length) return 'None.';
  return open.map((q) => `${q.id} [${q.acceptGap ? 'accepted gap' : 'open'}] ${q.area}: ${q.question}`).join('\n');
}

function normalizeTestCases(raw, requirements, template) {
  const order = new Map(requirements.map((r, i) => [r.id, i]));
  const typeOrder = new Map(template.types.map((t, i) => [t, i]));
  const list = (raw?.testCases || []).map((t) => ({
    reqIds: Array.isArray(t.reqIds) ? t.reqIds.map(String) : [],
    module: String(t.module || ''),
    functionality: String(t.functionality || ''),
    title: String(t.title || ''),
    type: String(t.type || ''),
    technique: String(t.technique || ''),
    preconditions: String(t.preconditions || ''),
    steps: String(t.steps || ''),
    testData: String(t.testData || ''),
    expectedResult: String(t.expectedResult || ''),
    priority: String(t.priority || ''),
    tags: Array.isArray(t.tags) ? t.tags.map(String) : [],
    sourceQuote: String(t.sourceQuote || ''),
    confidence: String(t.confidence || 'Medium'),
    status: 'Not Run',
  }));
  const rank = (t) => Math.min(...t.reqIds.map((r) => order.get(r) ?? 9999), 9999);
  list.sort((a, b) => rank(a) - rank(b) || (typeOrder.get(a.type) ?? 99) - (typeOrder.get(b.type) ?? 99));
  const { kept, removed } = dedupeTestCases(list);
  kept.forEach((t, i) => (t.id = `SC-${pad(i + 1)}`));
  return { testCases: kept, duplicatesRemoved: removed };
}

function normalizeDocument(raw) {
  return {
    title: String(raw?.title || ''),
    sections: (raw?.sections || []).map((s) => ({
      heading: String(s.heading || '').trim(),
      items: (s.items || []).map((i) => ({ text: String(i.text || ''), basis: String(i.basis || ''), reqIds: Array.isArray(i.reqIds) ? i.reqIds.map(String) : [] })),
    })),
  };
}

/**
 * S1 fetch → S2 requirements → S3 gaps → S5 generate → S6 critic → S7 validators (repair loop) → render.
 */
export async function runPipeline({ artifact, input, scope = 'issue', context = '', answers = [], llm, jira, productName = 'VWO' }) {
  if (!['plan', 'strategy', 'testcases'].includes(artifact)) throw new AppError(400, 'BAD_REQUEST', 'Unknown artifact.');
  const model = llm.modelName?.() || 'unknown';
  const issues = await loadIssues(input, scope, jira);
  const baseSegments = buildSegments(issues);
  if (!baseSegments.length) throw new AppError(422, 'EMPTY_SOURCE', 'The Jira issue has no summary, description or comments to test against.');
  const baseText = formatSegments(baseSegments);

  // Base requirements and questions are cached so question ids stay stable across regenerations.
  const base = await cached(hash('P1', model, baseText), async () =>
    sanitizeRequirements(await llm({ stage: 'P1', prompt: fillPrompt(loadPrompt('P1'), { PRODUCT: productName, SOURCE: baseText }) }), baseSegments),
  );
  const rawQuestions = await cached(hash('P2', model, baseText), async () => {
    const out = await llm({ stage: 'P2', prompt: fillPrompt(loadPrompt('P2'), { PRODUCT: productName, SOURCE: baseText, REQUIREMENTS: reqsForPrompt(base.requirements) }) });
    return (out?.questions || []).map((q, i) => ({
      id: `Q-${pad(i + 1)}`,
      area: String(q.area || ''),
      finding: ['ambiguous', 'missing', 'conflict'].includes(q.finding) ? q.finding : 'ambiguous',
      question: String(q.question || ''),
      reqRefs: Array.isArray(q.reqRefs) ? q.reqRefs.map(String) : [],
      impact: String(q.impact || ''),
    }));
  });
  const questions = resolveQuestions(rawQuestions, answers);

  // Answered questions become quotable source segments and re-enter requirement extraction.
  const answered = questions.filter((q) => q.answer);
  let segments = baseSegments;
  let reqResult = base;
  if (answered.length) {
    segments = buildSegments(issues, answered);
    const fullText = formatSegments(segments);
    reqResult = await cached(hash('P1', model, fullText), async () =>
      sanitizeRequirements(await llm({ stage: 'P1', prompt: fillPrompt(loadPrompt('P1'), { PRODUCT: productName, SOURCE: fullText }) }), segments),
    );
  }
  const { requirements, rejected } = reqResult;
  if (!requirements.length) throw new AppError(422, 'NO_REQUIREMENTS', 'No verifiable requirements could be extracted from the source. Add detail to the Jira issue.');
  const reqIds = new Set(requirements.map((r) => r.id));

  const template = loadTemplate(artifact);
  const genPromptId = { plan: 'P3', strategy: 'P4', testcases: 'P5' }[artifact];
  const vars = {
    PRODUCT: productName,
    REQUIREMENTS: reqsForPrompt(requirements),
    GAPS: gapsForPrompt(questions),
    CONTEXT: context.trim() || 'None.',
    TEMPLATE: (template.sections || []).join('\n'),
    TYPES: (template.types || []).join(', '),
  };

  let best = null;
  let feedback = 'None.';
  const attempts = [];
  for (let attempt = 0; attempt <= MAX_REPAIRS; attempt++) {
    const raw = await llm({ stage: genPromptId, prompt: fillPrompt(loadPrompt(genPromptId), { ...vars, FEEDBACK: feedback }) });
    let result;
    let check;
    let duplicatesRemoved = [];
    if (artifact === 'testcases') {
      const n = normalizeTestCases(raw, requirements, template);
      result = { testCases: n.testCases };
      duplicatesRemoved = n.duplicatesRemoved;
      check = validateTestCases(n.testCases, requirements, segments, template);
    } else {
      result = normalizeDocument(raw);
      check = validateDocument(result, template, reqIds);
    }
    const review = await llm({
      stage: 'P6',
      prompt: fillPrompt(loadPrompt('P6'), {
        ARTIFACT: { plan: 'test plan', strategy: 'test strategy', testcases: 'test case suite' }[artifact],
        REQUIREMENTS: vars.REQUIREMENTS,
        GAPS: vars.GAPS,
        FINDINGS: JSON.stringify(check.errors),
        ARTIFACT_JSON: JSON.stringify(result),
      }),
    });
    const critic = (review?.issues || []).map((i) => ({
      severity: ['high', 'medium', 'low'].includes(i.severity) ? i.severity : 'medium',
      location: String(i.location || ''),
      problem: String(i.problem || ''),
      fix: String(i.fix || ''),
    }));
    const blocking = check.errors.length + critic.filter((c) => c.severity === 'high').length;
    attempts.push({ attempt: attempt + 1, codeErrors: check.errors.length, criticHigh: critic.filter((c) => c.severity === 'high').length });
    if (!best || blocking < best.blocking) best = { result, check, critic, blocking, duplicatesRemoved };
    if (blocking === 0) break;
    feedback = [...check.errors.map((e) => `[automated] ${e.location}: ${e.problem}`), ...critic.filter((c) => c.severity !== 'low').map((c) => `[review] ${c.location}: ${c.problem} Fix: ${c.fix}`)].join('\n');
  }

  const unresolved = questions.filter((q) => !q.resolved).length;
  const status = unresolved > 0 ? 'Draft — pending clarification' : best.blocking > 0 ? 'Draft — validation issues' : 'Final — pending QA sign-off';
  const sourceInfo = { keys: issues.map((i) => i.key), titles: issues.map((i) => i.summary), scope, model, rejectedRequirements: rejected };
  const markdown = artifact === 'testcases' ? null : renderDocument({ doc: best.result, status, sourceInfo, questions, requirements });

  return {
    artifact,
    status,
    source: sourceInfo,
    requirements,
    questions,
    result: best.result,
    markdown,
    validation: {
      errors: best.check.errors,
      warnings: best.check.warnings,
      critic: best.critic,
      duplicatesRemoved: best.duplicatesRemoved,
      attempts,
    },
  };
}
