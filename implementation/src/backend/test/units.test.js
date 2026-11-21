import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTemplate } from '../lib/prompts.js';
import { adfToText, isIssueKey } from '../lib/jira.js';
import { buildSegments, findQuote } from '../lib/source.js';
import { dedupeTestCases, validateDocument, validateTestCases } from '../lib/validators.js';
import { toCsv } from '../lib/exporter.js';
import { createGroqClient, parseJsonObject } from '../lib/llm.js';

test('markdown templates parse into sections and columns', () => {
  const plan = loadTemplate('plan');
  assert.equal(plan.sections.length, 14);
  assert.equal(plan.sections[0], '1. Objective');
  assert.equal(loadTemplate('strategy').sections.length, 15);
  const tc = loadTemplate('testcases');
  assert.equal(tc.columns[0].label, 'Scenario#');
  assert.equal(tc.columns.length, 9);
  assert.deepEqual(tc.types, ['Positive', 'Negative', 'Boundary', 'Edge']);
  assert.deepEqual(tc.negativeTypes, ['Negative', 'Boundary']);
  assert.ok(tc.techniques.includes('Boundary Value Analysis'));
});

test('Jira 404 caused by bad credentials is reported as auth error', async () => {
  const { createJiraClient } = await import('../lib/jira.js');
  const cfg = () => ({ JIRA_BASE_URL: 'https://x.atlassian.net', JIRA_EMAIL: 'a@b.c', JIRA_API_TOKEN: 't' });
  const badAuth = createJiraClient(cfg, async (url) => ({ status: url.includes('/myself') ? 401 : 404, ok: false }));
  await assert.rejects(badAuth.getIssue('KAN-4'), (e) => e.code === 'JIRA_AUTH');
  const goodAuth = createJiraClient(cfg, async (url) => (url.includes('/myself') ? { status: 200, ok: true, json: async () => ({}) } : { status: 404, ok: false }));
  await assert.rejects(goodAuth.getIssue('KAN-4'), (e) => e.code === 'JIRA_NOT_FOUND');
});

test('issue key detection and ADF conversion', () => {
  assert.ok(isIssueKey('scrum-5'));
  assert.ok(!isIssueKey('test the login page'));
  const adf = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }, { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Item' }] }] }] }] };
  assert.match(adfToText(adf), /Hello\n- Item/);
});

test('quote verification is verbatim (whitespace/quote-style tolerant)', () => {
  const segs = buildSegments([{ key: 'S-1', summary: 'Login', description: 'Users must  log in with “email” and password.', comments: [] }]);
  assert.equal(findQuote(segs, 'users must log in with "email" and password'), 'S-1.description');
  assert.equal(findQuote(segs, 'Users must log in with SSO'), null);
});

test('document validator enforces template order and traceability', () => {
  const tpl = { sections: ['A', 'B'] };
  const doc = { sections: [{ heading: 'B', items: [{ text: 'x', basis: 'Documented', reqIds: [] }] }, { heading: 'A', items: [{ text: 'y', basis: 'Proposed', reqIds: ['REQ-999'] }] }] };
  const { errors } = validateDocument(doc, tpl, new Set(['REQ-001']));
  const problems = errors.map((e) => e.problem);
  assert.ok(problems.includes('Section out of template order.'));
  assert.ok(problems.includes('Documented item cites no requirement.'));
  assert.ok(problems.some((p) => p.includes('REQ-999')));
});

test('test case validator catches invented messages, missing negatives and bad quotes', () => {
  const tpl = loadTemplate('testcases');
  const segs = buildSegments([{ key: 'S-1', description: 'Users must log in with email and password.', comments: [] }]);
  const reqs = [{ id: 'REQ-001', testable: true, negativeApplicable: true }];
  const tc = { id: 'SC-001', reqIds: ['REQ-001'], type: 'Positive', technique: 'Use Case', priority: 'High', steps: 'Given a\nWhen b\nThen c', expectedResult: 'Shows "Welcome back"', sourceQuote: 'log in with email and password', confidence: 'High' };
  const { errors } = validateTestCases([tc], reqs, segs, tpl);
  const p = errors.map((e) => e.problem).join(' | ');
  assert.match(p, /Welcome back/);
  assert.match(p, /negative\/boundary/);
  assert.doesNotMatch(p, /Source quote/);
});

