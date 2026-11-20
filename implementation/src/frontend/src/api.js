async function handle(res) {
  if (res.ok) return res;
  let message = `Request failed (HTTP ${res.status}).`;
  try {
    const body = await res.json();
    if (body?.error?.message) message = body.error.message;
  } catch {
    /* non-JSON error */
  }
  throw new Error(message);
}

export async function generate(artifact, payload) {
  const res = await fetch(`/api/generate/${artifact}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  return (await handle(res)).json();
}

export async function getSettings() {
  return (await handle(await fetch('/api/settings'))).json();
}

export async function saveSettings(patch) {
  const res = await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
  return (await handle(res)).json();
}

export async function exportTestCases(format, testCases, meta) {
  const res = await fetch('/api/export/testcases', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ format, testCases, meta }) });
  const blob = await (await handle(res)).blob();
  downloadBlob(blob, `test-cases-${meta.source}.${format}`);
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
