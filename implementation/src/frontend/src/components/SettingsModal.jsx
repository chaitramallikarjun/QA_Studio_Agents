import React, { useEffect, useState } from 'react';
import { getSettings, saveSettings } from '../api.js';

const FIELDS = [
  { key: 'jiraBaseUrl', label: 'Jira base URL', placeholder: 'https://your-site.atlassian.net' },
  { key: 'jiraEmail', label: 'Jira email' },
  { key: 'jiraApiToken', label: 'Jira API token', secret: 'jiraApiTokenSet' },
  { key: 'jiraAcField', label: 'Acceptance criteria field (optional)', placeholder: 'customfield_10035' },
  { key: 'groqApiKey', label: 'Groq API key', secret: 'groqApiKeySet' },
  { key: 'groqModel', label: 'Groq model' },
  { key: 'productName', label: 'Product name' },
];

export default function SettingsModal({ onClose }) {
  const [current, setCurrent] = useState(null);
  const [form, setForm] = useState({});
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getSettings()
      .then((s) => {
        setCurrent(s);
        setForm(Object.fromEntries(FIELDS.map((f) => [f.key, f.secret ? '' : s[f.key] || ''])));
      })
      .catch((e) => setError(e.message));
  }, []);

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const s = await saveSettings(form);
      setCurrent(s);
      setForm((f) => ({ ...f, jiraApiToken: '', groqApiKey: '' }));
      setSaved(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <div className="card-head">
          <h2>Settings</h2>
          <button type="button" className="btn outline" onClick={onClose}>✕</button>
        </div>
        {!current && !error && <div className="state">Loading…</div>}
        {current && FIELDS.map((f) => (
          <label className="field" key={f.key}>
            <span>{f.label}{f.secret && <em className={current[f.secret] ? 'ok-text' : 'err-text'}> · {current[f.secret] ? 'configured' : 'not set'}</em>}</span>
            <input
              type={f.secret ? 'password' : 'text'}
              autoComplete="off"
              value={form[f.key] || ''}
              placeholder={f.secret ? (current[f.secret] ? 'Leave blank to keep current value' : 'Enter value') : f.placeholder}
              onChange={(e) => { setSaved(false); setForm({ ...form, [f.key]: e.target.value }); }}
            />
          </label>
        ))}
        <p className="muted small">Secrets are stored only in the backend <code>.env</code> file and are never sent back to the browser.</p>
        {error && <div className="alert error">{error}</div>}
        {saved && <div className="alert ok">Settings saved.</div>}
        <div className="right">
          <button className="btn primary" disabled={!current || saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </div>
  );
}
