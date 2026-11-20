import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..');
const PROMPTS_DIR = path.join(ROOT, 'prompts');
const TEMPLATES_DIR = path.join(ROOT, 'templates');

const PROMPT_FILES = {
  P1: 'P1_requirement_extractor.md',
  P2: 'P2_gap_analyst.md',
  P3: 'P3_test_plan_writer.md',
  P4: 'P4_test_strategy_writer.md',
  P5: 'P5_test_case_designer.md',
  P6: 'P6_reviewer.md',
};

export function loadPrompt(id) {
  return fs.readFileSync(path.join(PROMPTS_DIR, PROMPT_FILES[id]), 'utf8');
}

export function fillPrompt(template, vars) {
  // Single pass so values containing "{{X}}" (e.g. Jira text) are never re-expanded.
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => (k in vars ? String(vars[k] ?? '') : m));
}

const TEMPLATE_FILES = { plan: 'test_plan.template.md', strategy: 'test_strategy.template.md', testcases: 'test_cases.template.md' };
const LIST_KEYS = { Types: 'types', 'Negative Types': 'negativeTypes', Techniques: 'techniques', Priorities: 'priorities', Confidence: 'confidence' };

/** Parses a Markdown template. Plan/strategy: "## " headings = sections. Test cases: Columns table + value lists. */
export function parseTemplate(artifact, md) {
  const text = md.replace(/<!--[\s\S]*?-->/g, '').replace(/\r/g, '');
  const title = (text.match(/^# (.+)$/m) || [])[1]?.trim() || '';
  if (artifact !== 'testcases') {
    const sections = [...text.matchAll(/^## (.+)$/gm)].map((m) => m[1].trim());
    return { artifact, title, sections };
  }
  const tpl = { artifact, title, columns: [], types: [], negativeTypes: [], techniques: [], priorities: [], confidence: [] };
  for (const block of text.split(/^## /m).slice(1)) {
    const [head, ...rest] = block.split('\n');
    const name = head.trim();
    if (name === 'Columns') {
      for (const line of rest) {
        const cells = line.split('|').map((c) => c.trim()).filter(Boolean);
        if (cells.length === 2 && cells[0] !== 'Key' && !/^-+$/.test(cells[0])) tpl.columns.push({ key: cells[0], label: cells[1] });
      }
    } else if (LIST_KEYS[name]) {
      tpl[LIST_KEYS[name]] = rest.filter((l) => /^\s*-\s+/.test(l)).map((l) => l.replace(/^\s*-\s+/, '').trim());
    }
  }
  return tpl;
}

export function loadTemplate(artifact) {
  return parseTemplate(artifact, fs.readFileSync(path.join(TEMPLATES_DIR, TEMPLATE_FILES[artifact]), 'utf8'));
}
