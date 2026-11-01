// Client-side PDF generation for invoices and quotations (jsPDF + autoTable, loaded on demand).
const LIBS = [
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js'
];
let loading;
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load the PDF library. Check your internet connection and try again.'));
    document.head.append(s);
  });
}
function ensureLibs() {
  if (!loading) loading = (async () => { for (const src of LIBS) await loadScript(src); })().catch(e => { loading = null; throw e; });
  return loading;
}

const ACCENT = [47, 95, 232], INK = [28, 43, 81], MUTED = [110, 122, 150], LINE = [226, 231, 243];
const fmtDate = d => d ? new Date(d.length === 10 ? `${d}T00:00:00` : d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '-';

/**
 * kind: 'invoice' | 'quotation'
 * data: { number, doc (row), items[], payments[], biz, client, project }
 */
export async function downloadPDF(kind, data) {
  await ensureLibs();
  const { jsPDF } = window.jspdf;
  const { doc: d, items, payments = [], biz = {}, client = {}, project } = data;
  const cur = biz.currency || 'LKR';
  const money = n => `${cur} ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = pdf.internal.pageSize.getWidth(), M = 44;
  const isInv = kind === 'invoice';

  // header band
  pdf.setFillColor(...ACCENT); pdf.rect(0, 0, W, 8, 'F');
  pdf.setTextColor(...INK); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(20);
  pdf.text(biz.business_name || 'StudioDesk', M, 52);
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(...MUTED);
  const contact = [biz.address, [biz.email, biz.phone].filter(Boolean).join('  |  ')].filter(Boolean).join('\n');
  if (contact) pdf.text(pdf.splitTextToSize(contact, 230), M, 68);

  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(26); pdf.setTextColor(...ACCENT);
  pdf.text(isInv ? 'INVOICE' : 'QUOTATION', W - M, 52, { align: 'right' });
  pdf.setFontSize(11); pdf.setTextColor(...INK); pdf.text(data.number, W - M, 70, { align: 'right' });
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(...MUTED);
  const meta = isInv
    ? [`Issued: ${fmtDate(d.issue_date)}`, `Due: ${fmtDate(d.due_date)}`, `Status: ${data.status || d.status}`]
    : [`Date: ${fmtDate(d.created_at)}`, `Valid until: ${fmtDate(d.valid_until)}`, `Status: ${d.status}`];
  meta.forEach((t, i) => pdf.text(t, W - M, 86 + i * 12, { align: 'right' }));

  // bill to
  let y = 140;
  pdf.setDrawColor(...LINE); pdf.line(M, y - 14, W - M, y - 14);
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8); pdf.setTextColor(...MUTED);
  pdf.text(isInv ? 'BILL TO' : 'PREPARED FOR', M, y);
  pdf.setFontSize(11); pdf.setTextColor(...INK); pdf.text(client.name || '-', M, y + 15);
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(...MUTED);
  const clientLines = [client.business_name, client.email, client.address].filter(Boolean).join('\n');
  if (clientLines) pdf.text(pdf.splitTextToSize(clientLines, 240), M, y + 29);
  if (project) {
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8); pdf.text('PROJECT', W / 2 + 40, y);
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10); pdf.setTextColor(...INK); pdf.text(pdf.splitTextToSize(project, 220), W / 2 + 40, y + 15);
  }

  // items
  pdf.autoTable({
    startY: y + 80,
    head: [['Description', 'Qty', 'Unit price', 'Amount']],
    body: items.map(x => [x.description, String(Number(x.quantity)), money(x.unit_price), money(x.quantity * x.unit_price)]),
    theme: 'plain',
    styles: { font: 'helvetica', fontSize: 9.5, cellPadding: { top: 8, bottom: 8, left: 6, right: 6 }, textColor: INK },
    headStyles: { fillColor: [242, 245, 255], textColor: MUTED, fontStyle: 'bold', fontSize: 8.5 },
    columnStyles: { 0: { cellWidth: 'auto' }, 1: { halign: 'right', cellWidth: 50 }, 2: { halign: 'right', cellWidth: 100 }, 3: { halign: 'right', cellWidth: 100 } },
    didDrawCell: h => { if (h.section === 'body' && h.column.index === 3) { pdf.setDrawColor(...LINE); pdf.line(M, h.cell.y + h.cell.height, W - M, h.cell.y + h.cell.height); } },
    margin: { left: M, right: M }
  });

  // totals
  let ty = pdf.lastAutoTable.finalY + 22;
  const tx = W - M - 200;
  const row = (label, value, bold = false) => {
    if (ty > 760) { pdf.addPage(); ty = 60; }
    pdf.setFont('helvetica', bold ? 'bold' : 'normal'); pdf.setFontSize(bold ? 11 : 9.5); pdf.setTextColor(...(bold ? INK : MUTED));
    pdf.text(label, tx, ty); pdf.setTextColor(...INK); pdf.text(value, W - M, ty, { align: 'right' }); ty += bold ? 20 : 16;
  };
  row('Subtotal', money(d.subtotal));
  if (Number(d.discount)) row('Discount', `- ${money(d.discount)}`);
  if (Number(d.tax_rate)) row(`Tax (${Number(d.tax_rate)}%)`, money(d.total - (d.subtotal - d.discount)));
  pdf.setDrawColor(...ACCENT); pdf.line(tx, ty - 10, W - M, ty - 10); ty += 4;
  row('Total', money(d.total), true);
  if (isInv) {
    const paid = payments.filter(p => p.verified).reduce((n, p) => n + Number(p.amount), 0);
    if (paid > 0) row('Paid', `- ${money(paid)}`);
    row('Balance due', money(Math.max(0, d.total - paid)), true);
  }

  // notes / terms / bank
  const blocks = [];
  if (isInv && d.payment_terms) blocks.push(['PAYMENT TERMS', d.payment_terms]);
  if (d.notes) blocks.push(['NOTES', d.notes]);
  if (isInv && biz.bank_details) blocks.push(['PAYMENT DETAILS', biz.bank_details]);
  ty += 14;
  blocks.forEach(([t, body]) => {
    const lines = pdf.splitTextToSize(body, W - M * 2);
    if (ty + 20 + lines.length * 12 > 800) { pdf.addPage(); ty = 60; }
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8); pdf.setTextColor(...MUTED); pdf.text(t, M, ty);
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9.5); pdf.setTextColor(...INK); pdf.text(lines, M, ty + 13);
    ty += 28 + lines.length * 12;
  });

  // footer on every page
  const pages = pdf.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    pdf.setPage(i); pdf.setFontSize(8); pdf.setTextColor(...MUTED);
    pdf.text(isInv ? 'Thank you for your business.' : 'Thank you for considering us. This quotation is valid until the date shown above.', M, 818);
    pdf.text(`Page ${i} of ${pages}`, W - M, 818, { align: 'right' });
  }
  const safe = s => String(s || '').replace(/[^\w\-]+/g, '_').replace(/^_+|_+$/g, '');
  pdf.save(`${data.number}${client.name ? '-' + safe(client.name) : ''}.pdf`);
}

/* ======================================================================
   Reports: per-client report and monthly studio summary
   ====================================================================== */
const safeName = s => String(s || '').replace(/[^\w\-]+/g, '_').replace(/^_+|_+$/g, '');
const fmtStamp = () => new Date().toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

function reportShell(pdf, { biz, title, subtitle }) {
  const W = pdf.internal.pageSize.getWidth(), M = 44;
  pdf.setFillColor(...ACCENT); pdf.rect(0, 0, W, 8, 'F');
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(18); pdf.setTextColor(...INK);
  pdf.text(biz.business_name || 'StudioDesk', M, 50);
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(...MUTED);
  pdf.text(`Generated ${fmtStamp()}`, M, 65);
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(22); pdf.setTextColor(...ACCENT);
  pdf.text(title, W - M, 50, { align: 'right' });
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10); pdf.setTextColor(...INK);
  pdf.text(subtitle, W - M, 67, { align: 'right' });
  return { W, M, y: 96 };
}

function kpiRow(pdf, ctx, items) {
  const { W, M } = ctx, gap = 8, bw = (W - M * 2 - gap * (items.length - 1)) / items.length;
  items.forEach(([label, value], i) => {
    const x = M + i * (bw + gap);
    pdf.setFillColor(242, 245, 255); pdf.roundedRect(x, ctx.y, bw, 52, 5, 5, 'F');
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(7.5); pdf.setTextColor(...MUTED); pdf.text(label.toUpperCase(), x + 10, ctx.y + 17);
    pdf.setTextColor(...INK);
    let fs = 12; pdf.setFontSize(fs); while (fs > 6 && pdf.getTextWidth(String(value)) > bw - 16) { fs -= 0.5; pdf.setFontSize(fs); }   // shrink to fit, never wrap
    pdf.text(String(value), x + 10, ctx.y + 38);
  });
  ctx.y += 52 + 20;
}

function section(pdf, ctx, heading, head, body, opts = {}) {
  const { W, M } = ctx;
  if (ctx.y > 740) { pdf.addPage(); ctx.y = 56; }
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11); pdf.setTextColor(...INK); pdf.text(heading, M, ctx.y);
  pdf.autoTable({
    startY: ctx.y + 8, head: [head], theme: 'plain',
    body: body.length ? body : [[{ content: 'Nothing to show.', colSpan: head.length, styles: { textColor: MUTED, fontStyle: 'italic' } }]],
    styles: { font: 'helvetica', fontSize: 8.5, cellPadding: { top: 5, bottom: 5, left: 5, right: 5 }, textColor: INK, overflow: 'linebreak' },
    headStyles: { fillColor: [242, 245, 255], textColor: MUTED, fontStyle: 'bold', fontSize: 7.5 },
    columnStyles: opts.columnStyles || {},
    didParseCell: h => { const a = (opts.columnStyles || {})[h.column.index]?.halign; if (a && h.section === 'head') h.cell.styles.halign = a; },
    didDrawCell: h => { if (h.section === 'body') { pdf.setDrawColor(...LINE); pdf.line(M, h.cell.y + h.cell.height, W - M, h.cell.y + h.cell.height); } },
    margin: { left: M, right: M, bottom: 40 }
  });
  ctx.y = pdf.lastAutoTable.finalY + 24;
}

function footers(pdf, left) {
  const W = pdf.internal.pageSize.getWidth(), pages = pdf.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    pdf.setPage(i); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(...MUTED);
    pdf.text(left, 44, 818); pdf.text(`Page ${i} of ${pages}`, W - 44, 818, { align: 'right' });
  }
}

/** data: { client, projects[], invoices[], payments[], activity[], biz } */
export async function downloadClientReport(data) {
  await ensureLibs();
  const { jsPDF } = window.jspdf;
  const { client: c, projects = [], invoices = [], payments = [], activity = [], biz = {} } = data;
  const cur = biz.currency || 'LKR';
  const money = n => `${cur} ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const today = new Date().toLocaleDateString('en-CA');
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
  const ctx = reportShell(pdf, { biz, title: 'CLIENT REPORT', subtitle: c.name || '' });
  const { M } = ctx;

  // client card
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8); pdf.setTextColor(...MUTED); pdf.text('CLIENT', M, ctx.y);
  pdf.setFontSize(13); pdf.setTextColor(...INK); pdf.text(c.name || '-', M, ctx.y + 16);
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(...MUTED);
  const lines = [c.business_name, c.email, c.phone, c.address, `Client since ${fmtDate(c.created_at)}`, c.archived_at ? 'Status: Archived' : 'Status: Active'].filter(Boolean);
  pdf.text(lines.flatMap(l => pdf.splitTextToSize(String(l), 480)), M, ctx.y + 31);
  ctx.y += 31 + lines.length * 12 + 14;

  const live = invoices.filter(i => i.status !== 'Void');
  const paidBy = {}; payments.filter(p => p.verified).forEach(p => { paidBy[p.invoice_id] = (paidBy[p.invoice_id] || 0) + Number(p.amount); });
  const invoiced = live.reduce((n, i) => n + Number(i.total), 0);
  const paid = live.reduce((n, i) => n + (paidBy[i.id] || 0), 0);
  const open = projects.filter(p => !['Completed', 'Cancelled'].includes(p.status));
  kpiRow(pdf, ctx, [['Projects', `${projects.length} (${open.length} open)`], ['Completed', projects.filter(p => p.status === 'Completed').length], ['Invoiced', money(invoiced)], ['Paid', money(paid)], ['Outstanding', money(Math.max(0, invoiced - paid))]]);

  section(pdf, ctx, 'Projects', ['Code', 'Project', 'Category', 'Status', 'Progress', 'Deadline', 'Agreed price'],
    projects.map(p => [`P-${p.project_code}`, p.title, p.category || '-', p.status, `${p.progress || 0}%`, fmtDate(p.deadline), money(p.agreed_price)]),
    { columnStyles: { 6: { halign: 'right' }, 4: { halign: 'right' } } });
  section(pdf, ctx, 'Invoices', ['Invoice', 'Issued', 'Due', 'Total', 'Paid', 'Balance', 'Status'],
    invoices.map(i => {
      const eff = (['Pending', 'Partially Paid'].includes(i.status) && i.due_date && i.due_date < today) ? 'Overdue' : i.status;
      return [`INV-${String(i.invoice_number).padStart(4, '0')}`, fmtDate(i.issue_date), fmtDate(i.due_date), money(i.total), money(paidBy[i.id] || 0), i.status === 'Void' ? '-' : money(Math.max(0, i.total - (paidBy[i.id] || 0))), eff];
    }), { columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } } });
  const invNum = Object.fromEntries(invoices.map(i => [i.id, `INV-${String(i.invoice_number).padStart(4, '0')}`]));
  section(pdf, ctx, 'Payments received', ['Date', 'Invoice', 'Method', 'Reference', 'Amount', 'Verified'],
    payments.map(p => [fmtDate(p.paid_at), invNum[p.invoice_id] || '-', p.method, p.reference || '-', money(p.amount), p.verified ? 'Yes' : 'No']),
    { columnStyles: { 4: { halign: 'right' } } });
  section(pdf, ctx, 'Recent activity', ['When', 'Event', 'Detail'],
    activity.map(a => [new Date(a.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }), a.action.replace(/^db\./, '').replace(/\./g, ' '), [a.detail?.label, a.detail?.changed && `changed: ${Object.keys(a.detail.changed).join(', ')}`, a.detail?.message].filter(Boolean).join(' · ')]));

  footers(pdf, `Client report · ${c.name || ''}`);
  pdf.save(`Client-report-${safeName(c.name) || 'client'}-${today}.pdf`);
}

