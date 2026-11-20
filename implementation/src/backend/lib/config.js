import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { AppError } from './errors.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ENV_PATH = path.resolve(__dirname, '..', '.env');
dotenv.config({ path: ENV_PATH });

const KEYS = ['JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN', 'JIRA_AC_FIELD', 'GROQ_API_KEY', 'GROQ_MODEL', 'PRODUCT_NAME'];
const SECRETS = new Set(['JIRA_API_TOKEN', 'GROQ_API_KEY']);
const DEFAULTS = { GROQ_MODEL: 'openai/gpt-oss-120b', PRODUCT_NAME: 'VWO' };

export function getConfig() {
  const cfg = {};
  for (const k of KEYS) cfg[k] = (process.env[k] || '').trim() || DEFAULTS[k] || '';
  cfg.JIRA_BASE_URL = cfg.JIRA_BASE_URL.replace(/\/+$/, '');
  return cfg;
}

export function publicSettings() {
  const c = getConfig();
  return {
    jiraBaseUrl: c.JIRA_BASE_URL,
    jiraEmail: c.JIRA_EMAIL,
    jiraAcField: c.JIRA_AC_FIELD,
    groqModel: c.GROQ_MODEL,
    productName: c.PRODUCT_NAME,
    jiraApiTokenSet: Boolean(c.JIRA_API_TOKEN),
    groqApiKeySet: Boolean(c.GROQ_API_KEY),
  };
}

const FIELD_MAP = {
  jiraBaseUrl: 'JIRA_BASE_URL',
  jiraEmail: 'JIRA_EMAIL',
  jiraApiToken: 'JIRA_API_TOKEN',
  jiraAcField: 'JIRA_AC_FIELD',
  groqApiKey: 'GROQ_API_KEY',
  groqModel: 'GROQ_MODEL',
  productName: 'PRODUCT_NAME',
};

export function updateSettings(patch, { persist = true } = {}) {
  if (!patch || typeof patch !== 'object') throw new AppError(400, 'BAD_REQUEST', 'Settings payload must be an object.');
  for (const [field, raw] of Object.entries(patch)) {
    const key = FIELD_MAP[field];
    if (!key) throw new AppError(400, 'BAD_REQUEST', `Unknown setting: ${field}`);
    if (typeof raw !== 'string') throw new AppError(400, 'BAD_REQUEST', `${field} must be a string.`);
    const value = raw.trim();
    if (SECRETS.has(key) && value === '') continue; // blank secret = keep existing
    if (key === 'JIRA_BASE_URL' && value && !/^https:\/\/[^\s/]+/i.test(value)) {
      throw new AppError(400, 'BAD_REQUEST', 'Jira base URL must start with https://');
    }
    if (key === 'JIRA_AC_FIELD' && value && !/^customfield_\d+$/.test(value)) {
      throw new AppError(400, 'BAD_REQUEST', 'Acceptance criteria field must look like customfield_12345.');
    }
    if (/[\r\n]/.test(value)) throw new AppError(400, 'BAD_REQUEST', `${field} must be a single line.`);
    process.env[key] = value;
  }
  if (persist) {
    const lines = [`PORT=${process.env.PORT || 8787}`, ...KEYS.map((k) => `${k}=${process.env[k] || ''}`)];
    fs.writeFileSync(ENV_PATH, lines.join('\n') + '\n', 'utf8');
  }
  return publicSettings();
}
