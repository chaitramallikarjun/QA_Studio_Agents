import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getConfig, publicSettings, updateSettings } from './lib/config.js';
import { AppError } from './lib/errors.js';
import { createJiraClient } from './lib/jira.js';
import { createGroqClient } from './lib/llm.js';
import { runPipeline } from './lib/pipeline.js';
import { toCsv, toXlsx } from './lib/exporter.js';

// Express 4 does not forward rejected promises to the error handler.
const wrap = (fn) => (req, res, next) => Promise.resolve().then(() => fn(req, res, next)).catch(next);

export function createApp({ llm = createGroqClient(), jira = createJiraClient() } = {}) {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  const inFlight = new Set();

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/settings', (_req, res) => res.json(publicSettings()));
  app.put('/api/settings', wrap((req, res) => res.json(updateSettings(req.body))));

  app.post('/api/generate/:artifact', wrap(async (req, res) => {
    const { artifact } = req.params;
    const { input, scope = 'issue', context = '', answers = [] } = req.body || {};
    if (!['plan', 'strategy', 'testcases'].includes(artifact)) throw new AppError(404, 'NOT_FOUND', 'Unknown artifact.');
    if (typeof input !== 'string' || !input.trim()) throw new AppError(400, 'BAD_REQUEST', 'Enter a Jira issue key (e.g. SCRUM-5) or requirement text.');
    if (input.length > 20000 || typeof context !== 'string' || context.length > 4000) throw new AppError(400, 'BAD_REQUEST', 'Input is too long.');
    if (!['issue', 'epic'].includes(scope)) throw new AppError(400, 'BAD_REQUEST', 'Scope must be "issue" or "epic".');
    if (!Array.isArray(answers) || answers.length > 200) throw new AppError(400, 'BAD_REQUEST', 'Invalid answers payload.');
    const lock = `${artifact}:${input.trim().toUpperCase()}`;
    if (inFlight.has(lock)) throw new AppError(409, 'IN_PROGRESS', 'This request is already being generated.');
    inFlight.add(lock);
    try {
      const result = await runPipeline({ artifact, input, scope, context, answers, llm, jira, productName: getConfig().PRODUCT_NAME });
      res.json(result);
    } finally {
      inFlight.delete(lock);
    }
  }));

  app.post('/api/export/testcases', wrap(async (req, res) => {
    const { format, testCases, meta } = req.body || {};
    if (!Array.isArray(testCases) || !testCases.length) throw new AppError(400, 'BAD_REQUEST', 'No test cases to export.');
    const base = `test-cases-${String(meta?.source || 'qa-studio').replace(/[^A-Za-z0-9_-]+/g, '_')}`;
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${base}.csv"`);
      return res.send(toCsv(testCases));
    }
    if (format === 'xlsx') {
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${base}.xlsx"`);
      return res.send(await toXlsx(testCases, meta));
    }
    throw new AppError(400, 'BAD_REQUEST', 'Format must be csv or xlsx.');
  }));

  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'frontend', 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  // eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
    if (err instanceof AppError) {
      return res.status(err.status).json({
        error: {
          code: err.code,
          message: err.message
        }
      });
    }

    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({
        error: {
          code: 'BAD_REQUEST',
          message: 'Invalid JSON body.'
        }
      });
    }

    console.error('[qa-studio] unexpected error:', err.message);

    res.status(500).json({
      error: {
        code: 'INTERNAL',
        message: 'Unexpected server error.'
      }
    });
  });

  return app;
}

// Create app instance
const app = createApp();

// Required by Vercel Services
export default app;

// Local development only
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const port = Number(process.env.PORT) || 8787;

  app.listen(port, () => {
    console.log(`QA Studio backend listening on http://localhost:${port}`);
  });
}
