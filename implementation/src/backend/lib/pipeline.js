import { AppError } from './errors.js';
import { isIssueKey } from './jira.js';
import { buildSegments, formatSegments } from './source.js';
import { fillPrompt, loadPrompt, loadTemplate, loadTemplateText } from './prompts.js';

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

/**
 * Each artifact uses one direct Markdown call and returns a draft for human review.
 */
export async function runPipeline({ artifact, input, scope = 'issue', context = '', llm, jira, productName = 'VWO' }) {
  if (!['plan', 'strategy', 'testcases'].includes(artifact)) throw new AppError(400, 'BAD_REQUEST', 'Unknown artifact.');
  const model = llm.modelName?.() || 'unknown';
  const issues = await loadIssues(input, scope, jira);
  const baseSegments = buildSegments(issues);
  if (!baseSegments.length) throw new AppError(422, 'EMPTY_SOURCE', 'The Jira issue has no summary, description or comments to test against.');
  const baseText = formatSegments(baseSegments);
  const sourceInfo = { keys: issues.map((i) => i.key), titles: issues.map((i) => i.summary), scope, model };

  const template = loadTemplate(artifact);
  const stage = { plan: 'P3', strategy: 'P4', testcases: 'P5' }[artifact];
  const prompt = fillPrompt(loadPrompt(stage), {
    PRODUCT: productName,
    SCOPE: scope === 'epic' ? 'Epic and direct children' : 'Single issue',
    TEMPLATE: loadTemplateText(artifact),
    SOURCE: baseText,
    CONTEXT: context.trim() || 'None.',
  });
  const response = await llm({ stage, prompt, output: 'text' });
  const markdown = String(response || '').trim()
    .replace(/^```(?:markdown|md)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  if (!markdown) throw new AppError(502, 'LLM_EMPTY_TEXT', 'The model returned an empty text response.');
  let warnings = [];
  if (artifact === 'testcases') {
    const headerLine = markdown.split(/\r?\n/).find((line) => /^\s*\|/.test(line) && !/^\s*\|[\s:|-]+\|\s*$/.test(line));
    const actualColumns = headerLine ? headerLine.split('|').slice(1, -1).map((cell) => cell.trim()) : [];
    const expectedColumns = template.columns.map((column) => column.label);
    if (JSON.stringify(actualColumns) !== JSON.stringify(expectedColumns)) {
      warnings = ['Test case table is missing or reorders template columns.'];
    }
  } else {
    const headings = markdown.split(/\r?\n/).filter((line) => line.startsWith('## ')).map((line) => line.trim());
    warnings = template.sections
      .filter((heading) => !headings.includes(`## ${heading}`))
      .map((heading) => `Section missing: ${heading}`);
  }
  return {
    artifact,
    status: 'Draft — pending human review',
    source: sourceInfo,
    requirements: [],
    questions: [],
    result: { markdown },
    markdown,
    directText: true,
    validation: {
      errors: [],
      warnings,
      critic: [],
      duplicatesRemoved: [],
      attempts: [{ attempt: 1, codeErrors: warnings.length, criticHigh: 0 }],
    },
  };
}
