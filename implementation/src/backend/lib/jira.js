import { AppError } from './errors.js';
import { getConfig } from './config.js';

const KEY_RE = /^[A-Z][A-Z0-9_]+-\d+$/;
const BLOCK_TYPES = new Set(['paragraph', 'heading', 'listItem', 'codeBlock', 'blockquote', 'tableRow', 'panel']);

export function isIssueKey(value) {
  return KEY_RE.test(String(value || '').trim().toUpperCase());
}

/** Converts Atlassian Document Format (or plain string) to readable text. */
export function adfToText(node) {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(adfToText).join('');
  if (node.type === 'text') return node.text || '';
  if (node.type === 'hardBreak') return '\n';
  if (node.type === 'mention') return node.attrs?.text || '';
  if (node.type === 'inlineCard') return node.attrs?.url || '';
  const sep = node.type === 'tableRow' ? ' | ' : '';
  let text = (node.content || []).map(adfToText).join(sep);
  if (node.type === 'listItem') text = '- ' + text.trim();
  return BLOCK_TYPES.has(node.type) ? text.trimEnd() + '\n' : text;
}

function normalizeIssue(raw, acField) {
  const f = raw.fields || {};
  return {
    key: raw.key,
    summary: f.summary || '',
    type: f.issuetype?.name || '',
    status: f.status?.name || '',
    priority: f.priority?.name || '',
    labels: f.labels || [],
    components: (f.components || []).map((c) => c.name),
    description: adfToText(f.description).trim(),
    acceptanceCriteria: acField ? adfToText(f[acField]).trim() : '',
    comments: (f.comment?.comments || []).map((c) => ({ author: c.author?.displayName || '', body: adfToText(c.body).trim() })),
  };
}

export function createJiraClient(cfgFn = getConfig, fetchImpl = globalThis.fetch) {
  async function request(pathAndQuery) {
    const cfg = cfgFn();
    if (!cfg.JIRA_BASE_URL || !cfg.JIRA_EMAIL || !cfg.JIRA_API_TOKEN) {
      throw new AppError(500, 'CONFIG_MISSING', 'Jira base URL, email and API token must be configured in Settings.');
    }
    const auth = Buffer.from(`${cfg.JIRA_EMAIL}:${cfg.JIRA_API_TOKEN}`).toString('base64');
    let res;
    try {
      res = await fetchImpl(`${cfg.JIRA_BASE_URL}${pathAndQuery}`, {
        headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      throw new AppError(502, 'JIRA_NETWORK', 'Could not reach Jira. Check the base URL and your network.');
    }
    if (res.status === 401) throw new AppError(401, 'JIRA_AUTH', 'Jira rejected the credentials (401). Check email and API token.');
    if (res.status === 403) throw new AppError(403, 'JIRA_FORBIDDEN', 'No permission to read this Jira issue (403).');
    if (res.status === 404) {
      // Jira Cloud answers 404 (not 401) when credentials are invalid, so confirm auth before blaming the issue key.
      if (!pathAndQuery.startsWith('/rest/api/3/myself')) {
        try {
          await request('/rest/api/3/myself');
        } catch (e) {
          if (e.code === 'JIRA_AUTH') throw new AppError(401, 'JIRA_AUTH', 'Jira rejected the credentials, so the issue could not be read. Check the Jira email and API token in Settings (use an Atlassian API token starting with "ATATT", not the Groq key).');
          throw e;
        }
      }
      throw new AppError(404, 'JIRA_NOT_FOUND', 'Jira issue not found, or this account has no permission to view it.');
    }
    if (!res.ok) throw new AppError(502, 'JIRA_ERROR', `Jira returned HTTP ${res.status}.`);
    return res.json();
  }

  function fieldList() {
    const acField = cfgFn().JIRA_AC_FIELD;
    const fields = ['summary', 'description', 'issuetype', 'status', 'priority', 'labels', 'components', 'comment', 'parent'];
    if (acField) fields.push(acField);
    return { fields, acField };
  }

  return {
    async getIssue(key) {
      const { fields, acField } = fieldList();
      const raw = await request(`/rest/api/3/issue/${encodeURIComponent(key)}?fields=${fields.join(',')}`);
      return normalizeIssue(raw, acField);
    },
    async getChildren(key) {
      const { fields, acField } = fieldList();
      const jql = encodeURIComponent(`parent = ${key} ORDER BY key ASC`);
      const data = await request(`/rest/api/3/search/jql?jql=${jql}&maxResults=50&fields=${fields.join(',')}`);
      return (data.issues || []).map((i) => normalizeIssue(i, acField));
    },
  };
}
