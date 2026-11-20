import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { runPipeline, clearCache } from '../lib/pipeline.js';
import { loadTemplate } from '../lib/prompts.js';

// MOCKED Jira + Groq: verifies orchestration only, not live integration.
const ISSUE = {
  key: 'SCRUM-5',
  summary: 'VWO Login Dashboard',
  description: 'Users must be able to log in using email and password.\nThe account is locked after repeated failed attempts.',
  acceptanceCriteria: '',
  comments: [],
};
const jira = { getIssue: async () => ISSUE, getChildren: async () => [] };

function makeLlm({ badFirst = false } = {}) {
  const calls = [];
  let genCount = 0;
  const llm = async ({ stage, prompt }) => {
    calls.push(stage);
    if (stage === 'P1') {
      const reqs = [
        { statement: 'Login with email/password', quote: 'Users must be able to log in using email and password', segment: 'SCRUM-5.description', category: 'functional', testable: true, negativeApplicable: true },
        { statement: 'Invented SSO', quote: 'Users can log in with SSO', segment: 'SCRUM-5.description', category: 'functional', testable: true, negativeApplicable: false },
      ];
      if (prompt.includes('CLARIFICATION.Q-001')) {
        reqs.push({ statement: 'Lockout after 5 failures', quote: 'Lock after 5 failed attempts', segment: 'CLARIFICATION.Q-001', category: 'security', testable: true, negativeApplicable: true });
      }
      return { requirements: reqs };
    }
    if (stage === 'P2') return { questions: [{ area: 'Lockout', finding: 'missing', question: 'How many failed attempts lock the account?', reqRefs: [], impact: 'boundary' }] };
    if (stage === 'P5') {
      genCount++;
      const pos = { reqIds: ['REQ-001'], module: 'Auth', functionality: 'Login', title: 'Valid login', type: 'Positive', technique: 'Use Case', preconditions: 'User exists', steps: 'Given user\nWhen valid creds\nThen logged in', testData: '', expectedResult: 'Dashboard shown', priority: 'High', tags: ['smoke'], sourceQuote: 'log in using email and password', confidence: 'High' };
      const neg = { ...pos, title: 'Invalid password rejected', type: 'Negative', technique: 'Equivalence Partitioning', steps: 'Given user\nWhen wrong password\nThen rejected', expectedResult: 'Login is rejected (exact message: Needs clarification)' };
      const extra = prompt.includes('REQ-002') ? [{ ...neg, reqIds: ['REQ-002'], title: 'Lockout at limit', type: 'Boundary', technique: 'Boundary Value Analysis', steps: 'Given user\nWhen 5 failed attempts\nThen locked', sourceQuote: 'Lock after 5 failed attempts' }] : [];
      return { testCases: badFirst && genCount === 1 ? [pos, pos] : [neg, pos, { ...pos }, ...extra] };
    }
    if (stage === 'P3') {
      const sections = loadTemplate('plan').sections.map((h) => ({ heading: h, items: [{ text: 'Verify login.', basis: 'Documented', reqIds: ['REQ-001'] }] }));
      return { title: 'Test Plan — SCRUM-5', sections };
    }
    if (stage === 'P6') return { issues: [] };
    throw new Error('unexpected stage ' + stage);
  };
  llm.modelName = () => 'mock-model';
  return { llm, calls };
}

beforeEach(() => clearCache());

test('test cases: unverifiable requirement dropped, duplicates removed, ids sequential', async () => {
  const { llm } = makeLlm();
  const r = await runPipeline({ artifact: 'testcases', input: 'scrum-5', llm, jira });
  assert.equal(r.requirements.length, 1);
  assert.equal(r.source.rejectedRequirements.length, 1);
  assert.deepEqual(r.result.testCases.map((t) => t.id), ['SC-001', 'SC-002']);
  assert.equal(r.result.testCases[0].type, 'Positive');
  assert.equal(r.validation.duplicatesRemoved.length, 1);
  assert.equal(r.validation.errors.length, 0);
  assert.equal(r.status, 'Draft — pending clarification');
});

test('repair loop re-generates when validators fail', async () => {
  const { llm, calls } = makeLlm({ badFirst: true });
  const r = await runPipeline({ artifact: 'testcases', input: 'SCRUM-5', llm, jira });
  assert.equal(calls.filter((c) => c === 'P5').length, 2);
  assert.equal(r.validation.attempts.length, 2);
  assert.equal(r.validation.errors.length, 0);
});

test('answering questions adds clarification requirements and finalises status', async () => {
  const { llm } = makeLlm();
  const r = await runPipeline({ artifact: 'testcases', input: 'SCRUM-5', llm, jira, answers: [{ id: 'Q-001', answer: 'Lock after 5 failed attempts' }] });
  assert.equal(r.requirements.length, 2);
  assert.equal(r.requirements[1].segment, 'CLARIFICATION.Q-001');
  assert.ok(r.result.testCases.some((t) => t.type === 'Boundary'));
  assert.equal(r.status, 'Final — pending QA sign-off');
});

test('accept-as-gap resolves question; plan renders markdown with gaps and traceability', async () => {
  const { llm } = makeLlm();
  const r = await runPipeline({ artifact: 'plan', input: 'SCRUM-5', llm, jira, answers: [{ id: 'Q-001', acceptGap: true }] });
  assert.equal(r.status, 'Final — pending QA sign-off');
  assert.match(r.markdown, /## 14\. Approvals/);
  assert.match(r.markdown, /Accepted as gap/);
  assert.match(r.markdown, /Requirement traceability/);
});

test('free-text prompt input is used as source without Jira', async () => {
  const { llm } = makeLlm();
  const noJira = { getIssue: async () => assert.fail('Jira should not be called') };
  await assert.rejects(runPipeline({ artifact: 'testcases', input: 'Some feature text', llm, jira: noJira }), /No verifiable requirements/);
});
