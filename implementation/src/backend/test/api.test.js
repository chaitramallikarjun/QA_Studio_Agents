import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';
import { AppError } from '../lib/errors.js';
import { publicSettings, updateSettings } from '../lib/config.js';

let server;
let base;
const failingJira = { getIssue: async () => { throw new AppError(401, 'JIRA_AUTH', 'Jira rejected the credentials (401).'); } };
const llm = async () => ({});
llm.modelName = () => 'mock';

before(async () => {
  server = createApp({ llm, jira: failingJira }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('settings never expose secrets', async () => {
  const s = await (await fetch(base + '/api/settings')).json();
  assert.ok(!('jiraApiToken' in s) && !('groqApiKey' in s));
  assert.equal(typeof s.jiraApiTokenSet, 'boolean');
});

test('Vercel settings are read-only and direct users to project environment variables', () => {
  process.env.VERCEL = '1';
  try {
    assert.equal(publicSettings().settingsEditable, false);
    assert.throws(
      () => updateSettings({}, { persist: false }),
      (error) => error.status === 503 && /Vercel project settings/.test(error.message),
    );
  } finally {
    delete process.env.VERCEL;
  }
});

test('validation errors return 400 JSON and server keeps running', async () => {
  const r = await post('/api/generate/plan', { input: '' });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error.code, 'BAD_REQUEST');
  assert.equal((await post('/api/generate/plan', { input: 'SCRUM-5', scope: 'all' })).status, 400);
  assert.equal((await fetch(base + '/api/health')).status, 200);
});

test('Jira auth failure surfaces as readable 401', async () => {
  const r = await post('/api/generate/testcases', { input: 'SCRUM-5' });
  assert.equal(r.status, 401);
  assert.match((await r.json()).error.message, /credentials/);
});

test('csv and xlsx exports', async () => {
  const testCases = [{ id: 'SC-001', reqIds: ['REQ-001'], title: 'x', tags: [] }];
  const csv = await post('/api/export/testcases', { format: 'csv', testCases, meta: { source: 'SCRUM-5' } });
  assert.equal(csv.status, 200);
  assert.match(await csv.text(), /Scenario#/);
  const xlsx = await post('/api/export/testcases', { format: 'xlsx', testCases, meta: { source: 'SCRUM-5' } });
  assert.equal(xlsx.status, 200);
  const buf = Buffer.from(await xlsx.arrayBuffer());
  assert.equal(buf.subarray(0, 2).toString(), 'PK');
  assert.equal((await post('/api/export/testcases', { format: 'pdf', testCases })).status, 400);
});
