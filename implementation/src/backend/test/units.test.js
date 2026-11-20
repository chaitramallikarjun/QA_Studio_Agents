import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTemplate } from '../lib/prompts.js';
import { adfToText, isIssueKey } from '../lib/jira.js';
import { buildSegments, findQuote } from '../lib/source.js';
import { dedupeTestCases, validateDocument, validateTestCases } from '../lib/validators.js';
import { toCsv } from '../lib/exporter.js';

test('markdown templates parse into sections and columns', () => {
  const plan = loadTemplate('plan');
  assert.equal(plan.sections.length, 14);
  assert.equal(plan.sections[0], '1. Objective');
  assert.equal(loadTemplate('strategy').sections.length, 15);
  const tc = loadTemplate('testcases');
  assert.equal(tc.columns[0].label, 'Scenario#');
  assert.equal(tc.columns.length, 16);
  assert.deepEqual(tc.negativeTypes, ['Negative', 'Boundary', 'Security']);
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
  const csv = toCsv([{ id: 'SC-001', title: '=HYPERLINK("x")', reqIds: ['REQ-001'], tags: ['a', 'b'] }]);
  assert.match(csv, /Scenario#/);
  assert.match(csv, /"'=HYPERLINK\(""x""\)"/);
  assert.match(csv, /"a, b"/);
});
