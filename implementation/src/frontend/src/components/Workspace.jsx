import React, { useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { downloadBlob, generate } from '../api.js';

const META = {
  plan: { title: 'Test plan', button: 'Generate test plan', inputLabel: 'Jira ticket or prompt' },
  strategy: { title: 'Test strategy', button: 'Generate test strategy', inputLabel: 'Jira scope or prompt' },
  testcases: { title: 'Test cases', button: 'Generate test cases', inputLabel: 'Jira ticket or prompt' },
};

export default function Workspace({ artifact }) {
  const meta = META[artifact];
  const [input, setInput] = useState('');
  const [context, setContext] = useState('');
  const [scope, setScope] = useState('issue');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);
  const [notice, setNotice] = useState('');

  async function run() {
    if (loading) return;
    if (!input.trim()) {
      setError('Enter a Jira issue key (e.g. SCRUM-5) or describe what you want to test.');
      return;
    }
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const payload = { input: input.trim(), context, scope };
      setData(await generate(artifact, payload));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function copy() {
    await navigator.clipboard.writeText(data.markdown);
    setNotice('Copied to clipboard.');
  }

  function doExport() {
    setError('');
    const source = data.source.keys.join('_');
    const filename = { plan: 'test-plan', strategy: 'test-strategy', testcases: 'test-cases' }[artifact];
    downloadBlob(new Blob([data.markdown], { type: 'text/markdown' }), `${filename}-${source}.md`);
  }

  const isDraft = data?.status?.startsWith('Draft');

  return (
    <>
      <section className="card">
        <div className="card-head">
          <h2>{meta.title}</h2>
          <div className="actions">
            <button className="btn outline" disabled={!data} onClick={copy}>⧉ Copy</button>
            <button className="btn outline" disabled={!data} onClick={doExport}>⤓ Export Markdown</button>
          </div>
        </div>
        <div className="card-body result">
          {loading && <div className="state">⏳ Fetching Jira and drafting the document…</div>}
          {!loading && !data && <div className="state empty">Enter a Jira ticket below and click “{meta.button}”.</div>}
          {!loading && data && (
            <>
              <div className="result-meta">
                <span className={`pill ${isDraft ? 'draft' : 'final'}`}>{data.status}</span>
                <span className="muted">{data.source.keys.join(', ')} · {data.source.model}</span>
              </div>
              {data.source.keys.length > 1 && <div className="muted small">Epic {data.source.keys[0]} and direct children · {data.source.keys.length} Jira tickets retrieved</div>}
              <div className="markdown" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(data.markdown)) }} />
            </>
          )}
        </div>
      </section>

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
            <button className="btn primary" onClick={run} disabled={loading}>{loading ? 'Generating…' : `✦ ${meta.button}`}</button>
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
