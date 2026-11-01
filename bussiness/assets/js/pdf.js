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
