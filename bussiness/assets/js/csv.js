// CSV export that opens cleanly in Excel / Google Sheets (UTF-8 BOM, CRLF) and cannot be used for formula injection.
const SAFE_PHONE = /^[+-]?[\d\s().-]*$/;
const cell = v => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s) && !SAFE_PHONE.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCSV = (headers, rows) => [headers, ...rows].map(r => r.map(cell).join(',')).join('\r\n');
export function downloadCSV(name, headers, rows) {
  const blob = new Blob(['﻿' + toCSV(headers, rows)], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
