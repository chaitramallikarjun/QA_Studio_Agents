import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPipeline } from '../lib/pipeline.js';
import { loadTemplate } from '../lib/prompts.js';

const ISSUE = {
  key: 'SCRUM-5',
  summary: 'VWO Login Dashboard',
  description: 'Users must be able to log in using email and password.',
  acceptanceCriteria: '',
  comments: [],
};
const jira = { getIssue: async () => ISSUE, getChildren: async () => [] };

function mockLlm(markdown) {
  const calls = [];
  const llm = async (request) => {
    calls.push(request);
    return markdown;
  };
  llm.modelName = () => 'mock-model';
  return { llm, calls };
}

for (const [artifact, stage] of [['plan', 'P3'], ['strategy', 'P4']]) {
  test(`${artifact} is generated as direct Markdown in one call`, async () => {
    const template = loadTemplate(artifact);
    const markdown = `# ${template.title}\n\n${template.sections.map((heading) => `## ${heading}`).join('\n\n')}`;
    const { llm, calls } = mockLlm(markdown);

    const result = await runPipeline({ artifact, input: 'SCRUM-5', llm, jira, context: 'Focus on documented authentication.' });
    assert.equal(result.directText, true);
    assert.equal(result.status, 'Draft — pending human review');
    assert.equal(result.markdown, markdown);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].stage, stage);
    assert.equal(calls[0].output, 'text');
    assert.match(calls[0].prompt, /Users must be able to log in using email and password/);
    assert.match(calls[0].prompt, /Focus on documented authentication/);
    assert.deepEqual(result.validation.warnings, []);
  });
}

test('test cases are returned as Markdown with template columns', async () => {
  const columns = loadTemplate('testcases').columns.map((column) => column.label);
  const markdown = `# Test Cases\n\n| ${columns.join(' | ')} |\n| ${columns.map(() => '---').join(' | ')} |\n| SC-001 | REQ-001 | Auth | Login | Documented login | Positive | Requirement-based | N/A | Submit credentials | Insufficient information to determine. | Insufficient information to determine. | Medium | proposed | Users must be able to log in using email and password. | Medium | Not Run |`;
  const { llm, calls } = mockLlm(markdown);

  const result = await runPipeline({ artifact: 'testcases', input: 'SCRUM-5', llm, jira });
  assert.equal(result.directText, true);
  assert.equal(result.markdown, markdown);
  assert.equal(result.status, 'Draft — pending human review');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].stage, 'P5');
  assert.equal(calls[0].output, 'text');
  assert.deepEqual(result.validation.warnings, []);
});

test('test cases warn if the Markdown table columns do not match the template', async () => {
  const { llm } = mockLlm('# Test Cases\n\n| ID | Scenario |\n|---|---|');
  const result = await runPipeline({ artifact: 'testcases', input: 'SCRUM-5', llm, jira });
  assert.deepEqual(result.validation.warnings, ['Test case table is missing or reorders template columns.']);
});

test('free-text source is sent to the model without calling Jira', async () => {
  const source = 'Users can sign in with their corporate account.';
  const { llm, calls } = mockLlm('# Test Plan\n\n## 1. Objective');
  const noJira = { getIssue: async () => assert.fail('Jira should not be called') };
  const result = await runPipeline({ artifact: 'plan', input: source, llm, jira: noJira });
  assert.equal(result.markdown, '# Test Plan\n\n## 1. Objective');
  assert.match(calls[0].prompt, /Users can sign in with their corporate account/);
});
