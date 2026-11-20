import React, { useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { downloadBlob, exportTestCases, generate } from '../api.js';
import GapsPanel from './GapsPanel.jsx';
import ValidationPanel from './ValidationPanel.jsx';
import TestCaseTable from './TestCaseTable.jsx';

const META = {
  plan: { title: 'Test plan', button: 'Generate test plan', inputLabel: 'Jira ticket or prompt' },
  strategy: { title: 'Test strategy', button: 'Generate test strategy', inputLabel: 'Jira scope or prompt' },
  testcases: { title: 'Test cases', button: 'Generate test cases', inputLabel: 'Jira ticket or prompt' },
};

function toTsv(testCases) {
  const cols = ['id', 'reqIds', 'module', 'functionality', 'title', 'type', 'technique', 'preconditions', 'steps', 'testData', 'expectedResult', 'priority', 'tags', 'sourceQuote', 'confidence', 'status'];
  const v = (x) => (Array.isArray(x) ? x.join(', ') : String(x ?? '')).replace(/\t/g, ' ').replace(/\r?\n/g, ' ');
  return [cols.join('\t'), ...testCases.map((t) => cols.map((c) => v(t[c])).join('\t'))].join('\n');
}

export default function Workspace({ artifact }) {
  const meta = META[artifact];
  const [input, setInput] = useState('');
  const [context, setContext] = useState('');
  const [scope, setScope] = useState('issue');
  const [answers, setAnswers] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);
  const [notice, setNotice] = useState('');

  async function run(withAnswers) {
    if (loading) return;
    if (!input.trim()) {
      setError('Enter a Jira issue key (e.g. SCRUM-5) or describe what you want to test.');
      return;
    }
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const payload = { input: input.trim(), context, scope, answers: withAnswers ? Object.entries(answers).map(([id, a]) => ({ id, ...a })) : [] };
      if (!withAnswers) setAnswers({});
      setData(await generate(artifact, payload));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function copy() {
    const text = artifact === 'testcases' ? toTsv(data.result.testCases) : data.markdown;
    await navigator.clipboard.writeText(text);
    setNotice('Copied to clipboard.');
  }

  async function doExport(format) {
    setError('');
    const source = data.source.keys.join('_');
    try {
      if (format === 'md') downloadBlob(new Blob([data.markdown], { type: 'text/markdown' }), `${artifact === 'plan' ? 'test-plan' : 'test-strategy'}-${source}.md`);
      else await exportTestCases(format, data.result.testCases, { source, status: data.status });
    } catch (e) {
      setError(e.message);
    }
  }

  const isDraft = data?.status?.startsWith('Draft');

  return (
    <>
      <section className="card">
        <div className="card-head">
          <h2>{meta.title}</h2>
          <div className="actions">
            <button className="btn outline" disabled={!data} onClick={copy}>⧉ Copy</button>
            {artifact === 'testcases' ? (
              <>
                <button className="btn outline" disabled={!data} onClick={() => doExport('xlsx')}>⤓ Excel</button>
                <button className="btn outline" disabled={!data} onClick={() => doExport('csv')}>CSV</button>
              </>
            ) : (
              <button className="btn outline" disabled={!data} onClick={() => doExport('md')}>⤓ Export</button>
            )}
          </div>
        </div>
        <div className="card-body result">
          {loading && <div className="state">⏳ Fetching Jira, extracting requirements, generating and reviewing… this can take a minute.</div>}
          {!loading && !data && <div className="state empty">Enter a Jira ticket below and click “{meta.button}”.</div>}
          {!loading && data && (
            <>
              <div className="result-meta">
                <span className={`pill ${isDraft ? 'draft' : 'final'}`}>{data.status}</span>
                <span className="muted">{data.source.keys.join(', ')} · {data.source.model}</span>
              </div>
              {data.source.keys.length > 1 && <div className="muted small">Epic {data.source.keys[0]} and direct children · {data.source.keys.length} Jira tickets retrieved</div>}
              {artifact === 'testcases' ? (
                <TestCaseTable testCases={data.result.testCases} />
              ) : (
                <div className="markdown" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(data.markdown)) }} />
              )}
            </>
          )}
        </div>
      </section>

      {data && !loading && (
        <>
          <GapsPanel questions={data.questions} answers={answers} setAnswers={setAnswers} onRegenerate={() => run(true)} loading={loading} />
          <ValidationPanel data={data} />
        </>
      )}

      <section className="card">
        <div className="card-body">
          <h3>{meta.inputLabel}</h3>
          {artifact === 'strategy' && (
            <label className="field">
              <span>Scope</span>
              <select value={scope} onChange={(e) => setScope(e.target.value)} disabled={loading}>
                <option value="issue">Single issue</option>
                <option value="epic">Epic + direct children</option>
              </select>
            </label>
          )}
          <div className="input-row">
            <textarea rows={2} value={input} onChange={(e) => setInput(e.target.value)} placeholder="Enter SCRUM-5 or describe what you want to test…" disabled={loading} />
            <button className="btn primary" onClick={() => run(false)} disabled={loading}>{loading ? 'Generating…' : `✦ ${meta.button}`}</button>
          </div>
          <label className="field">
            <span>Additional testing context <em>(optional)</em></span>
            <textarea rows={2} value={context} onChange={(e) => setContext(e.target.value)} placeholder="Focus areas, risks, constraints… (guidance only, not treated as requirements)" disabled={loading} />
          </label>
          {error && <div className="alert error" role="alert">{error}</div>}
          {notice && <div className="alert ok">{notice}</div>}
        </div>
      </section>
    </>
  );
}