test('dedupe removes near-identical cases of same type', () => {
  const a = { type: 'Negative', title: 'Login fails with wrong password', steps: 'Given user When wrong password Then error', expectedResult: 'error' };
  const b = { ...a, title: 'Login fails with wrong password.' };
  const c = { ...a, type: 'Boundary' };
  const { kept, removed } = dedupeTestCases([a, b, c]);
  assert.equal(kept.length, 2);
  assert.equal(removed.length, 1);
});

test('csv export escapes quotes and neutralises formulas', () => {
  const csv = toCsv([{
    id: 'SC-001',
    module: 'Auth',
    functionality: 'Login',
    title: '=HYPERLINK("x")',
    preconditions: 'User exists',
    steps: 'Submit credentials',
    testData: 'a, b',
    expectedResult: 'Insufficient information to determine.',
    priority: 'Medium',
  }]);
  assert.match(csv, /Scenario#/);
  assert.match(csv, /"'=HYPERLINK\(""x""\)"/);
  assert.match(csv, /"a, b"/);
});

test('Groq request matches the working 5X payload and parses JSON', async () => {
  let requestBody;
  const llm = createGroqClient(
    () => ({ GROQ_API_KEY: 'test-key', GROQ_MODEL: 'test-model' }),
    async (_url, init) => {
      requestBody = JSON.parse(init.body);
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }),
      };
    },
  );

  assert.deepEqual(await llm({ prompt: 'Return JSON.' }), { ok: true });
  assert.equal(requestBody.temperature, 0);
  assert.equal(requestBody.seed, 42);
  assert.equal('top_p' in requestBody, false);
  assert.equal('response_format' in requestBody, false);
});

test('Groq text mode returns Markdown without attempting JSON parsing', async () => {
  let requestBody;
  const llm = createGroqClient(
    () => ({ GROQ_API_KEY: 'test-key', GROQ_MODEL: 'test-model' }),
    async (_url, init) => {
      requestBody = JSON.parse(init.body);
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: '# Test Plan\n\n## 1. Objective\nVerify the feature.' } }] }),
      };
    },
  );

  assert.equal(await llm({ prompt: 'Write Markdown.', output: 'text' }), '# Test Plan\n\n## 1. Objective\nVerify the feature.');
  assert.match(requestBody.messages[0].content, /Markdown text only/);
});

test('Groq HTTP 400 returns a safe provider diagnostic', async () => {
  const llm = createGroqClient(
    () => ({ GROQ_API_KEY: 'test-key', GROQ_MODEL: 'test-model' }),
    async () => ({
      ok: false,
      status: 400,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        error: {
          code: 'unsupported_parameter',
          param: 'response_format',
          message: 'The request included gsk_sensitive-value.',
        },
      }),
    }),
  );

  await assert.rejects(llm({ prompt: 'Return JSON.' }), (error) => {
    assert.equal(error.code, 'LLM_BAD_REQUEST');
    assert.match(error.message, /unsupported_parameter/);
    assert.match(error.message, /response_format/);
    assert.doesNotMatch(error.message, /gsk_sensitive-value/);
    assert.match(error.message, /\[REDACTED\]/);
    return true;
  });
});

test('model JSON parser accepts fenced and prose-wrapped objects', () => {
  const wrapped = 'Result:\n```json\n{"ok":true,"note":"brace } inside text"}\n```';
  assert.deepEqual(parseJsonObject(wrapped), { ok: true, note: 'brace } inside text' });
  assert.throws(() => parseJsonObject('Here is the result: {not valid json}'), /No valid JSON object/);
});

test('invalid model JSON gets a bounded schema-preserving repair attempt', async () => {
  const outputs = ['not JSON', '```json\n{"ok":true}\n```'];
  const requests = [];
  const llm = createGroqClient(
    () => ({ GROQ_API_KEY: 'test-key', GROQ_MODEL: 'test-model' }),
    async (_url, init) => {
      requests.push(JSON.parse(init.body));
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: outputs.shift() } }] }),
      };
    },
  );

  assert.deepEqual(await llm({ prompt: 'Return {"ok": boolean}.' }), { ok: true });
  assert.equal(requests.length, 2);
  assert.match(requests[1].messages.at(-1).content, /Regenerate the answer.*valid JSON object/);
  assert.match(requests[1].messages.at(-1).content, /<previous_response>[\s\S]*not JSON[\s\S]*<\/previous_response>/);
});
