import React, { useState } from 'react';
import Workspace from './components/Workspace.jsx';
import SettingsModal from './components/SettingsModal.jsx';

const TABS = [
  { id: 'plan', label: 'Test Plan' },
  { id: 'strategy', label: 'Test Strategy' },
  { id: 'testcases', label: 'Test Cases' },
];

export default function App() {
  const [tab, setTab] = useState('plan');
  const [showSettings, setShowSettings] = useState(false);

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <span className="logo" aria-hidden>☑</span>
          <h1>QA Plan Studio</h1>
          <span className="divider" />
          <span className="subtitle">Create your QA documentation from Jira</span>
        </div>
        <button className="btn outline" onClick={() => setShowSettings(true)}>⚙ Settings</button>
      </header>
      <nav className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
      {/* Workspaces stay mounted so each tab keeps its own input and result. */}
      {TABS.map((t) => (
        <div key={t.id} hidden={tab !== t.id}>
          <Workspace artifact={t.id} />
        </div>
      ))}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  );
}