/** data: { month: 'YYYY-MM', label, newClients[], projectsCreated[], projectsCompleted[], activeProjects[], invoices[], payments[], quotations[], filesCount, messagesCount, activityCounts{}, clientNames{}, snapshot:{outstanding, overdue}, biz } */
export async function downloadMonthlyReport(data) {
  await ensureLibs();
  const { jsPDF } = window.jspdf;
  const { biz = {}, label } = data;
  const cur = biz.currency || 'LKR';
  const money = n => `${cur} ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
  const ctx = reportShell(pdf, { biz, title: 'MONTHLY SUMMARY', subtitle: label });
  const sum = (arr, f) => arr.reduce((n, x) => n + Number(f(x) || 0), 0);
  const issued = data.invoices.filter(i => i.status !== 'Void');
  const received = data.payments.filter(p => p.verified);

  kpiRow(pdf, ctx, [['New clients', data.newClients.length], ['New projects', data.projectsCreated.length], ['Completed', data.projectsCompleted.length], ['Invoiced', money(sum(issued, i => i.total))], ['Received', money(sum(received, p => p.amount))]]);
  if (data.expenses?.length) {
    const spent = sum(data.expenses, e => e.amount), got = sum(received, p => p.amount);
    kpiRow(pdf, ctx, [['Expenses', money(spent)], ['Net profit (cash)', money(got - spent)]]);
  }
  kpiRow(pdf, ctx, [['Quotations sent', data.quotations.length], ['Accepted', data.quotations.filter(x => x.status === 'Accepted').length], ['Files uploaded', data.filesCount], ['Messages', data.messagesCount], ['Outstanding now', money(data.snapshot.outstanding)]]);

  const byClient = {};
  received.forEach(p => { const n = data.clientNames[p.client_id] || 'Unknown'; byClient[n] = (byClient[n] || 0) + Number(p.amount); });
  const top = Object.entries(byClient).sort((a, b) => b[1] - a[1]).slice(0, 8);
  section(pdf, ctx, 'Revenue by client (payments received)', ['Client', 'Received'], top.map(([n, v]) => [n, money(v)]), { columnStyles: { 1: { halign: 'right' } } });
  if (data.expenses?.length) {
    const byCat = {}; data.expenses.forEach(e => { byCat[e.category] = (byCat[e.category] || 0) + Number(e.amount); });
    section(pdf, ctx, 'Expenses by category', ['Category', 'Spent'], Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([c, v]) => [c, money(v)]), { columnStyles: { 1: { halign: 'right' } } });
    section(pdf, ctx, 'Expenses', ['Date', 'Category', 'Paid to', 'Notes', 'Amount'], data.expenses.map(e => [fmtDate(e.spent_on), e.category, e.vendor || '-', e.description || '-', money(e.amount)]), { columnStyles: { 4: { halign: 'right' } } });
  }
  section(pdf, ctx, 'New clients', ['Name', 'Business', 'Email', 'Registered'], data.newClients.map(c => [c.name, c.business_name || '-', c.email, fmtDate(c.created_at)]));
  section(pdf, ctx, 'Projects started this month', ['Code', 'Project', 'Client', 'Status', 'Agreed price'], data.projectsCreated.map(p => [`P-${p.project_code}`, p.title, data.clientNames[p.client_id] || '-', p.status, money(p.agreed_price)]), { columnStyles: { 4: { halign: 'right' } } });
  section(pdf, ctx, 'Projects completed this month', ['Code', 'Project', 'Client', 'Completed'], data.projectsCompleted.map(p => [`P-${p.project_code}`, p.title, data.clientNames[p.client_id] || '-', fmtDate(p.updated_at)]));
  section(pdf, ctx, 'Invoices issued', ['Invoice', 'Client', 'Issued', 'Total', 'Status'], data.invoices.map(i => [`INV-${String(i.invoice_number).padStart(4, '0')}`, data.clientNames[i.client_id] || '-', fmtDate(i.issue_date), money(i.total), i.status]), { columnStyles: { 3: { halign: 'right' } } });
  section(pdf, ctx, 'Payments received', ['Date', 'Client', 'Method', 'Reference', 'Amount'], received.map(p => [fmtDate(p.paid_at), data.clientNames[p.client_id] || '-', p.method, p.reference || '-', money(p.amount)]), { columnStyles: { 4: { halign: 'right' } } });
  section(pdf, ctx, 'Projects in progress (current)', ['Code', 'Project', 'Client', 'Status', 'Progress', 'Deadline'], data.activeProjects.map(p => [`P-${p.project_code}`, p.title, data.clientNames[p.client_id] || '-', p.status, `${p.progress || 0}%`, fmtDate(p.deadline)]), { columnStyles: { 4: { halign: 'right' } } });
  section(pdf, ctx, 'Database activity this month', ['Event', 'Count'], Object.entries(data.activityCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, String(v)]), { columnStyles: { 1: { halign: 'right' } } });

  footers(pdf, `Monthly summary · ${label}`);
  pdf.save(`Monthly-summary-${data.month}.pdf`);
}
