import ExcelJS from 'exceljs';
import { loadTemplate } from './prompts.js';

function rows(testCases) {
  const { columns } = loadTemplate('testcases');
  const value = (tc, key) => (Array.isArray(tc[key]) ? tc[key].join(', ') : String(tc[key] ?? ''));
  return { columns, data: testCases.map((tc) => columns.map((c) => value(tc, c.key))) };
}

// Prefix formula-like cells to prevent CSV/Excel formula injection.
const safe = (v) => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v);

export function toCsv(testCases) {
  const { columns, data } = rows(testCases);
  const esc = (v) => `"${safe(v).replace(/"/g, '""')}"`;
  return '\uFEFF' + [columns.map((c) => esc(c.label)), ...data.map((r) => r.map(esc))].map((r) => r.join(',')).join('\r\n');
}

export async function toXlsx(testCases, meta = {}) {
  const { columns, data } = rows(testCases);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'QA Studio';
  const ws = wb.addWorksheet('Test Cases');
  ws.columns = columns.map((c) => ({ header: c.label, key: c.key, width: c.key === 'steps' ? 60 : c.key === 'expectedResult' || c.key === 'sourceQuote' ? 40 : 18 }));
  data.forEach((r) => ws.addRow(r.map(safe)));
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3730A3' } };
  ws.eachRow((row) => (row.alignment = { wrapText: true, vertical: 'top' }));
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  if (meta.source) {
    const info = wb.addWorksheet('Info');
    info.addRow(['Source', meta.source]);
    info.addRow(['Status', meta.status || '']);
    info.addRow(['Generated', new Date().toISOString()]);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
