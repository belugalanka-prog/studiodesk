import { supabase } from './supabase.js';
import { requireUser, money, date, toast, escapeHTML as h, logActivity, setCurrency } from './common.js';
import { downloadPDF, downloadClientReport, downloadMonthlyReport } from './pdf.js';
import { downloadCSV } from './csv.js';

/* ---------- setup ---------- */
const clientMode = document.body.dataset.role === 'client';
const page = (location.pathname.split('/').pop() || '').replace(/\.html$/, '');
const params = new URLSearchParams(location.search);
const state = { user: null, profile: null, biz: {} };
const $ = s => document.querySelector(s);
const today = () => new Date().toLocaleDateString('en-CA');
const monthKey = d => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`; };
const sum = (arr, f) => arr.reduce((n, x) => n + Number(f(x) || 0), 0);
const clean = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'string' ? (v.trim() === '' ? null : v.trim()) : v]));

const PROJECT_STATUSES = ['New Enquiry', 'Quotation Sent', 'Awaiting Confirmation', 'Confirmed', 'In Progress', 'Internal Review', 'Client Review', 'Revision Requested', 'Approved', 'Ready for Delivery', 'Completed', 'On Hold', 'Cancelled'];
const FILE_CATEGORIES = ['References', 'Original Photos', 'Raw Videos', 'Design Files', 'Previews', 'Edited Videos', 'Final Deliverables', 'Documents', 'Invoices', 'Receipts'];
const QUOTE_STATUSES = ['Draft', 'Sent', 'Accepted', 'Declined', 'Expired'];
const EXPENSE_CATS = ['Equipment', 'Freelancers', 'Software', 'Travel', 'Marketing', 'Rent & utilities', 'Other'];
const EVENT_KINDS = ['Shoot', 'Meeting', 'Delivery', 'Other'];
const EXPORT_RANGES = [['all', 'All time'], ['month', 'This month'], ['last', 'Last month'], ['year', 'This year'], ['lastyear', 'Last year']];

const navAdmin = [['Dashboard', 'dashboard.html', '◫'], ['Clients', 'clients.html', '♙'], ['Projects', 'projects.html', '▣'], ['Tasks', 'tasks.html', '✓'], ['Quotations', 'quotations.html', '▤'], ['Services', 'services.html', '◈'], ['Invoices', 'invoices.html', '▧'], ['Payments', 'payments.html', '＄'], ['Expenses', 'expenses.html', '−'], ['Calendar', 'calendar.html', '▦'], ['Files', 'files.html', '⌁'], ['Messages', 'messages.html', '✉'], ['Reports', 'reports.html', '▥'], ['Audit log', 'audit.html', '☰'], ['Settings', 'settings.html', '⚙']];
const navClient = [['Overview', 'client-dashboard.html', '◫'], ['My projects', 'client-projects.html', '▣'], ['Files', 'client-files.html', '⌁'], ['Quotations', 'client-quotations.html', '▤'], ['Invoices', 'client-invoices.html', '▧'], ['Messages', 'client-messages.html', '✉'], ['My profile', 'client-profile.html', '♙']];
const nav = clientMode ? navClient : navAdmin;
const parentPage = { 'client-details': 'clients', 'project-details': 'projects', 'invoice-details': 'invoices', 'client-project-details': 'client-projects', 'client-invoice-details': 'client-invoices', 'quotation-details': 'quotations', 'client-quotation-details': 'client-quotations' };

const VIEWS = {
  dashboard: { title: 'Dashboard', sub: 'Here’s what’s happening across your studio.', render: () => dashboard() },
  'client-dashboard': { title: 'Overview', sub: 'Your projects, updates and next steps.', render: () => dashboard() },
  clients: { title: 'Clients', sub: 'Manage relationships and keep every client detail in one place.', action: ['＋ New client', 'client'], export: 'clients', render: () => clientsList() },
  'client-details': { title: 'Client', sub: 'Contact details, projects and portal access.', render: () => clientDetails() },
  projects: { title: 'Projects', sub: 'Track creative work from enquiry through final delivery.', action: ['＋ New project', 'project'], render: () => projectsList() },
  'project-details': { title: 'Project', sub: 'Status, tasks, files and conversation.', render: () => projectDetails() },
  tasks: { title: 'Tasks', sub: 'Keep the next actions and deadlines in view.', action: ['＋ New task', 'task'], render: () => tasksList() },
  quotations: { title: 'Quotations', sub: 'Prepare and follow up on project quotations.', action: ['＋ New quotation', 'quote'], render: () => quotationsList() },
  services: { title: 'Services', sub: 'Your price list. Pick these when building quotations and invoices.', action: ['＋ New service', 'service'], render: () => servicesList() },
  'quotation-details': { title: 'Quotation', sub: 'Line items, status and PDF.', render: () => quotationDetails() },
  'client-quotations': { title: 'Quotations', sub: 'Quotes your studio has sent you.', render: () => quotationsList() },
  'client-quotation-details': { title: 'Quotation', sub: 'Review, accept or decline.', render: () => quotationDetails() },
  invoices: { title: 'Invoices', sub: 'Track billing and outstanding balances.', action: ['＋ New invoice', 'invoice'], export: 'invoices', render: () => invoicesList() },
  'invoice-details': { title: 'Invoice', sub: 'Line items, payments and balance.', render: () => invoiceDetails() },
  payments: { title: 'Payments', sub: 'Review verified receipts and payment history.', action: ['＋ Record payment', 'payment'], export: 'payments', render: () => paymentsList() },
  files: { title: 'Files', sub: 'Project assets and client approved deliverables.', action: ['＋ Upload files', 'upload'], render: () => filesList() },
  messages: { title: 'Messages', sub: 'Project conversations in one place.', action: ['＋ New message', 'message'], render: () => messagesList() },
  expenses: { title: 'Expenses', sub: 'Equipment, freelancers, software and other costs.', action: ['＋ Add expense', 'expense'], export: 'expenses', render: () => expensesList() },
  calendar: { title: 'Calendar', sub: 'Deadlines, shoots, tasks and invoices due.', render: () => calendarView() },
  audit: { title: 'Audit log', sub: 'Who changed what, and who signed in.', render: () => auditView() },
  reports: { title: 'Reports', sub: 'A clear view of your business activity.', render: () => reports() },
  settings: { title: 'Settings', sub: 'Business details, currency and preferences.', render: () => settings() },
  'client-projects': { title: 'My projects', sub: 'Follow progress and deadlines for your projects.', render: () => projectsList() },
  'client-project-details': { title: 'Project', sub: 'Status, tasks, files and conversation.', render: () => projectDetails() },
  'client-files': { title: 'Files', sub: 'Files your studio has shared with you.', render: () => filesList() },
  'client-invoices': { title: 'Invoices', sub: 'Your invoices and balances.', render: () => invoicesList() },
  'client-invoice-details': { title: 'Invoice', sub: 'Line items, payments and balance.', render: () => invoiceDetails() },
  'client-messages': { title: 'Messages', sub: 'Project conversations with your studio.', action: ['＋ New message', 'message'], render: () => messagesList() },
  'client-profile': { title: 'My profile', sub: 'Your contact details and account.', render: () => clientProfile() }
};
const view = VIEWS[page] || (clientMode ? VIEWS['client-dashboard'] : VIEWS.dashboard);

/* ---------- layout ---------- */
function layout() {
  const active = (parentPage[page] || page) + '.html';
  const exportHtml = view.export ? `<select class="field inline-select" id="export-range" aria-label="Export period">${EXPORT_RANGES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select><button class="button" data-action="export-csv" data-kind="${view.export}">⬇ Export CSV</button>` : '';
  const actionHtml = exportHtml + (view.action ? `<button class="button primary" data-create="${view.action[1]}">${view.action[0]}</button>` : '');
  document.body.innerHTML = `<div class="app-shell"><aside class="sidebar"><a class="brand" href="${clientMode ? 'client-dashboard.html' : 'dashboard.html'}"><span class="brand-mark">S</span><span>StudioDesk<small>${clientMode ? 'CLIENT PORTAL' : 'CREATIVE OPERATIONS'}</small></span></a><div class="nav-label">${clientMode ? 'WORKSPACE' : 'MANAGE'}</div><nav>${nav.map(([label, url, icon]) => `<a class="nav-link ${active === url ? 'active' : ''}" href="${url}" title="${label}"><span class="nav-icon">${icon}</span><span>${label}</span></a>`).join('')}</nav><div class="sidebar-bottom"><div class="side-user"><span class="side-name"><b data-user-name>Loading…</b><br><span class="muted">${clientMode ? 'Client' : 'Administrator'}</span></span><button class="icon-btn" data-action="signout" title="Sign out">↗</button></div></div></aside><main class="main"><header class="topbar"><span class="crumb">${clientMode ? 'Client portal' : 'StudioDesk'}　/　<span id="crumb-title">${h(view.title)}</span></span><div class="top-actions"><span class="bell-wrap"><button class="icon-btn bell" data-action="bell" title="Notifications" aria-label="Notifications">🔔<span id="bell-count" class="bell-count hidden"></span></button><div id="bell-pop" class="pop hidden"></div></span><button class="icon-btn" data-action="theme" title="Toggle theme">◐</button><span class="avatar" data-avatar>SD</span></div></header><section class="page-content"><div class="page-head"><div><p class="eyebrow">${clientMode ? 'YOUR WORKSPACE' : 'STUDIO OVERVIEW'}</p><h1 id="page-title">${h(view.title)}</h1><p id="page-sub">${h(view.sub)}</p></div><div id="page-action" class="head-actions">${actionHtml}</div></div><div id="content"><div class="empty">Loading your workspace…</div></div></section></main></div>`;
}
const setHead = (title, sub) => { if (title) { $('#page-title').textContent = title; $('#crumb-title').textContent = title; document.title = `${title} · StudioDesk`; } if (sub !== undefined) $('#page-sub').textContent = sub; };
const setAction = html => { $('#page-action').innerHTML = html; };
const content = html => { $('#content').innerHTML = html; };

/* ---------- data helpers ---------- */
async function q(table, cols = '*', mod) {
  let r = supabase.from(table).select(cols);
  if (mod) r = mod(r);
  const { data, error } = await r;
  if (error) throw error;
  return data || [];
}
async function one(table, cols, id) {
  const { data, error } = await supabase.from(table).select(cols).eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}
const newest = r => r.order('created_at', { ascending: false });
// Tables added by features.sql: the rest of the app keeps working until that file has been run.
const safeQ = (...a) => q(...a).catch(() => []);
async function qAll(table, cols, mod) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    let r = supabase.from(table).select(cols); if (mod) r = mod(r);
    const { data, error } = await r.order('id').range(from, from + 999);
    if (error) throw error; out.push(...data); if (data.length < 1000) break;
  }
  return out;
}
const monthOf = d => String(d || '').slice(0, 7);
const isHttps = v => /^https:\/\/[^\s<>"']+$/i.test(v || '');
const must = ({ error }) => { if (error) throw error; };

/* ---------- ui helpers ---------- */
const statusClass = s => ['Completed', 'Paid', 'Approved', 'Accepted', 'Ready for Delivery'].includes(s) ? 'green' : ['Overdue', 'Cancelled', 'Declined', 'Void', 'Expired'].includes(s) ? 'red' : ['In Progress', 'Partially Paid', 'Client Review', 'Internal Review', 'Sent', 'Confirmed'].includes(s) ? 'blue' : ['On Hold', 'Pending', 'Awaiting Confirmation', 'Revision Requested'].includes(s) ? 'orange' : '';
const badge = s => `<span class="badge ${statusClass(s)}">${h(s)}</span>`;
const invStatus = i => (['Pending', 'Partially Paid'].includes(i.status) && i.due_date && i.due_date < today()) ? 'Overdue' : i.status;
const options = (list, selected) => list.map(o => `<option ${o === selected ? 'selected' : ''}>${h(o)}</option>`).join('');
const stat = (label, value, note, icon) => `<article class="stat-card"><div class="stat-top"><span>${label}</span><span class="stat-icon">${icon}</span></div><div class="stat-value">${value}</div><div class="stat-note">${note}</div></article>`;
const kv = (label, value) => `<div class="kv"><span>${label}</span><b>${value || '—'}</b></div>`;
const panel = (heading, sub, body, headExtra = '') => `<section class="panel"><div class="panel-head"><div><h2>${heading}</h2>${sub ? `<p>${sub}</p>` : ''}</div>${headExtra}</div>${body}</section>`;
const tableHTML = (headers, rowsHtml, empty) => `<div class="table-wrap"><table><thead><tr>${headers.map(x => `<th>${x}</th>`).join('')}</tr></thead><tbody>${rowsHtml || `<tr><td colspan="${headers.length}" class="empty">${empty}</td></tr>`}</tbody></table></div>`;
const back = (href, label) => `<a class="button" href="${href}">← ${label}</a>`;
const invNo = i => i.invoice_number ? `INV-${String(i.invoice_number).padStart(4, '0')}` : 'Draft';
const qNo = x => `QUO-${String(x.quote_number).padStart(4, '0')}`;

function dataTable({ headers, rows, row, status, search, placeholder = 'Search…', empty = 'Nothing here yet. Use the button above to create your first record.' }) {
  const statuses = status ? [...new Set(rows.map(status).filter(Boolean))] : [];
  const body = rows.map(r => row(r).replace('<tr', `<tr data-search="${h((search ? search(r) : '').toLowerCase())}" data-status="${h(status ? status(r) || '' : '')}"`)).join('');
  return `<div class="panel"><div class="toolbar"><input class="search" id="table-search" placeholder="${placeholder}">${statuses.length ? `<select id="table-filter"><option value="">All statuses</option>${statuses.map(s => `<option>${h(s)}</option>`).join('')}</select>` : ''}</div><div class="table-wrap"><table><thead><tr>${headers.map(x => `<th>${x}</th>`).join('')}</tr></thead><tbody id="table-body">${body || `<tr><td colspan="${headers.length}" class="empty">${empty}</td></tr>`}<tr id="no-match" class="hidden"><td colspan="${headers.length}" class="empty">No matching records.</td></tr></tbody></table></div></div>`;
}
function applyFilter() {
  const term = ($('#table-search')?.value || '').trim().toLowerCase(), st = $('#table-filter')?.value || '';
  let shown = 0;
  document.querySelectorAll('#table-body tr[data-search]').forEach(tr => {
    const ok = tr.dataset.search.includes(term) && (!st || tr.dataset.status === st);
    tr.classList.toggle('hidden', !ok); if (ok) shown++;
  });
  $('#no-match')?.classList.toggle('hidden', shown > 0 || !document.querySelector('#table-body tr[data-search]'));
}

/* ---------- dashboard & reports ---------- */
function revenueBars(payments) {
  const now = new Date();
  const bars = Array.from({ length: 6 }, (_, k) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - k), 1);
    const key = monthKey(d);
    return { label: d.toLocaleDateString('en', { month: 'short' }), amount: sum(payments.filter(p => p.verified && p.paid_at && monthKey(p.paid_at) === key), p => p.amount) };
  });
  const max = Math.max(1, ...bars.map(b => b.amount));
  return `<div class="chart">${bars.map(b => `<div class="bar-col"><div class="bar" title="${money(b.amount)}" style="height:${Math.max(3, b.amount / max * 85)}%"></div><span class="bar-label">${b.label}</span></div>`).join('')}</div><div class="sub-cell">${money(sum(bars, b => b.amount))} received during this period</div>`;
}
function balances(invoices, payments) {
  const paid = {};
  payments.filter(p => p.verified).forEach(p => { paid[p.invoice_id] = (paid[p.invoice_id] || 0) + Number(p.amount); });
  return { paid, balance: i => Math.max(0, Number(i.total) - (paid[i.id] || 0)) };
}
async function dashboard() {
  const [clients, projects, invoices, payments] = await Promise.all([
    clientMode ? Promise.resolve([]) : q('clients', 'id,archived_at'),
    q('projects', 'id,title,status,deadline,progress,created_at,category'),
    q('invoices', 'id,total,status,due_date'),
    q('payments', 'invoice_id,amount,verified,paid_at')
  ]);
  const open = projects.filter(p => !['Completed', 'Cancelled'].includes(p.status));
  const live = invoices.filter(i => i.status !== 'Void');
  const { balance } = balances(live, payments);
  const outstanding = sum(live.filter(i => i.status !== 'Paid'), balance);
  const month = monthKey(new Date());
  const [exps, slips, evs] = clientMode ? [[], [], []] : await Promise.all([safeQ('expenses', 'amount,spent_on'), safeQ('payment_slips', 'id', r => r.eq('status', 'Pending')), safeQ('events', 'id', r => r.gte('starts_on', today()).lte('starts_on', addDays(7)))]);
  const spent = sum(exps.filter(e => monthOf(e.spent_on) === month), e => e.amount);
  const income = sum(payments.filter(p => p.verified && p.paid_at && monthKey(p.paid_at) === month), p => p.amount);
  const stats = clientMode
    ? stat('Active projects', open.length, 'Currently underway', '▣') + stat('Completed projects', projects.filter(x => x.status === 'Completed').length, 'Ready in your history', '✓') + stat('Open invoices', live.filter(i => i.status !== 'Paid').length, 'Available to review', '▧') + stat('Outstanding balance', money(outstanding), 'Across your invoices', '＄')
    : stat('Total clients', clients.filter(x => !x.archived_at).length, 'In your client database', '♙') + stat('Active projects', open.length, 'Across your studio', '▣') + stat('Completed projects', projects.filter(x => x.status === 'Completed').length, 'In project history', '✓') + stat('Monthly income', money(income), 'Verified payments this month', '＄') + stat('Total invoiced', money(sum(live, i => i.total)), 'All non-void invoices', '▤') + stat('Outstanding', money(outstanding), 'Unpaid invoice balances', '◷') + stat('Pending projects', projects.filter(x => ['New Enquiry', 'Quotation Sent', 'Awaiting Confirmation'].includes(x.status)).length, 'Awaiting next step', '◌') + stat('Upcoming deadlines', open.filter(p => p.deadline && p.deadline >= today()).length, 'Open projects', '⌁') + stat('Monthly expenses', money(spent), 'Costs logged this month', '−') + stat('Monthly profit', money(income - spent), 'Income minus expenses', '＄') + stat('Slips to review', slips.length, 'Transfer slips awaiting you', '▧') + stat('Events this week', evs.length, 'Shoots and meetings', '▦');
  const link = id => `${clientMode ? 'client-' : ''}project-details.html?id=${id}`;
  const recent = (clientMode ? projects.filter(p => p.status !== 'Cancelled') : open).slice(0, 6).map(p => `<tr><td><a class="name-cell" href="${link(p.id)}">${h(p.title)}</a><div class="sub-cell">${h(p.category || 'Other')}</div></td><td>${badge(p.status)}</td><td>${date(p.deadline)}</td><td><div class="progress"><span style="width:${p.progress || 0}%"></span></div><div class="sub-cell">${p.progress || 0}%</div></td></tr>`).join('');
  const activities = projects.slice().sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 5).map(p => `<div class="activity"><span class="activity-dot"></span><span><b>${h(p.title)}</b> · ${h(p.status)}<time>${date(p.created_at)}</time></span></div>`).join('') || '<div class="empty">Your updates will appear here.</div>';
  content(`<div class="stats-grid">${stats}</div><div class="grid-two">${panel(clientMode ? 'Your projects' : 'Recent projects', 'Current progress and upcoming deadlines', tableHTML(['PROJECT', 'STATUS', 'DEADLINE', 'PROGRESS'], recent, 'No projects yet.'), `<a href="${clientMode ? 'client-projects.html' : 'projects.html'}">View all →</a>`)}${panel(clientMode ? 'Recent updates' : 'Revenue overview', clientMode ? 'Latest project activity' : 'Verified LKR payments · last six months', clientMode ? `<div class="activity-list">${activities}</div>` : revenueBars(payments))}</div>`);
}
function profitPanels(payments, expenses) {
  const now = new Date();
  const months = Array.from({ length: 6 }, (_, k) => { const d = new Date(now.getFullYear(), now.getMonth() - k, 1); return { key: monthKey(d), label: d.toLocaleDateString('en', { month: 'short', year: 'numeric' }) }; });
  const rows = months.map(m => { const inc = sum(payments.filter(p => p.verified && p.paid_at && monthKey(p.paid_at) === m.key), p => p.amount), exp = sum(expenses.filter(e => monthOf(e.spent_on) === m.key), e => e.amount); return { ...m, inc, exp, profit: inc - exp }; });
  const tot = { inc: sum(rows, r => r.inc), exp: sum(rows, r => r.exp) };
  const colour = n => `<b style="color:${n < 0 ? 'var(--red)' : 'var(--green)'}">${money(n)}</b>`;
  const body = rows.map(r => `<tr><td>${r.label}</td><td>${money(r.inc)}</td><td>${money(r.exp)}</td><td>${colour(r.profit)}</td></tr>`).join('') + `<tr><td><b>Total</b></td><td><b>${money(tot.inc)}</b></td><td><b>${money(tot.exp)}</b></td><td>${colour(tot.inc - tot.exp)}</td></tr>`;
  const keys = new Set(months.map(m => m.key)), byCat = {};
  expenses.filter(e => keys.has(monthOf(e.spent_on))).forEach(e => { byCat[e.category] = (byCat[e.category] || 0) + Number(e.amount); });
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([c, v]) => `<tr><td>${h(c)}</td><td>${money(v)}</td><td>${tot.exp ? Math.round(v / tot.exp * 100) : 0}%</td></tr>`).join('');
  return `<div class="grid-two">${panel('Profit & loss', 'Cash basis: verified payments received minus expenses, last six months', tableHTML(['MONTH', 'INCOME', 'EXPENSES', 'PROFIT'], body, ''))}${panel('Where the money goes', 'Expenses by category, same period', tableHTML(['CATEGORY', 'SPENT', 'SHARE'], cats, 'No expenses recorded yet.'))}</div>`;
}
async function reports() {
  setAction(`<input class="field" type="month" id="report-month" value="${today().slice(0, 7)}" max="${today().slice(0, 7)}" aria-label="Report month" style="width:auto"><button class="button primary" data-action="pdf-monthly">⬇ Monthly summary PDF</button>`);
  const [projects, invoices, payments, expenses] = await Promise.all([q('projects', 'id,status'), q('invoices', 'id,status,total,due_date,clients(name)'), q('payments', 'invoice_id,amount,verified,paid_at'), safeQ('expenses', 'spent_on,amount,category')]);
  const count = (arr, f) => arr.reduce((m, x) => { const k = f(x); m[k] = (m[k] || 0) + 1; return m; }, {});
  const rowsOf = (obj, cls) => Object.entries(obj).map(([k, v]) => `<tr><td>${cls ? badge(k) : h(k)}</td><td>${v}</td></tr>`).join('');
  const live = invoices.filter(i => i.status !== 'Void');
  const byClient = {};
  live.forEach(i => { const n = i.clients?.name || 'Unknown'; byClient[n] = (byClient[n] || 0) + Number(i.total); });
  const top = Object.entries(byClient).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n, v]) => `<tr><td>${h(n)}</td><td>${money(v)}</td></tr>`).join('');
  content(`${profitPanels(payments, expenses)}<div class="grid-two">${panel('Revenue overview', 'Verified LKR payments · last six months', revenueBars(payments))}${panel('Top clients', 'By invoiced total', tableHTML(['CLIENT', 'INVOICED'], top, 'No invoices yet.'))}</div><div class="grid-two">${panel('Projects by status', '', tableHTML(['STATUS', 'COUNT'], rowsOf(count(projects, p => p.status), true), 'No projects yet.'))}${panel('Invoices by status', '', tableHTML(['STATUS', 'COUNT'], rowsOf(count(invoices, invStatus), true), 'No invoices yet.'))}</div>`);
}

/* ---------- lists ---------- */
async function clientsList() {
  const [rows, projects] = await Promise.all([q('clients', '*', newest), q('projects', 'id,client_id')]);
  const n = {}; projects.forEach(p => { n[p.client_id] = (n[p.client_id] || 0) + 1; });
  content(dataTable({ headers: ['CLIENT', 'EMAIL', 'PHONE', 'PROJECTS', 'STATUS', 'REGISTERED'], rows, placeholder: 'Search clients…', status: r => r.archived_at ? 'Archived' : 'Active', search: r => [r.name, r.business_name, r.email, r.phone].join(' '), row: r => `<tr><td><a class="name-cell" href="client-details.html?id=${r.id}">${h(r.name)}</a><div class="sub-cell">${h(r.business_name)}</div></td><td>${h(r.email)}</td><td>${h(r.phone || '—')}</td><td>${n[r.id] || 0}</td><td>${r.archived_at ? '<span class="badge">Archived</span>' : '<span class="badge green">Active</span>'}</td><td>${date(r.created_at)}</td></tr>` }));
}
async function projectsList() {
  const rows = await q('projects', '*,clients(name)', newest);
  const base = clientMode ? 'client-project-details.html' : 'project-details.html';
  content(dataTable({ headers: ['PROJECT', 'CLIENT', 'CATEGORY', 'STATUS', 'DEADLINE', 'PROGRESS'], rows, placeholder: 'Search projects…', status: r => r.status, search: r => [r.title, r.category, r.clients?.name, 'P-' + r.project_code].join(' '), row: r => `<tr><td><a class="name-cell" href="${base}?id=${r.id}">${h(r.title)}</a><div class="sub-cell">P-${r.project_code}</div></td><td>${h(r.clients?.name)}</td><td>${h(r.category)}</td><td>${badge(r.status)}</td><td>${date(r.deadline)}</td><td><div class="progress"><span style="width:${r.progress}%"></span></div><div class="sub-cell">${r.progress}%</div></td></tr>` }));
}
async function tasksList() {
  const rows = await q('project_tasks', '*,projects(title)', newest);
  content(dataTable({ headers: ['TASK', 'PROJECT', 'DUE DATE', 'STATUS'], rows, placeholder: 'Search tasks…', status: r => r.completed ? 'Completed' : 'Open', search: r => [r.title, r.projects?.title].join(' '), row: r => `<tr><td class="name-cell">${h(r.title)}</td><td><a href="project-details.html?id=${r.project_id}">${h(r.projects?.title)}</a></td><td>${date(r.due_date)}</td><td>${taskButton(r)}</td></tr>` }));
}
const taskButton = r => clientMode ? `<span class="badge ${r.completed ? 'green' : 'orange'}">${r.completed ? 'Completed' : 'Open'}</span>` : `<button class="badge ${r.completed ? 'green' : 'orange'}" data-action="toggle-task" data-id="${r.id}" data-done="${r.completed}" title="Click to toggle">${r.completed ? 'Completed' : 'Open'}</button>`;
async function quotationsList() {
  const rows = await q('quotations', '*,clients(name)', newest);
  const base = clientMode ? 'client-quotation-details.html' : 'quotation-details.html';
  const eff = r => (['Sent'].includes(r.status) && r.valid_until && r.valid_until < today()) ? 'Expired' : r.status;
  content(dataTable({ headers: ['QUOTE', 'CLIENT', 'DATE', 'VALID UNTIL', 'TOTAL', 'STATUS'], rows, placeholder: 'Search quotations…', status: eff, search: r => [qNo(r), r.clients?.name].join(' '), row: r => `<tr><td><a class="name-cell" href="${base}?id=${r.id}">${qNo(r)}</a></td><td>${h(r.clients?.name)}</td><td>${date(r.created_at)}</td><td>${date(r.valid_until)}</td><td>${money(r.total)}</td><td>${badge(eff(r))}</td></tr>` }));
}
async function invoicesList() {
  const [rows, payments] = await Promise.all([q('invoices', '*,clients(name)', newest), q('payments', 'invoice_id,amount,verified')]);
  const { balance } = balances(rows, payments);
  const base = clientMode ? 'client-invoice-details.html' : 'invoice-details.html';
  content(dataTable({ headers: ['INVOICE', 'CLIENT', 'DATE', 'DUE', 'TOTAL', 'BALANCE', 'STATUS'], rows, placeholder: 'Search invoices…', status: invStatus, search: r => [invNo(r), r.clients?.name].join(' '), row: r => `<tr><td><a class="name-cell" href="${base}?id=${r.id}">${invNo(r)}</a></td><td>${h(r.clients?.name)}</td><td>${date(r.issue_date)}</td><td>${date(r.due_date)}</td><td>${money(r.total)}</td><td>${r.status === 'Void' ? '—' : money(balance(r))}</td><td>${badge(invStatus(r))}</td></tr>` }));
}
async function paymentsList() {
  const [rows, slips] = await Promise.all([q('payments', '*,invoices(invoice_number,clients(name))', r => r.order('paid_at', { ascending: false })), safeQ('payment_slips', '*,invoices(invoice_number,clients(name))', r => r.eq('status', 'Pending').order('created_at'))]);
  const slipPanel = slips.length ? panel('Transfer slips to review', 'Uploaded by clients. Confirming records a verified payment and updates the invoice.', tableHTML(['UPLOADED', 'CLIENT', 'INVOICE', 'AMOUNT', 'REFERENCE', ''], slips.map(sl => `<tr><td>${date(sl.created_at)}</td><td>${h(sl.invoices?.clients?.name)}</td><td><a href="invoice-details.html?id=${sl.invoice_id}">${invNo(sl.invoices || {})}</a></td><td>${money(sl.amount)}</td><td>${h(sl.reference || '—')}</td><td class="row-actions">${slipButtons(sl)}</td></tr>`).join(''), '')) : '';
  content(slipPanel + dataTable({ headers: ['RECEIPT', 'INVOICE', 'CLIENT', 'DATE', 'METHOD', 'AMOUNT', 'STATUS'], rows, placeholder: 'Search payments…', status: r => r.verified ? 'Verified' : 'Pending', search: r => [r.invoices?.clients?.name, r.reference, r.method, invNo(r.invoices || {})].join(' '), row: r => `<tr><td class="name-cell">${h(r.reference || r.id.slice(0, 8))}</td><td>${r.invoices ? `<a href="invoice-details.html?id=${r.invoice_id}">${invNo(r.invoices)}</a>` : '—'}</td><td>${h(r.invoices?.clients?.name)}</td><td>${date(r.paid_at)}</td><td>${h(r.method)}</td><td>${money(r.amount)}</td><td><span class="badge ${r.verified ? 'green' : 'orange'}">${r.verified ? 'Verified' : 'Pending'}</span></td></tr>` }));
}
const slipButtons = sl => `<button class="button" data-action="view-slip" data-path="${h(sl.storage_path)}">View slip</button>` + (clientMode || sl.status !== 'Pending' ? '' : `<button class="button primary" data-action="confirm-slip" data-id="${sl.id}" data-amount="${sl.amount}">Confirm</button><button class="button danger" data-action="reject-slip" data-id="${sl.id}">Reject</button>`);
const REVIEWABLE = ['Previews', 'Edited Videos', 'Final Deliverables', 'Design Files', 'Original Photos'];
function fileRows(rows, showProject = true, opts = {}) {
  return rows.map(r => {
    const last = opts.latest?.[r.id];
    const verdict = last ? ` <span class="badge ${last.decision === 'Approved' ? 'green' : 'orange'}" title="${h(last.comment || '')}">${last.decision}</span>` : '';
    const review = opts.review && REVIEWABLE.includes(r.category) ? `<button class="button primary" data-action="review" data-decision="Approved" data-file="${r.id}">Approve</button><button class="button" data-action="review" data-decision="Changes requested" data-file="${r.id}">Request changes</button>` : '';
    return `<tr><td class="name-cell">${h(r.name)}${verdict}</td>${showProject ? `<td>${h(r.projects?.title)}</td>` : ''}<td>${h(r.category)}</td><td>${r.visible_to_client ? 'Client' : 'Admin only'}</td><td>${date(r.created_at)}</td><td class="row-actions">${review}<button class="button" data-action="download" data-path="${h(r.storage_path)}" data-name="${h(r.name)}">Download</button>${clientMode ? '' : `<button class="button" data-action="toggle-visibility" data-id="${r.id}" data-visible="${r.visible_to_client}">${r.visible_to_client ? 'Hide' : 'Share'}</button><button class="button danger" data-action="delete-file" data-id="${r.id}" data-path="${h(r.storage_path)}">Delete</button>`}</td></tr>`;
  }).join('');
}
async function filesList() {
  const rows = await q('project_files', '*,projects(title)', newest);
  content(panel('Project files', 'Private files use expiring secure download links.', tableHTML(['FILE', 'PROJECT', 'CATEGORY', 'VISIBILITY', 'ADDED', ''], fileRows(rows), 'No project files yet.')));
}
async function messagesList() {
  const rows = await q('messages', '*,projects(title),profiles!sender_id(full_name)', newest);
  content(panel('Conversations', 'Newest first', `<div class="activity-list">${rows.map(m => `<div class="activity"><span class="activity-dot"></span><span><b>${h(m.projects?.title || 'Project')} · ${m.sender_id === state.user.id ? 'You' : h(m.profiles?.full_name || (clientMode ? 'Studio team' : 'Client'))}</b><div class="msg-body">${h(m.body)}</div><time>${new Date(m.created_at).toLocaleString()}</time></span></div>`).join('') || '<div class="empty">No messages yet.</div>'}</div>`));
}

/* ---------- settings & profile ---------- */
async function settings() {
  const { data: b, error } = await supabase.from('business_settings').select('*').eq('id', true).maybeSingle();
  if (error) throw error;
  if (!b) { content('<div class="panel empty">No settings row found. Run <code>insert into public.business_settings(id) values(true);</code> in the SQL editor.</div>'); return; }
  const f = (name, label, type = 'text', extra = '') => `<label>${label}<input class="field" name="${name}" type="${type}" value="${h(b[name])}" ${extra}></label>`;
  const currencies = ['LKR', 'USD', 'EUR', 'GBP', 'AUD', 'INR', 'AED', 'SGD'];
  const mfa = await mfaPanel(b);
  content(panel('Business settings', 'These details appear on every quotation and invoice PDF.', `<div id="settings-form" class="form-grid">${f('business_name', 'Business name', 'text', 'required')}<label>Currency<select class="field" name="currency">${options(currencies.includes(b.currency) ? currencies : [b.currency, ...currencies], b.currency)}</select></label>${f('tax_rate', 'Default tax rate (%)', 'number', 'step=".01" min="0"')}<label>Default payment terms<input class="field" name="payment_terms" list="terms-list" value="${h(b.payment_terms)}"></label>${termsDatalist()}${f('email', 'Business email', 'email')}${f('phone', 'Business phone', 'tel')}${f('payment_link', 'Online payment link (optional, https://…)', 'url', 'placeholder="https://pay.example.com/your-studio" maxlength="500"')}<label class="wide">Address<textarea class="field" name="address">${h(b.address)}</textarea></label><label class="wide">Bank / payment details (printed on invoices)<textarea class="field" name="bank_details" placeholder="Bank, account name, account number, branch…">${h(b.bank_details)}</textarea></label><div class="wide"><button class="button primary" data-action="save-settings">Save settings</button></div></div>`) + mfa);
}
async function mfaPanel(b) {
  let verified = null, aal = null;
  try { const [{ data: f }, { data: a }] = await Promise.all([supabase.auth.mfa.listFactors(), supabase.auth.mfa.getAuthenticatorAssuranceLevel()]); verified = f?.totp?.[0] || null; aal = a?.currentLevel; } catch (_) { /* MFA not available */ }
  const on = !!b.enforce_admin_mfa;
  return panel('Admin security', 'Two-step verification for administrator accounts', `<div class="kvs kv-wide">${kv('Your account', verified ? '<span class="badge green">Authenticator on</span>' : '<span class="badge orange">Not set up</span>')}${kv('Required for all admins', on ? '<span class="badge green">On</span>' : '<span class="badge">Off</span>')}</div><div class="head-actions">${verified ? `<button class="button danger" data-action="remove-mfa" data-factor="${verified.id}">Remove my authenticator</button>` : '<a class="button primary" href="../mfa.html">Set up authenticator</a>'}${on ? '<button class="button" data-action="mfa-enforce" data-on="false">Stop requiring MFA</button>' : `<button class="button ${verified ? 'primary' : ''}" data-action="mfa-enforce" data-on="true" ${verified && aal === 'aal2' ? '' : 'disabled'}>Require MFA for all admins</button>`}</div><p class="sub-cell">Admins who set up an authenticator are asked for a code at every sign-in. “Require” also makes the database refuse admin actions from a session that skipped the code, so enrol every admin first. If you ever lock yourself out, run <code>update public.business_settings set enforce_admin_mfa=false;</code> in the Supabase SQL editor.</p>`);
}
async function clientProfile() {
  const { data: link } = await supabase.from('client_users').select('client_id').eq('user_id', state.user.id).maybeSingle();
  const c = link ? await one('clients', '*', link.client_id) : null;
  content(`<div class="grid-two">${panel('Your account', 'Visible only to you', `<div class="form-grid"><label class="wide">Full name<input class="field" id="profile-name" value="${h(state.profile.full_name)}"></label><label class="wide">Email<input class="field" value="${h(state.user.email)}" disabled></label><div class="wide"><button class="button primary" data-action="save-profile">Save</button></div></div>`)}${panel('Studio record', 'Details held by your studio', c ? `<div class="kvs">${kv('Name', h(c.name))}${kv('Business', h(c.business_name))}${kv('Email', h(c.email))}${kv('Phone', h(c.phone))}${kv('Address', h(c.address))}</div>` : '<div class="empty">Your account is not linked to a client record yet. Please ask your studio to link it.</div>')}</div>`);
}

/* ---------- detail pages ---------- */
async function clientDetails() {
  const id = params.get('id');
  const c = id && await one('clients', '*', id);
  if (!c) { content(`<div class="panel empty">Client not found. ${back('clients.html', 'Back to clients')}</div>`); return; }
  setHead(c.name, c.business_name || 'Client details');
  setAction(`${back('clients.html', 'Clients')}<button class="button" data-action="archive-client" data-id="${c.id}" data-archived="${!!c.archived_at}">${c.archived_at ? 'Restore client' : 'Archive client'}</button><button class="button" data-action="pdf-client" data-id="${c.id}">⬇ Client report</button><button class="button" data-create="quote" data-client="${c.id}">＋ Quotation</button><button class="button" data-create="invoice" data-client="${c.id}">＋ Invoice</button><button class="button primary" data-create="project" data-client="${c.id}">＋ New project</button>`);
  const [projects, invoices, payments, links] = await Promise.all([q('projects', '*', r => r.eq('client_id', id).order('created_at', { ascending: false })), q('invoices', '*', r => r.eq('client_id', id).order('created_at', { ascending: false })), q('payments', 'invoice_id,amount,verified'), q('client_users', 'user_id,profiles(full_name,email)', r => r.eq('client_id', id))]);
  const { balance } = balances(invoices, payments);
  content(`<div class="grid-two">${panel('Contact', c.archived_at ? 'Archived' : 'Active client', `<div class="kvs">${kv('Email', h(c.email))}${kv('Phone', h(c.phone))}${kv('Business', h(c.business_name))}${kv('Address', h(c.address))}${kv('Registered', date(c.created_at))}</div>`)}${panel('Portal access', 'Let this client sign in to the client portal', `<div class="activity-list">${links.map(l => `<div class="activity"><span class="activity-dot"></span><span><b>${h(l.profiles?.full_name || l.profiles?.email)}</b><div class="sub-cell">${h(l.profiles?.email)}</div></span><button class="button danger small-btn" data-action="unlink" data-user="${l.user_id}" data-client="${id}">Remove</button></div>`).join('') || '<div class="empty">No portal account linked.</div>'}</div>${c.archived_at ? '' : `<div class="link-row"><button class="button primary" data-action="invite-client" data-client="${id}">✉ Send portal invite to ${h(c.email)}</button></div>`}<div class="link-row"><input class="field" id="link-email" type="email" placeholder="Registered user's email"><button class="button primary" data-action="link-account" data-client="${id}">Link account</button></div><p class="sub-cell">Use “Send portal invite”, or link an account you already created.</p>`)}</div>${panel('Projects', '', tableHTML(['PROJECT', 'STATUS', 'DEADLINE', 'PROGRESS'], projects.map(p => `<tr><td><a class="name-cell" href="project-details.html?id=${p.id}">${h(p.title)}</a></td><td>${badge(p.status)}</td><td>${date(p.deadline)}</td><td>${p.progress}%</td></tr>`).join(''), 'No projects for this client yet.'))}${panel('Invoices', '', tableHTML(['INVOICE', 'DUE', 'TOTAL', 'BALANCE', 'STATUS'], invoices.map(i => `<tr><td><a class="name-cell" href="invoice-details.html?id=${i.id}">${invNo(i)}</a></td><td>${date(i.due_date)}</td><td>${money(i.total)}</td><td>${i.status === 'Void' ? '—' : money(balance(i))}</td><td>${badge(invStatus(i))}</td></tr>`).join(''), 'No invoices for this client yet.'))}`);
}
async function projectDetails() {
  const id = params.get('id');
  const p = id && await one('projects', '*,clients(name)', id);
  const listPage = clientMode ? 'client-projects.html' : 'projects.html';
  if (!p) { content(`<div class="panel empty">Project not found. ${back(listPage, 'Back to projects')}</div>`); return; }
  setHead(p.title, `P-${p.project_code} · ${p.clients?.name || ''}`);
  setAction(back(listPage, 'Projects') + (clientMode ? `<button class="button primary" data-create="message" data-project="${p.id}">＋ New message</button>` : `<button class="button" data-create="quote" data-client="${p.client_id}" data-project="${p.id}">＋ Quotation</button><button class="button" data-create="invoice" data-client="${p.client_id}" data-project="${p.id}">＋ Invoice</button><button class="button" data-create="task" data-project="${p.id}">＋ Task</button><button class="button" data-create="upload" data-project="${p.id}">＋ Files</button><button class="button primary" data-create="message" data-project="${p.id}">＋ Message</button>`));
  const [tasks, files, msgs, reviews] = await Promise.all([q('project_tasks', '*', r => r.eq('project_id', id).order('created_at')), q('project_files', '*', r => r.eq('project_id', id).order('created_at', { ascending: false })), q('messages', '*,profiles!sender_id(full_name)', r => r.eq('project_id', id).order('created_at', { ascending: false })), safeQ('deliverable_reviews', '*', r => r.eq('project_id', id).order('created_at', { ascending: false }))]);
  const latest = {}; reviews.slice().reverse().forEach(rv => { if (rv.file_id) latest[rv.file_id] = rv; });
  const included = Number(p.included_revisions ?? 2), usedRounds = reviews.filter(rv => rv.decision === 'Changes requested').length, extra = Math.max(0, usedRounds - included);
  const revPanel = panel('Revisions & approvals', clientMode ? 'Your feedback on delivered files' : 'Client decisions on shared files', `<div class="kvs kv-wide">${kv('Rounds used', `${usedRounds} of ${included} included`)}${extra ? kv('Extra rounds', `<span class="badge red">${extra} beyond what was quoted</span>`) : ''}</div>${clientMode ? '' : `<div class="link-row"><label>Included revision rounds<span class="inline-row"><input class="field" id="included-input" type="number" min="0" max="50" value="${included}"><button class="button" data-action="set-included" data-id="${p.id}">Update</button></span></label>${extra ? `<button class="button primary" data-create="invoice" data-client="${p.client_id}" data-project="${p.id}" data-extra="${extra}">Invoice ${extra} extra round${extra > 1 ? 's' : ''}</button>` : ''}</div>`}${tableHTML(['DATE', 'FILE', 'DECISION', 'ROUND', 'COMMENT'], reviews.map(rv => `<tr><td>${date(rv.created_at)}</td><td>${h(rv.file_name || '—')}</td><td><span class="badge ${rv.decision === 'Approved' ? 'green' : 'orange'}">${rv.decision}</span></td><td>${rv.decision === 'Approved' ? '—' : rv.round}</td><td class="wrap">${h(rv.comment || '—')}</td></tr>`).join(''), clientMode ? 'Use Approve or Request changes next to a shared file below.' : 'No approvals or change requests yet.')}`);
  const controls = clientMode ? '' : `<div class="form-grid control-row"><label>Status<select class="field" data-change="project-status" data-id="${p.id}">${options(PROJECT_STATUSES, p.status)}</select></label><label>Progress (%)<span class="inline-row"><input class="field" id="progress-input" type="number" min="0" max="100" value="${p.progress}"><button class="button" data-action="set-progress" data-id="${p.id}">Update</button></span></label></div>`;
  content(`${panel('Overview', '', `<div class="kvs kv-wide">${kv('Status', badge(p.status))}${kv('Category', h(p.category))}${kv('Priority', h(p.priority))}${kv('Deadline', date(p.deadline))}${clientMode ? '' : kv('Agreed price', money(p.agreed_price))}${kv('Progress', `${p.progress}%`)}</div><div class="progress big"><span style="width:${p.progress}%"></span></div>${p.description ? `<p class="desc">${h(p.description)}</p>` : ''}${controls}`)}<div class="grid-two">${panel('Tasks', `${tasks.filter(t => t.completed).length} of ${tasks.length} complete`, tableHTML(['TASK', 'DUE', 'STATUS'], tasks.map(t => `<tr><td class="name-cell">${h(t.title)}</td><td>${date(t.due_date)}</td><td>${taskButton(t)}</td></tr>`).join(''), 'No tasks yet.'), clientMode ? '' : `<button class="button" data-action="add-checklist" data-id="${p.id}" data-category="${h(p.category)}">＋ Standard checklist</button>`)}${panel('Messages', '', `<div class="activity-list">${msgs.map(m => `<div class="activity"><span class="activity-dot"></span><span><b>${m.sender_id === state.user.id ? 'You' : h(m.profiles?.full_name || (clientMode ? 'Studio team' : 'Client'))}</b><div class="msg-body">${h(m.body)}</div><time>${new Date(m.created_at).toLocaleString()}</time></span></div>`).join('') || '<div class="empty">No messages yet.</div>'}</div>`)}</div>${panel('Files', '', tableHTML(['FILE', 'CATEGORY', 'VISIBILITY', 'ADDED', ''], fileRows(files, false, { review: clientMode, latest }), 'No files yet.'))}${revPanel}`);
}
async function invoiceDetails() {
  const id = params.get('id');
  const i = id && await one('invoices', '*,clients(name,email,address),projects(title)', id);
  const listPage = clientMode ? 'client-invoices.html' : 'invoices.html';
  if (!i) { content(`<div class="panel empty">Invoice not found. ${back(listPage, 'Back to invoices')}</div>`); return; }
  const [items, payments, biz, slips] = await Promise.all([q('invoice_items', '*', r => r.eq('invoice_id', id)), q('payments', '*', r => r.eq('invoice_id', id).order('paid_at')), supabase.from('business_settings').select('business_name,address,email,phone').eq('id', true).maybeSingle().then(r => r.data), safeQ('payment_slips', '*', r => r.eq('invoice_id', id).order('created_at', { ascending: false }))]);
  const paid = sum(payments.filter(p => p.verified), p => p.amount), bal = Math.max(0, Number(i.total) - paid);
  setHead(invNo(i), i.clients?.name || '');
  setAction(back(listPage, 'Invoices') + `<button class="button primary" data-action="pdf-invoice" data-id="${i.id}">⬇ Download PDF</button><button class="button" data-action="print">Print</button>` + (clientMode ? '' : (i.status === 'Void' ? `<button class="button" data-action="reopen-invoice" data-id="${i.id}" data-paid="${paid}" data-total="${i.total}">Reopen</button>` : `<button class="button danger" data-action="void-invoice" data-id="${i.id}">Void</button>${bal > 0 ? `<button class="button" data-create="payment" data-invoice="${i.id}">＋ Record payment</button>` : ''}`)));
  const owing = clientMode && bal > 0 && !['Paid', 'Void'].includes(i.status);
  const payHow = owing ? panel('How to pay', 'Pay by bank transfer, then upload your slip so we can confirm it quickly.', `${state.biz.bank_details ? `<p class="desc notes">${h(state.biz.bank_details)}</p>` : ''}<div class="head-actions">${isHttps(state.biz.payment_link) ? `<a class="button primary" href="${h(state.biz.payment_link)}" target="_blank" rel="noopener noreferrer">Pay online</a>` : ''}<button class="button ${isHttps(state.biz.payment_link) ? '' : 'primary'}" data-create="slip" data-invoice="${i.id}" data-amount="${bal}">⬆ Upload transfer slip</button></div>`) : '';
  const slipPanel = slips.length ? panel('Transfer slips', clientMode ? 'Slips you uploaded' : 'Uploaded by the client', tableHTML(['UPLOADED', 'AMOUNT', 'REFERENCE', 'STATUS', ''], slips.map(sl => `<tr><td>${date(sl.created_at)}</td><td>${money(sl.amount)}</td><td>${h(sl.reference || '—')}</td><td><span class="badge ${sl.status === 'Confirmed' ? 'green' : sl.status === 'Rejected' ? 'red' : 'orange'}" title="${h(sl.reviewer_note || '')}">${sl.status}</span>${sl.reviewer_note ? `<div class="sub-cell">${h(sl.reviewer_note)}</div>` : ''}</td><td class="row-actions">${slipButtons(sl)}</td></tr>`).join(''), '')) : '';
  content(`<div class="panel invoice-sheet"><div class="inv-head"><div><h2>${h(biz?.business_name || 'StudioDesk')}</h2><p class="sub-cell">${h(biz?.address)}<br>${h(biz?.email)} ${h(biz?.phone)}</p></div><div class="inv-meta"><b>${invNo(i)}</b><div>${badge(invStatus(i))}</div><div class="sub-cell">Issued ${date(i.issue_date)} · Due ${date(i.due_date)}</div></div></div><div class="kvs kv-wide">${kv('Bill to', h(i.clients?.name))}${kv('Email', h(i.clients?.email))}${kv('Project', h(i.projects?.title))}${kv('Terms', h(i.payment_terms))}</div>${tableHTML(['DESCRIPTION', 'QTY', 'UNIT PRICE', 'AMOUNT'], items.map(x => `<tr><td>${h(x.description)}</td><td>${x.quantity}</td><td>${money(x.unit_price)}</td><td>${money(x.quantity * x.unit_price)}</td></tr>`).join(''), 'No line items.')}<div class="totals"><div><span>Subtotal</span><b>${money(i.subtotal)}</b></div>${Number(i.discount) ? `<div><span>Discount</span><b>−${money(i.discount)}</b></div>` : ''}${Number(i.tax_rate) ? `<div><span>Tax (${i.tax_rate}%)</span><b>${money(i.total - (i.subtotal - i.discount))}</b></div>` : ''}<div><span>Total</span><b>${money(i.total)}</b></div><div><span>Paid</span><b>${money(paid)}</b></div><div class="grand"><span>Balance due</span><b>${i.status === 'Void' ? '—' : money(bal)}</b></div></div></div>${panel('Payments', '', tableHTML(['DATE', 'METHOD', 'REFERENCE', 'AMOUNT', 'STATUS'], payments.map(p => `<tr><td>${date(p.paid_at)}</td><td>${h(p.method)}</td><td>${h(p.reference || '—')}</td><td>${money(p.amount)}</td><td><span class="badge ${p.verified ? 'green' : 'orange'}">${p.verified ? 'Verified' : 'Pending'}</span></td></tr>`).join(''), 'No payments recorded yet.'))}${payHow}${slipPanel}`);
}

/* ---------- modal forms ---------- */
const field = (name, label, type = 'text', required = true, extra = '') => `<label>${label}<input class="field" name="${name}" type="${type}" ${required ? 'required' : ''} ${extra}></label>`;
const sel = (name, label, first, required = true, wide = false) => `<label ${wide ? 'class="wide"' : ''}>${label}<select class="field" name="${name}" ${required ? 'required' : ''}><option value="">${first}</option></select></label>`;
const textarea = (name, label, required = false) => `<label class="wide">${label}<textarea class="field" name="${name}" ${required ? 'required' : ''}></textarea></label>`;

const TASK_PRESETS = ['Client brief & references', 'Concept / moodboard', 'First draft', 'Client review', 'Revisions', 'Final delivery', 'Send invoice', 'Collect payment'];
const QUICK_ADMIN = ['Your draft is ready for review.', 'Files have been delivered. Please check the Files tab.', 'Your invoice has been issued.', 'Payment received, thank you!', 'Could you share the reference material for this project?'];
const QUICK_CLIENT = ['Approved. Please proceed.', 'I have some revisions, details below:', 'When can I expect the next update?', 'Could you resend the invoice?'];
const DUE_PRESETS = [['0', 'On receipt'], ['7', '7 days'], ['14', '14 days'], ['30', '30 days'], ['', 'Custom date']];
const VALID_PRESETS = [['7', '7 days'], ['14', '14 days'], ['30', '30 days'], ['60', '60 days'], ['', 'Custom date']];
const TERMS = ['Due on receipt', 'Due within 7 days', 'Due within 14 days', 'Due within 30 days', '50% advance, 50% on delivery'];
const termsDatalist = () => `<datalist id="terms-list">${TERMS.map(t => `<option value="${h(t)}">`).join('')}</datalist>`;
const addDays = n => { const d = new Date(); d.setDate(d.getDate() + Number(n)); return d.toLocaleDateString('en-CA'); };
const CHECKLISTS = {
  'Graphic Design': ['Client brief & references', 'Concepts / moodboard', 'First draft', 'Client review', 'Revisions', 'Final files delivered'],
  Photography: ['Shot list & location', 'Photo shoot', 'Culling & selects', 'Editing / retouching', 'Client review', 'Final delivery'],
  Videography: ['Treatment & shot list', 'Filming', 'Footage backup', 'Rough cut', 'Client review', 'Final delivery'],
  'Video Editing': ['Receive raw footage', 'Rough cut', 'Colour & sound', 'Client review', 'Revisions', 'Final export'],
  'Social Media Design': ['Content calendar', 'Design drafts', 'Client review', 'Revisions', 'Final assets delivered'],
  'Advertising Campaign': ['Campaign brief', 'Concept approval', 'Creative production', 'Client review', 'Launch', 'Performance report'],
  Other: ['Kick-off', 'First draft', 'Client review', 'Final delivery']
};
const FORMS = {
  client: { title: 'Add client', fields: () => field('name', 'Client name') + field('business_name', 'Business name', 'text', false) + field('email', 'Email', 'email') + field('phone', 'Contact number', 'tel', false) + textarea('address', 'Address') },
  project: { title: 'Create project', fields: () => field('title', 'Project title') + sel('client_id', 'Client', 'Choose a client') + `<label>Category<select class="field" name="category">${options(['Graphic Design', 'Photography', 'Videography', 'Video Editing', 'Social Media Design', 'Advertising Campaign', 'Other'])}</select></label><label>Deadline<input class="field" name="deadline" type="date"></label>` + field('agreed_price', 'Agreed price (LKR)', 'number', false, 'min="0" step=".01"') + `<label>Priority<select class="field" name="priority">${options(['Normal', 'Low', 'High', 'Urgent'])}</select></label>` + textarea('description', 'Description') },
  task: { title: 'New task', fields: () => sel('project_id', 'Project', 'Choose a project', true, true) + field('title', 'Task title (pick a preset or type your own)', 'text', true, 'list="task-presets"') + `<datalist id="task-presets">${TASK_PRESETS.map(t => `<option value="${h(t)}">`).join('')}</datalist>` + field('due_date', 'Due date', 'date', false) },
  payment: { title: 'Record payment', fields: () => sel('invoice_id', 'Invoice', 'Choose an invoice', true, true) + field('amount', 'Amount (LKR)', 'number', true, 'min="0.01" step=".01"') + field('paid_on', 'Payment date', 'date', true, `value="${today()}"`) + `<label>Method<select class="field" name="method">${options(['Bank transfer', 'Cash', 'Card', 'Other'])}</select></label>` + field('reference', 'Reference', 'text', false) },
  message: { title: 'Send a project message', fields: () => sel('project_id', 'Project', 'Choose a project', true, true) + `<label class="wide">Quick reply<select class="field" data-quick><option value="">Choose a preset or write your own below…</option>${(clientMode ? QUICK_CLIENT : QUICK_ADMIN).map(t => `<option>${h(t)}</option>`).join('')}</select></label>` + textarea('body', 'Message', true) },
  service: { title: 'Service', fields: () => field('name', 'Service name') + field('unit_price', 'Default price', 'number', true, 'min="0" step=".01"') + textarea('description', 'Description (shown in the picker)') + '<label class="check"><input type="checkbox" name="active" checked> Active</label>' },
  convert: { title: 'Convert to invoice', fields: () => `<label>Due in<select class="field" id="convert-due">${DUE_PRESETS.map(([v, l]) => `<option value="${v}" ${v === '14' ? 'selected' : ''}>${l}</option>`).join('')}</select></label>` + field('due_date', 'Due date', 'date', true, `value="${addDays(14)}"`) + `<label class="wide">Payment terms<input class="field" name="payment_terms" list="terms-list" value="${h(state.biz.payment_terms || '')}"></label>${termsDatalist()}` },
  upload: { title: 'Upload files', fields: () => sel('project_id', 'Project', 'Choose a project', true, true) + `<label>Category<select class="field" name="category">${options(FILE_CATEGORIES, 'Documents')}</select></label><label class="check"><input type="checkbox" name="visible_to_client"> Visible to client</label><label class="wide">Files<input class="field" name="files" type="file" multiple required></label>` }
};

const SUBMIT = {
  async client(d) { d.email = d.email.toLowerCase(); must(await supabase.from('clients').insert(clean(d))); },
  async project(d) { const row = clean(d); row.agreed_price = Number(d.agreed_price || 0); must(await supabase.from('projects').insert(row)); },
  async task(d) { must(await supabase.from('project_tasks').insert(clean(d))); },
  async payment(d, form) {
    const amount = Number(d.amount), balance = Number(form.querySelector('[name=invoice_id] option:checked')?.dataset.balance ?? Infinity);
    if (!(amount > 0)) throw new Error('Enter an amount greater than zero.');
    if (amount > balance + 0.005) throw new Error(`Amount exceeds the remaining balance (${money(balance)}).`);
    const { error } = await supabase.rpc('record_payment', { p_invoice: d.invoice_id, p_amount: amount, p_method: d.method, p_reference: d.reference || null, p_paid_on: d.paid_on });
    if (error) throw error;
  },
  async service(d, form, preset) {
    const row = { name: d.name.trim(), description: d.description?.trim() || null, unit_price: Number(d.unit_price || 0), active: d.active === 'on' };
    must(preset.id ? await supabase.from('services').update(row).eq('id', preset.id) : await supabase.from('services').insert(row));
  },
  async convert(d, form, preset) {
    const { data, error } = await supabase.rpc('convert_quotation', { p_quote: preset.quote, p_due: d.due_date, p_terms: d.payment_terms || null });
    if (error) throw error;
    location.href = `invoice-details.html?id=${data.id}`;
  },
  async message(d) { must(await supabase.from('messages').insert({ project_id: d.project_id, sender_id: state.user.id, body: d.body.trim() })); },
  async upload(d, form) {
    const files = [...form.querySelector('[name=files]').files];
    const { data: project, error } = await supabase.from('projects').select('id,client_id').eq('id', d.project_id).single();
    if (error) throw error;
    let failed = 0;
    for (const file of files) {
      const safe = file.name.replace(/[^\w.\-]+/g, '_');
      const path = `${project.client_id}/${project.id}/${crypto.randomUUID()}-${safe}`;
      const up = await supabase.storage.from('project-files').upload(path, file, { contentType: file.type || 'application/octet-stream' });
      if (up.error) { toast(`${file.name}: ${up.error.message}`); failed++; continue; }
      const ins = await supabase.from('project_files').insert({ project_id: project.id, uploaded_by: state.user.id, storage_path: path, name: file.name, category: d.category, visible_to_client: d.visible_to_client === 'on', mime_type: file.type || null, size_bytes: file.size });
      if (ins.error) { await supabase.storage.from('project-files').remove([path]); toast(ins.error.message); failed++; }
    }
    if (failed === files.length) throw new Error('No files were uploaded.');
  }
};

const cur = () => state.biz.currency || 'LKR';
FORMS.expense = { title: 'Expense', fields: () => field('spent_on', 'Date', 'date', true, `value="${today()}"`) + `<label>Category<select class="field" name="category">${options(EXPENSE_CATS, 'Other')}</select></label>` + field('amount', `Amount (${cur()})`, 'number', true, 'min="0.01" step=".01"') + field('vendor', 'Paid to', 'text', false, 'maxlength="120"') + sel('project_id', 'Project (optional)', 'Not tied to a project', false, true) + textarea('description', 'Notes') };
FORMS.event = { title: 'Calendar event', fields: () => field('title', 'Title', 'text', true, 'maxlength="140"') + `<label>Type<select class="field" name="kind">${options(EVENT_KINDS, 'Shoot')}</select></label>` + field('starts_on', 'Date', 'date', true, `value="${today()}"`) + field('start_time', 'Start time', 'time', false) + sel('project_id', 'Project (optional)', 'Not tied to a project', false) + field('location', 'Location', 'text', false, 'maxlength="200"') + textarea('notes', 'Notes') };
FORMS.slip = { title: 'Upload transfer slip', fields: () => field('amount', `Amount you transferred (${cur()})`, 'number', true, 'min="0.01" step=".01"') + field('paid_on', 'Transfer date', 'date', true, `value="${today()}" max="${today()}"`) + `<label class="wide">Reference (optional)<input class="field" name="reference" maxlength="120" placeholder="Bank reference or note"></label><label class="wide">Slip (photo, screenshot or PDF, up to 10 MB)<input class="field" name="file" type="file" accept="image/jpeg,image/png,image/webp,image/heic,application/pdf" required></label>` };
SUBMIT.expense = async (d, form, preset) => {
  const row = clean(d); row.amount = Number(d.amount);
  if (!(row.amount > 0)) throw new Error('Enter an amount above zero.');
  if (!preset.id) row.created_by = state.user.id;
  must(preset.id ? await supabase.from('expenses').update(row).eq('id', preset.id) : await supabase.from('expenses').insert(row));
};
SUBMIT.event = async (d, form, preset) => {
  const row = clean(d); if (!preset.id) row.created_by = state.user.id;
  must(preset.id ? await supabase.from('events').update(row).eq('id', preset.id) : await supabase.from('events').insert(row));
};
SUBMIT.slip = async (d, form, preset) => {
  const file = form.querySelector('[name=file]').files[0], amount = Number(d.amount);
  if (!file) throw new Error('Choose the slip to upload.');
  if (!(amount > 0)) throw new Error('Enter the amount you transferred.');
  if (file.size > 10 * 1024 * 1024) throw new Error('That file is larger than 10 MB.');
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'].includes(file.type)) throw new Error('Upload a JPG, PNG, WebP or PDF file.');
  const inv = await one('invoices', 'id,client_id', preset.invoice_id);
  if (!inv) throw new Error('Invoice not found.');
  const path = `${inv.client_id}/${inv.id}/${crypto.randomUUID()}-${file.name.replace(/[^\w.\-]+/g, '_')}`;
  const up = await supabase.storage.from('payment-slips').upload(path, file, { contentType: file.type });
  if (up.error) throw up.error;
  const { error } = await supabase.rpc('submit_payment_slip', { p_invoice: inv.id, p_path: path, p_name: file.name, p_amount: amount, p_reference: d.reference || null, p_paid_on: d.paid_on || null });
  if (error) { await supabase.storage.from('payment-slips').remove([path]); throw error; }
};

async function populateSelects(root, preset) {
  const fill = (name, items, labelOf, dataOf) => {
    const s = root.querySelector(`[name="${name}"]`); if (!s) return;
    items.forEach(it => { const o = document.createElement('option'); o.value = it.id; o.textContent = labelOf(it); if (dataOf) Object.assign(o.dataset, dataOf(it)); s.append(o); });
    if (preset[name]) s.value = preset[name];
  };
  if (root.querySelector('[name=client_id]')) fill('client_id', await q('clients', 'id,name', r => r.is('archived_at', null).order('name')), c => c.name);
  if (root.querySelector('[name=project_id]')) fill('project_id', await q('projects', 'id,title', r => r.order('title')), p => p.title);
  if (root.querySelector('[name=invoice_id]')) {
    const [inv, pay] = await Promise.all([q('invoices', 'id,invoice_number,total,status,clients(name)', r => r.not('status', 'in', '("Void","Paid")').order('created_at', { ascending: false })), q('payments', 'invoice_id,amount,verified')]);
    const { balance } = balances(inv, pay);
    const open = inv.filter(i => balance(i) > 0);
    fill('invoice_id', open, i => `${invNo(i)} · ${i.clients?.name || ''} · ${money(balance(i))} due`, i => ({ balance: balance(i) }));
    const s = root.querySelector('[name=invoice_id]'), amt = root.querySelector('[name=amount]');
    const sync = () => { const b = s.selectedOptions[0]?.dataset.balance; if (b) { amt.value = b; amt.max = b; } };
    s.addEventListener('change', sync); sync();
  }
}
function showModal(kind, preset = {}) {
  const spec = FORMS[kind]; if (!spec) return;
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `<form class="modal"><h2>${spec.title}</h2><div class="form-grid">${spec.fields()}</div><div class="form-error" role="alert"></div><div class="modal-actions"><button type="button" class="button" data-close>Cancel</button><button type="submit" class="button primary">Save</button></div></form>`;
  document.body.append(backdrop);
  backdrop.addEventListener('click', e => { if (e.target === backdrop || e.target.closest('[data-close]')) backdrop.remove(); });
  populateSelects(backdrop, preset).catch(e => toast(e.message));
  const form = backdrop.querySelector('form'), err = form.querySelector('.form-error'), save = form.querySelector('[type=submit]');
  form.addEventListener('submit', async e => {
    e.preventDefault(); err.textContent = ''; save.disabled = true; save.textContent = 'Saving…';
    try {
      const d = Object.fromEntries([...new FormData(form)].filter(([, v]) => typeof v === 'string'));
      await SUBMIT[kind](d, form, preset);
      backdrop.remove(); toast('Saved successfully'); await refresh();
    } catch (error) { err.textContent = error.message; save.disabled = false; save.textContent = 'Save'; }
  });
  Object.entries(preset.values || {}).forEach(([k, v]) => { const el = form.elements[k]; if (!el) return; if (el.type === 'checkbox') el.checked = !!v; else el.value = v ?? ''; });
  const dueSel = form.querySelector('#convert-due'), dueDate = form.querySelector('[name=due_date]');
  dueSel?.addEventListener('change', () => { if (dueSel.value !== '') dueDate.value = addDays(dueSel.value); });
  form.querySelector('input,select,textarea')?.focus();
}

/* ---------- actions (event delegation: survives every re-render) ---------- */
const ACTIONS = {
  async 'pdf-invoice'(el) {
    const id = el.dataset.id; toast('Preparing PDF…');
    const [i, items, payments] = await Promise.all([one('invoices', '*,clients(name,business_name,email,address),projects(title)', id), q('invoice_items', '*', r => r.eq('invoice_id', id)), q('payments', '*', r => r.eq('invoice_id', id))]);
    await downloadPDF('invoice', { number: invNo(i), status: invStatus(i), doc: i, items, payments, biz: state.biz, client: i.clients || {}, project: i.projects?.title });
  },
  async 'pdf-client'(el) {
    const id = el.dataset.id; toast('Preparing client report…');
    const [client, projects, invoices] = await Promise.all([one('clients', '*', id), q('projects', '*', r => r.eq('client_id', id).order('created_at', { ascending: false })), q('invoices', '*', r => r.eq('client_id', id).order('created_at', { ascending: false }))]);
    const ids = invoices.map(i => i.id);
    const [payments, activity] = await Promise.all([ids.length ? q('payments', '*', r => r.in('invoice_id', ids).order('paid_at', { ascending: false })) : [], q('activity_logs', 'action,detail,created_at', r => r.eq('client_id', id).order('created_at', { ascending: false }).limit(25))]);
    await downloadClientReport({ client, projects, invoices, payments, activity, biz: state.biz });
  },
  async 'pdf-monthly'() {
    const month = $('#report-month')?.value;
    if (!/^\d{4}-\d{2}$/.test(month || '')) return toast('Choose a month first.');
    toast('Preparing monthly summary…');
    const [y, mo] = month.split('-').map(Number);
    const from = new Date(y, mo - 1, 1).toISOString(), to = new Date(y, mo, 1).toISOString();
    const fromDay = `${month}-01`, toDay = new Date(y, mo, 1).toLocaleDateString('en-CA');
    const inMonth = col => r => r.gte(col, from).lt(col, to);
    const [clients, projects, invoices, payments, quotations, files, messages, logs, allInvoices, allPayments, active] = await Promise.all([
      q('clients', '*', inMonth('created_at')), q('projects', '*', inMonth('created_at')),
      q('invoices', '*', r => r.gte('issue_date', fromDay).lt('issue_date', toDay)),
      q('payments', '*,invoices(client_id)', inMonth('paid_at')), q('quotations', 'id,status,client_id', inMonth('created_at')),
      q('project_files', 'id', inMonth('created_at')), q('messages', 'id', inMonth('created_at')),
      q('activity_logs', 'action', r => inMonth('created_at')(r).limit(5000)),
      q('invoices', 'id,total,status'), q('payments', 'invoice_id,amount,verified'),
      q('projects', '*', r => r.in('status', ['Confirmed', 'In Progress', 'Internal Review', 'Client Review', 'Revision Requested', 'Approved', 'Ready for Delivery']).order('deadline', { ascending: true, nullsFirst: false }))
    ]);
    const completed = await q('projects', '*', r => inMonth('updated_at')(r).eq('status', 'Completed'));
    const expenses = await safeQ('expenses', '*', r => r.gte('spent_on', fromDay).lt('spent_on', toDay).order('spent_on'));
    const names = Object.fromEntries((await q('clients', 'id,name')).map(c => [c.id, c.name]));
    const { balance } = balances(allInvoices, allPayments);
    const counts = {}; logs.forEach(l => { const k = l.action.replace(/^db\./, '').replace(/\./g, ' '); counts[k] = (counts[k] || 0) + 1; });
    await downloadMonthlyReport({
      month, label: new Date(y, mo - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }), biz: state.biz,
      newClients: clients, projectsCreated: projects, projectsCompleted: completed, activeProjects: active, invoices,
      payments: payments.map(p => ({ ...p, client_id: p.invoices?.client_id })), quotations, filesCount: files.length, messagesCount: messages.length,
      expenses, activityCounts: counts, clientNames: names, snapshot: { outstanding: sum(allInvoices.filter(i => i.status !== 'Void'), balance) }
    });
  },
  async 'pdf-quote'(el) {
    const id = el.dataset.id; toast('Preparing PDF…');
    const [x, items] = await Promise.all([one('quotations', '*,clients(name,business_name,email,address),projects(title)', id), q('quotation_items', '*', r => r.eq('quotation_id', id))]);
    await downloadPDF('quotation', { number: qNo(x), doc: x, items, biz: state.biz, client: x.clients || {}, project: x.projects?.title });
  },
  async 'quote-status'(el) { const { error } = await supabase.rpc('set_quotation_status', { p_id: el.dataset.id, p_status: el.dataset.status }); if (error) throw error; toast(`Marked as ${el.dataset.status.toLowerCase()}`); await refresh(); },
  async 'respond-quote'(el) { const accept = el.dataset.accept === 'true'; if (!confirm(accept ? 'Accept this quotation?' : 'Decline this quotation?')) return; const { error } = await supabase.rpc('respond_quotation', { p_id: el.dataset.id, p_accept: accept }); if (error) throw error; toast(accept ? 'Quotation accepted' : 'Quotation declined'); await refresh(); },
  'convert-quote'(el) { showModal('convert', { quote: el.dataset.id }); },
  async 'delete-quote'(el) { if (!confirm('Delete this draft quotation?')) return; must(await supabase.from('quotations').delete().eq('id', el.dataset.id).eq('status', 'Draft')); location.href = 'quotations.html'; },
  'edit-service'(el) { const d = el.dataset; showModal('service', { id: d.id, values: { name: d.name, description: d.description, unit_price: d.price, active: d.active === 'true' } }); },
  async 'toggle-service'(el) { must(await supabase.from('services').update({ active: el.dataset.active !== 'true' }).eq('id', el.dataset.id)); await refresh(); },
  async 'add-checklist'(el) {
    const existing = (await q('project_tasks', 'title', r => r.eq('project_id', el.dataset.id))).map(t => t.title.toLowerCase());
    const rows = (CHECKLISTS[el.dataset.category] || CHECKLISTS.Other).filter(t => !existing.includes(t.toLowerCase())).map(title => ({ project_id: el.dataset.id, title }));
    if (!rows.length) return toast('The standard checklist is already on this project.');
    must(await supabase.from('project_tasks').insert(rows)); toast(`${rows.length} tasks added`); await refresh();
  },
  async signout() { await supabase.auth.signOut(); location.href = clientMode ? '../client-login.html' : '../login.html'; },
  theme() { document.documentElement.classList.toggle('dark'); localStorage.setItem('sd-theme', document.documentElement.classList.contains('dark') ? 'dark' : 'light'); },
  print() { window.print(); },
  async 'toggle-task'(el) { must(await supabase.from('project_tasks').update({ completed: el.dataset.done !== 'true' }).eq('id', el.dataset.id)); await refresh(); },
  async download(el) { const { data, error } = await supabase.storage.from('project-files').createSignedUrl(el.dataset.path, 120, { download: el.dataset.name }); if (error) throw error; location.href = data.signedUrl; },
  async 'toggle-visibility'(el) { must(await supabase.from('project_files').update({ visible_to_client: el.dataset.visible !== 'true' }).eq('id', el.dataset.id)); await refresh(); },
  async 'delete-file'(el) { if (!confirm('Delete this file permanently?')) return; must(await supabase.from('project_files').delete().eq('id', el.dataset.id)); await supabase.storage.from('project-files').remove([el.dataset.path]); toast('File deleted'); await refresh(); },
  async 'archive-client'(el) { must(await supabase.from('clients').update({ archived_at: el.dataset.archived === 'true' ? null : new Date().toISOString() }).eq('id', el.dataset.id)); await refresh(); },
  async 'invite-client'(el) {
    if (!confirm('Email a portal invitation to this client?')) return;
    el.disabled = true;
    try {
      const { data, error } = await supabase.functions.invoke('invite-client', { body: { client_id: el.dataset.client } });
      if (error) throw new Error((await error.context?.json?.().catch(() => null))?.error || error.message);
      toast(data.invited ? 'Invitation emailed' : 'Existing account linked'); await refresh();
    } finally { el.disabled = false; }
  },
  async 'link-account'(el) {
    const email = $('#link-email').value.trim().toLowerCase(); if (!email) return toast('Enter the user’s email.');
    const { data: prof, error } = await supabase.from('profiles').select('id,role').ilike('email', email.replace(/[\\%_]/g, '\\$&')).maybeSingle(); if (error) throw error;
    if (!prof) return toast('No registered user with that email. Create them in Supabase → Authentication → Users first.');
    if (prof.role !== 'client') return toast('That user is an admin, not a client account.');
    must(await supabase.from('client_users').insert({ client_id: el.dataset.client, user_id: prof.id })); toast('Account linked'); await refresh();
  },
  async unlink(el) { if (!confirm('Remove this portal access?')) return; must(await supabase.from('client_users').delete().eq('client_id', el.dataset.client).eq('user_id', el.dataset.user)); await refresh(); },
  async 'void-invoice'(el) { if (!confirm('Void this invoice? Payments already recorded are kept.')) return; const { error } = await supabase.rpc('set_invoice_void', { p_id: el.dataset.id, p_void: true }); if (error) throw error; await refresh(); },
  async 'reopen-invoice'(el) { const { error } = await supabase.rpc('set_invoice_void', { p_id: el.dataset.id, p_void: false }); if (error) throw error; await refresh(); },
  async 'set-progress'(el) { const v = Math.round(Number($('#progress-input').value)); if (!(v >= 0 && v <= 100)) return toast('Progress must be between 0 and 100.'); must(await supabase.from('projects').update({ progress: v }).eq('id', el.dataset.id)); toast('Progress updated'); await refresh(); },
  async 'save-settings'() {
    const values = Object.fromEntries([...document.querySelectorAll('#settings-form [name]')].map(i => [i.name, i.value.trim() === '' && i.name !== 'business_name' && i.name !== 'currency' ? null : i.value.trim()]));
    values.tax_rate = Number(values.tax_rate || 0); values.updated_at = new Date().toISOString();
    if (!values.business_name) return toast('Business name is required.');
    if (values.payment_link && !isHttps(values.payment_link)) return toast('The payment link must start with https://');
    must(await supabase.from('business_settings').update(values).eq('id', true)); state.biz = { ...state.biz, ...values }; setCurrency(values.currency); toast('Settings saved');
  },
  async 'save-profile'() {
    const name = $('#profile-name').value.trim();
    must(await supabase.from('profiles').update({ full_name: name }).eq('id', state.user.id)); state.profile.full_name = name; paintUser(); toast('Profile saved');
  }
};
function rangeBounds(key) {
  const n = new Date(), y = n.getFullYear(), m = n.getMonth(), d = (yy, mm) => new Date(yy, mm, 1).toLocaleDateString('en-CA');
  return ({ month: [d(y, m), d(y, m + 1)], last: [d(y, m - 1), d(y, m)], year: [d(y, 0), d(y + 1, 0)], lastyear: [d(y - 1, 0), d(y, 0)] })[key] || [null, null];
}
const between = (col, ts, key) => r => {
  const [a, b] = rangeBounds(key); if (!a) return r;
  return ts ? r.gte(col, new Date(`${a}T00:00:00`).toISOString()).lt(col, new Date(`${b}T00:00:00`).toISOString()) : r.gte(col, a).lt(col, b);
};
const localDay = d => d ? new Date(d).toLocaleDateString('en-CA') : '';
const EXPORTERS = {
  async clients(key) {
    const rows = await qAll('clients', '*', between('created_at', true, key));
    return ['clients', ['Name', 'Business', 'Email', 'Phone', 'Address', 'Status', 'Registered'], rows.map(c => [c.name, c.business_name, c.email, c.phone, c.address, c.archived_at ? 'Archived' : 'Active', localDay(c.created_at)])];
  },
  async invoices(key) {
    const [rows, pays] = await Promise.all([qAll('invoices', '*,clients(name),projects(title)', between('issue_date', false, key)), qAll('payments', 'invoice_id,amount,verified')]);
    const { paid } = balances(rows, pays), r2 = n => Math.round(n * 100) / 100;
    return ['invoices', ['Invoice', 'Client', 'Project', 'Issue date', 'Due date', 'Status', 'Subtotal', 'Discount', 'Tax %', 'Tax amount', 'Total', 'Paid', 'Balance', 'Terms'],
      rows.map(i => [invNo(i), i.clients?.name, i.projects?.title, i.issue_date, i.due_date, invStatus(i), Number(i.subtotal), Number(i.discount), Number(i.tax_rate), r2(i.total - (i.subtotal - i.discount)), Number(i.total), paid[i.id] || 0, i.status === 'Void' ? 0 : r2(Math.max(0, i.total - (paid[i.id] || 0))), i.payment_terms])];
  },
  async payments(key) {
    const rows = await qAll('payments', '*,invoices(invoice_number,clients(name))', between('paid_at', true, key));
    return ['payments', ['Date', 'Invoice', 'Client', 'Method', 'Reference', 'Amount', 'Verified'], rows.map(p => [localDay(p.paid_at), p.invoices ? invNo(p.invoices) : '', p.invoices?.clients?.name, p.method, p.reference, Number(p.amount), p.verified ? 'Yes' : 'No'])];
  },
  async expenses(key) {
    const rows = await qAll('expenses', '*,projects(title)', between('spent_on', false, key));
    return ['expenses', ['Date', 'Category', 'Paid to', 'Project', 'Notes', 'Amount'], rows.map(e => [e.spent_on, e.category, e.vendor, e.projects?.title, e.description, Number(e.amount)])];
  }
};
const safeLink = l => /^[a-z0-9-]+\.html(\?[\w=&.-]*)?$/i.test(l || '') ? l : '#';
Object.assign(ACTIONS, {
  async 'export-csv'(el) {
    const key = $('#export-range')?.value || 'all';
    if (!Object.hasOwn(EXPORTERS, el.dataset.kind)) return;
    toast('Preparing export…');
    const [name, headers, rows] = await EXPORTERS[el.dataset.kind](key);
    if (!rows.length) return toast('Nothing to export for that period.');
    downloadCSV(`studiodesk-${name}-${key}-${today()}.csv`, headers, rows); toast(`${rows.length} rows exported`);
  },
  async 'view-slip'(el) {
    const w = window.open('', '_blank');
    const { data, error } = await supabase.storage.from('payment-slips').createSignedUrl(el.dataset.path, 120);
    if (error) { w?.close(); throw error; }
    if (w) { w.opener = null; w.location.href = data.signedUrl; } else location.href = data.signedUrl;
  },
  async 'confirm-slip'(el) {
    if (!confirm(`Record a verified payment of ${money(el.dataset.amount)} from this slip?`)) return;
    const { error } = await supabase.rpc('confirm_payment_slip', { p_slip: el.dataset.id }); if (error) throw error;
    toast('Payment recorded'); await refresh();
  },
  async 'reject-slip'(el) {
    const note = prompt('Reason (the client will see this):', 'The amount or reference does not match.'); if (note === null) return;
    const { error } = await supabase.rpc('reject_payment_slip', { p_slip: el.dataset.id, p_note: note }); if (error) throw error;
    toast('Slip rejected'); await refresh();
  },
  async review(el) {
    const approve = el.dataset.decision === 'Approved'; let comment = null;
    if (approve) { if (!confirm('Approve this file? Your studio will be notified.')) return; }
    else { comment = prompt('What would you like changed?'); if (comment === null) return; if (!comment.trim()) return toast('Please describe the changes you would like.'); }
    const { error } = await supabase.rpc('submit_review', { p_file: el.dataset.file, p_decision: el.dataset.decision, p_comment: comment }); if (error) throw error;
    toast(approve ? 'Approved. Thank you!' : 'Change request sent'); await refresh();
  },
  async 'set-included'(el) {
    const v = Math.round(Number($('#included-input').value)); if (!(v >= 0 && v <= 50)) return toast('Enter a number between 0 and 50.');
    must(await supabase.from('projects').update({ included_revisions: v }).eq('id', el.dataset.id)); toast('Updated'); await refresh();
  },
  'edit-expense'(el) { const e = expenseRows[el.dataset.id]; if (e) showModal('expense', { id: e.id, project_id: e.project_id, values: { spent_on: e.spent_on, category: e.category, amount: e.amount, vendor: e.vendor, description: e.description } }); },
  async 'delete-expense'(el) { if (!confirm('Delete this expense?')) return; must(await supabase.from('expenses').delete().eq('id', el.dataset.id)); toast('Expense deleted'); await refresh(); },
  'edit-event'(el) { const e = calEvents[el.dataset.id]; if (e) showModal('event', { id: e.id, project_id: e.project_id, values: { title: e.title, kind: e.kind, starts_on: e.starts_on, start_time: e.start_time?.slice(0, 5), location: e.location, notes: e.notes } }); },
  async 'delete-event'(el) { if (!confirm('Delete this event?')) return; must(await supabase.from('events').delete().eq('id', el.dataset.id)); toast('Event deleted'); await refresh(); },
  async bell() {
    const pop = $('#bell-pop');
    if (!pop.classList.contains('hidden')) { pop.classList.add('hidden'); return; }
    const rows = await q('notifications', '*', r => r.eq('user_id', state.user.id).order('created_at', { ascending: false }).limit(15));
    pop.innerHTML = `<div class="pop-head">Notifications</div>${rows.map(n => `<a class="pop-item ${n.read_at ? '' : 'unread'}" href="${h(safeLink(n.link))}"><b>${h(n.title)}</b><span>${h(n.body)}</span><time>${new Date(n.created_at).toLocaleString()}</time></a>`).join('') || '<div class="empty">Nothing new.</div>'}`;
    pop.classList.remove('hidden');
    if (rows.some(n => !n.read_at)) { await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', state.user.id).is('read_at', null); refreshBell(); }
  },
  async 'mfa-enforce'(el) {
    const on = el.dataset.on === 'true';
    if (on && !confirm('From now on every admin must use an authenticator app. An admin who has not set one up will be sent to do so at sign-in, and until then cannot make changes. Make sure every admin has set one up first. Continue?')) return;
    must(await supabase.from('business_settings').update({ enforce_admin_mfa: on }).eq('id', true)); state.biz.enforce_admin_mfa = on;
    toast(on ? 'MFA is now required for all admins' : 'MFA is no longer required'); await refresh();
  },
  async 'remove-mfa'(el) {
    if (!confirm('Remove your authenticator? You will have to set it up again to turn two-step verification back on.')) return;
    const { error } = await supabase.auth.mfa.unenroll({ factorId: el.dataset.factor }); if (error) throw error;
    toast('Authenticator removed'); await refresh();
  }
});
async function refreshBell() {
  const { count } = await supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', state.user.id).is('read_at', null);
  const dot = $('#bell-count'); if (!dot) return;
  dot.textContent = count > 9 ? '9+' : String(count || ''); dot.classList.toggle('hidden', !count);
}
document.addEventListener('click', e => { if (!e.target.closest('.bell-wrap')) $('#bell-pop')?.classList.add('hidden'); });

const CHANGES = {
  async 'quote-status'(el) { must(await supabase.from('quotations').update({ status: el.value }).eq('id', el.dataset.id)); toast('Quotation updated'); },
  async 'project-status'(el) { must(await supabase.from('projects').update({ status: el.value, updated_at: new Date().toISOString() }).eq('id', el.dataset.id)); toast('Status updated'); await refresh(); }
};
const guard = fn => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message || 'Something went wrong'); } };
document.addEventListener('click', guard(async e => {
  const create = e.target.closest('[data-create]');
  if (create) {
    const d = create.dataset, preset = { client_id: d.client, project_id: d.project, invoice_id: d.invoice, extra: d.extra, values: { ...(d.date ? { starts_on: d.date } : {}), ...(d.amount ? { amount: d.amount } : {}) } };
    return ['invoice', 'quote'].includes(d.create) ? await showBuilder(d.create, preset) : showModal(d.create, preset);
  }
  const el = e.target.closest('[data-action]');
  if (el && ACTIONS[el.dataset.action]) { el.disabled = true; try { await ACTIONS[el.dataset.action](el); } finally { el.disabled = false; } }
}));
document.addEventListener('change', guard(async e => {
  if (e.target.dataset.quick !== undefined) { const ta = e.target.closest('form').querySelector('[name=body]'); if (e.target.value) { ta.value = e.target.value; ta.focus(); } return; }
  if (e.target.id === 'table-filter') applyFilter();
  const el = e.target.closest('[data-change]'); if (el && CHANGES[el.dataset.change]) await CHANGES[el.dataset.change](el);
}));
document.addEventListener('input', e => { if (e.target.id === 'table-search') applyFilter(); });

/* ---------- services (price presets) ---------- */
async function servicesList() {
  const rows = await q('services', '*', r => r.order('name'));
  content(dataTable({ headers: ['SERVICE', 'DESCRIPTION', 'DEFAULT PRICE', 'STATUS', ''], rows, placeholder: 'Search services…', status: r => r.active ? 'Active' : 'Hidden', search: r => [r.name, r.description].join(' '), empty: 'No services yet. Add the things you sell so you can pick them when building quotations and invoices.',
    row: r => `<tr><td class="name-cell">${h(r.name)}</td><td class="wrap">${h(r.description || '—')}</td><td>${money(r.unit_price)}</td><td><span class="badge ${r.active ? 'green' : ''}">${r.active ? 'Active' : 'Hidden'}</span></td><td class="row-actions"><button class="button" data-action="edit-service" data-id="${r.id}" data-name="${h(r.name)}" data-description="${h(r.description)}" data-price="${r.unit_price}" data-active="${r.active}">Edit</button><button class="button" data-action="toggle-service" data-id="${r.id}" data-active="${r.active}">${r.active ? 'Hide' : 'Show'}</button></td></tr>` }));
}

/* ---------- invoice / quotation builder ---------- */
async function showBuilder(kind, preset = {}) {
  const isInv = kind === 'invoice';
  const [clients, projects, services] = await Promise.all([
    q('clients', 'id,name', r => r.is('archived_at', null).order('name')),
    q('projects', 'id,title,client_id,agreed_price', r => r.order('created_at', { ascending: false })),
    q('services', '*', r => r.eq('active', true).order('name'))
  ]);
  const defTax = Number(state.biz.tax_rate || 0);
  const projectOptions = clientId => projects.filter(p => !clientId || p.client_id === clientId).map(p => `<option value="${p.id}">${h(p.title)}</option>`).join('');
  const lineRow = () => `<div class="line"><select class="field" data-service><option value="">Custom item</option>${services.map(sv => `<option value="${sv.id}">${h(sv.name)} · ${money(sv.unit_price)}</option>`).join('')}</select><input class="field" data-desc placeholder="Description"><input class="field" data-qty type="number" min="0.01" step="any" value="1" aria-label="Quantity"><input class="field" data-price type="number" min="0" step=".01" placeholder="0.00" aria-label="Unit price"><span class="line-total">${money(0)}</span><button type="button" class="icon-btn" data-remove-line title="Remove line">✕</button></div>`;
  const presets = isInv ? DUE_PRESETS : VALID_PRESETS, defDays = isInv ? '14' : '14';
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `<form class="modal wide"><h2>${isInv ? 'New invoice' : 'New quotation'}</h2>
    <div class="form-grid">
      <label>Client<select class="field" name="client_id" required><option value="">Choose a client</option>${clients.map(c => `<option value="${c.id}">${h(c.name)}</option>`).join('')}</select></label>
      <label>Project<select class="field" name="project_id"><option value="">No project linked</option>${projectOptions('')}</select></label>
      <label>${isInv ? 'Due' : 'Valid for'}<span class="inline-row"><select class="field" data-days>${presets.map(([v, l]) => `<option value="${v}" ${v === defDays ? 'selected' : ''}>${l}</option>`).join('')}</select><input class="field" name="${isInv ? 'due_date' : 'valid_until'}" type="date" ${isInv ? 'required' : ''} value="${addDays(defDays)}"></span></label>
      ${isInv ? `<label>Payment terms<input class="field" name="payment_terms" list="terms-list" value="${h(state.biz.payment_terms || '')}"></label>${termsDatalist()}` : '<div></div>'}
    </div>
    <div class="lines-head"><span>Service</span><span>Description</span><span>Qty</span><span>Unit price</span><span>Amount</span><span></span></div>
    <div class="lines">${lineRow()}</div>
    <button type="button" class="button add-line" data-add-line>＋ Add line</button>
    <div class="form-grid builder-foot">
      <label class="wide">Notes<textarea class="field" name="notes" placeholder="${isInv ? 'Thank-you note, delivery details…' : 'Scope, exclusions, timeline…'}"></textarea></label>
      <label>Discount (amount)<input class="field" name="discount" type="number" min="0" step=".01" placeholder="0"></label>
      <label>Tax (%)<input class="field" name="tax_rate" type="number" min="0" step=".01" value="${defTax}"></label>
    </div>
    <div class="builder-totals" id="builder-totals"></div>
    <div class="form-error" role="alert"></div>
    <div class="modal-actions"><button type="button" class="button" data-close>Cancel</button><button type="submit" class="button primary">${isInv ? 'Create invoice' : 'Create quotation'}</button></div></form>`;
  document.body.append(backdrop);
  backdrop.addEventListener('click', e => { if (e.target === backdrop || e.target.closest('[data-close]')) backdrop.remove(); });
  const form = backdrop.querySelector('form'), linesEl = form.querySelector('.lines'), err = form.querySelector('.form-error');
  const clientSel = form.elements.client_id, projectSel = form.elements.project_id, dateInput = form.elements[isInv ? 'due_date' : 'valid_until'], daysSel = form.querySelector('[data-days]');

  const recalc = () => {
    let sub = 0;
    linesEl.querySelectorAll('.line').forEach(l => { const t = (Number(l.querySelector('[data-qty]').value) || 0) * (Number(l.querySelector('[data-price]').value) || 0); sub += t; l.querySelector('.line-total').textContent = money(t); });
    const disc = Math.max(0, Number(form.elements.discount.value) || 0), tax = Math.max(0, Number(form.elements.tax_rate.value) || 0);
    const total = Math.round((sub - disc) * (1 + tax / 100) * 100) / 100;
    form.querySelector('#builder-totals').innerHTML = `<div><span>Subtotal</span><b>${money(sub)}</b></div>${disc ? `<div><span>Discount</span><b>−${money(disc)}</b></div>` : ''}${tax ? `<div><span>Tax (${tax}%)</span><b>${money(total - (sub - disc))}</b></div>` : ''}<div class="grand"><span>Total</span><b>${money(total)}</b></div>`;
    return { sub, disc, tax, total };
  };
  const setClient = id => { const keep = projectSel.value; clientSel.value = id || ''; projectSel.innerHTML = `<option value="">No project linked</option>${projectOptions(clientSel.value)}`; if ([...projectSel.options].some(o => o.value === keep)) projectSel.value = keep; };
  const onProject = () => {
    const pr = projects.find(x => x.id === projectSel.value); if (!pr) return;
    if (clientSel.value !== pr.client_id) { const keep = pr.id; setClient(pr.client_id); projectSel.value = keep; }
    const first = linesEl.querySelector('.line');
    if (linesEl.children.length === 1 && !first.querySelector('[data-desc]').value && !first.querySelector('[data-price]').value && Number(pr.agreed_price) > 0) {
      first.querySelector('[data-desc]').value = pr.title; first.querySelector('[data-price]').value = pr.agreed_price;
    }
    recalc();
  };

  form.addEventListener('input', e => { if (e.target === dateInput) daysSel.value = ''; recalc(); });
  form.addEventListener('change', e => {
    const t = e.target;
    if (t.matches('[data-service]')) { const sv = services.find(x => x.id === t.value), line = t.closest('.line'); if (sv) { line.querySelector('[data-desc]').value = sv.name; line.querySelector('[data-price]').value = sv.unit_price; } recalc(); }
    else if (t === clientSel) setClient(clientSel.value);
    else if (t === projectSel) onProject();
    else if (t === daysSel && daysSel.value !== '') dateInput.value = addDays(daysSel.value);
  });
  form.addEventListener('click', e => {
    if (e.target.closest('[data-add-line]')) { linesEl.insertAdjacentHTML('beforeend', lineRow()); linesEl.lastElementChild.querySelector('[data-service]').focus(); recalc(); }
    const rm = e.target.closest('[data-remove-line]');
    if (rm) { if (linesEl.children.length > 1) rm.closest('.line').remove(); else rm.closest('.line').querySelectorAll('input').forEach(i => { i.value = i.matches('[data-qty]') ? 1 : ''; }); recalc(); }
  });
  if (preset.client_id) setClient(preset.client_id);
  if (preset.project_id) { projectSel.value = preset.project_id; onProject(); }
  if (preset.extra && isInv) {
    const sv = services.find(x => x.name === 'Additional revision round'), first = linesEl.querySelector('.line');
    first.querySelector('[data-desc]').value = 'Additional revision round'; first.querySelector('[data-qty]').value = preset.extra;
    first.querySelector('[data-price]').value = sv ? sv.unit_price : ''; if (sv) first.querySelector('[data-service]').value = sv.id;
  }
  recalc();

  form.addEventListener('submit', async e => {
    e.preventDefault(); err.textContent = '';
    const save = form.querySelector('[type=submit]'), label = save.textContent;
    try {
      const items = [...linesEl.querySelectorAll('.line')].map(l => ({ description: l.querySelector('[data-desc]').value.trim(), quantity: Number(l.querySelector('[data-qty]').value), unit_price: Number(l.querySelector('[data-price]').value || 0) })).filter(x => x.description || x.unit_price);
      if (!clientSel.value) throw new Error('Choose a client.');
      if (!items.length) throw new Error('Add at least one line item.');
      if (items.some(x => !x.description)) throw new Error('Every line needs a description.');
      if (items.some(x => !(x.quantity > 0))) throw new Error('Quantities must be above zero.');
      const { total } = recalc(); if (!(total > 0)) throw new Error('The total must be above zero.');
      save.disabled = true; save.textContent = 'Saving…';
      const base = { p_client: clientSel.value, p_project: projectSel.value || null, p_items: items, p_discount: Number(form.elements.discount.value || 0), p_tax_rate: Number(form.elements.tax_rate.value || 0), p_notes: form.elements.notes.value.trim() || null };
      const { data, error } = isInv
        ? await supabase.rpc('create_invoice', { ...base, p_due: dateInput.value, p_terms: form.elements.payment_terms.value.trim() || null })
        : await supabase.rpc('create_quotation', { ...base, p_valid_until: dateInput.value || null });
      if (error) throw error;
      toast(isInv ? 'Invoice created' : 'Quotation created');
      location.href = `${isInv ? 'invoice' : 'quotation'}-details.html?id=${data.id}`;
    } catch (error) { err.textContent = error.message; save.disabled = false; save.textContent = label; }
  });
  clientSel.focus();
}

/* ---------- quotation details ---------- */
async function quotationDetails() {
  const id = params.get('id');
  const x = id && await one('quotations', '*,clients(name,email,address,business_name),projects(title)', id);
  const listPage = clientMode ? 'client-quotations.html' : 'quotations.html';
  if (!x) { content(`<div class="panel empty">Quotation not found. ${back(listPage, 'Back to quotations')}</div>`); return; }
  const [items, invoices] = await Promise.all([q('quotation_items', '*', r => r.eq('quotation_id', id)), q('invoices', 'id,invoice_number,status', r => r.eq('quotation_id', id))]);
  const expired = x.status === 'Sent' && x.valid_until && x.valid_until < today();
  const status = expired ? 'Expired' : x.status;
  const live = invoices.find(i => i.status !== 'Void');
  const btn = (action, label, extra = '', cls = '') => `<button class="button ${cls}" data-action="${action}" data-id="${x.id}" ${extra}>${label}</button>`;
  let actions = back(listPage, 'Quotations') + btn('pdf-quote', '⬇ Download PDF', '', 'primary');
  if (clientMode) {
    if (x.status === 'Sent' && !expired) actions += btn('respond-quote', 'Decline', 'data-accept="false"', 'danger') + btn('respond-quote', 'Accept quotation', 'data-accept="true"', 'primary');
  } else {
    if (x.status === 'Draft') actions += btn('quote-status', 'Mark as sent', 'data-status="Sent"') + btn('delete-quote', 'Delete', '', 'danger');
    if (x.status === 'Sent' && !expired) actions += btn('quote-status', 'Mark declined', 'data-status="Declined"') + btn('quote-status', 'Mark accepted', 'data-status="Accepted"');
    if (live) actions += `<a class="button" href="invoice-details.html?id=${live.id}">View ${invNo(live)}</a>`;
    else if (!['Declined', 'Expired'].includes(status)) actions += btn('convert-quote', 'Convert to invoice', '', x.status === 'Accepted' ? 'primary' : '');
  }
  setHead(qNo(x), x.clients?.name || '');
  setAction(actions);
  content(`<div class="panel invoice-sheet"><div class="inv-head"><div><h2>${h(state.biz.business_name || 'StudioDesk')}</h2><p class="sub-cell">${h(state.biz.address)}<br>${h(state.biz.email)} ${h(state.biz.phone)}</p></div><div class="inv-meta"><b>${qNo(x)}</b><div>${badge(status)}</div><div class="sub-cell">Created ${date(x.created_at)} · Valid until ${date(x.valid_until)}</div></div></div><div class="kvs kv-wide">${kv('Prepared for', h(x.clients?.name))}${kv('Email', h(x.clients?.email))}${kv('Project', h(x.projects?.title))}${live ? kv('Invoice', `<a href="${clientMode ? 'client-' : ''}invoice-details.html?id=${live.id}">${invNo(live)}</a>`) : ''}</div>${tableHTML(['DESCRIPTION', 'QTY', 'UNIT PRICE', 'AMOUNT'], items.map(i => `<tr><td>${h(i.description)}</td><td>${i.quantity}</td><td>${money(i.unit_price)}</td><td>${money(i.quantity * i.unit_price)}</td></tr>`).join(''), 'No line items.')}<div class="totals"><div><span>Subtotal</span><b>${money(x.subtotal)}</b></div>${Number(x.discount) ? `<div><span>Discount</span><b>−${money(x.discount)}</b></div>` : ''}${Number(x.tax_rate) ? `<div><span>Tax (${x.tax_rate}%)</span><b>${money(x.total - (x.subtotal - x.discount))}</b></div>` : ''}<div class="grand"><span>Total</span><b>${money(x.total)}</b></div></div>${x.notes ? `<p class="desc notes">${h(x.notes)}</p>` : ''}</div>`);
}

/* ---------- expenses ---------- */
let expenseRows = {};
async function expensesList() {
  const rows = await q('expenses', '*,projects(title)', r => r.order('spent_on', { ascending: false }).limit(2000));
  expenseRows = Object.fromEntries(rows.map(e => [e.id, e]));
  const now = new Date(), cm = monthKey(now), pm = monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1)), yr = String(now.getFullYear());
  const inMonth = k => sum(rows.filter(e => monthOf(e.spent_on) === k), e => e.amount);
  const byCat = {}; rows.filter(e => monthOf(e.spent_on) === cm).forEach(e => { byCat[e.category] = (byCat[e.category] || 0) + Number(e.amount); });
  const top = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0];
  const stats = `<div class="stats-grid">${stat('This month', money(inMonth(cm)), 'Expenses logged', '−')}${stat('Last month', money(inMonth(pm)), 'For comparison', '◷')}${stat('This year', money(sum(rows.filter(e => String(e.spent_on).startsWith(yr)), e => e.amount)), 'Year to date', '▤')}${stat('Biggest category', top ? h(top[0]) : '—', top ? `${money(top[1])} this month` : 'Nothing logged yet', '▥')}</div>`;
  content(stats + dataTable({ headers: ['DATE', 'CATEGORY', 'PAID TO', 'PROJECT', 'NOTES', 'AMOUNT', ''], rows, placeholder: 'Search expenses…', status: e => e.category, search: e => [e.vendor, e.description, e.category, e.projects?.title].join(' '),
    empty: 'No expenses yet. Add equipment, freelancers, software… to see real profit on the dashboard and in Reports.',
    row: e => `<tr><td>${date(e.spent_on)}</td><td>${h(e.category)}</td><td>${h(e.vendor || '—')}</td><td>${h(e.projects?.title || '—')}</td><td class="wrap">${h(e.description || '')}</td><td>${money(e.amount)}</td><td class="row-actions"><button class="button" data-action="edit-expense" data-id="${e.id}">Edit</button><button class="button danger" data-action="delete-expense" data-id="${e.id}">Delete</button></td></tr>` }));
}

/* ---------- calendar ---------- */
let calEvents = {};
const CAL_TYPES = { deadline: ['Deadline', 'red'], task: ['Task', 'orange'], event: ['Event', 'blue'], invoice: ['Invoice due', 'green'] };
async function calendarView() {
  const ym = /^\d{4}-\d{2}$/.test(params.get('m') || '') ? params.get('m') : today().slice(0, 7);
  const [Y, M] = ym.split('-').map(Number);
  const iso = d => d.toLocaleDateString('en-CA'), ymOf = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const offset = (new Date(Y, M - 1, 1).getDay() + 6) % 7;                         // weeks start on Monday
  const weeks = Math.ceil((offset + new Date(Y, M, 0).getDate()) / 7), gridStart = new Date(Y, M - 1, 1 - offset), gridEnd = new Date(Y, M - 1, 1 - offset + weeks * 7);
  const from = iso(gridStart), to = iso(gridEnd);
  const label = new Date(Y, M - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  setHead('Calendar', label);
  setAction(`<a class="button" href="calendar.html?m=${ymOf(new Date(Y, M - 2, 1))}" aria-label="Previous month">←</a><a class="button" href="calendar.html">Today</a><a class="button" href="calendar.html?m=${ymOf(new Date(Y, M, 1))}" aria-label="Next month">→</a><button class="button primary" data-create="event">＋ Add event</button>`);
  const [projects, tasks, events, invoices] = await Promise.all([
    q('projects', 'id,title,deadline', r => r.gte('deadline', from).lt('deadline', to).not('status', 'in', '("Completed","Cancelled")')),
    q('project_tasks', 'id,title,due_date,project_id,projects(title)', r => r.eq('completed', false).gte('due_date', from).lt('due_date', to)),
    safeQ('events', '*,projects(title)', r => r.gte('starts_on', from).lt('starts_on', to)),
    q('invoices', 'id,invoice_number,due_date,clients(name)', r => r.in('status', ['Pending', 'Partially Paid', 'Overdue']).gte('due_date', from).lt('due_date', to))
  ]);
  calEvents = Object.fromEntries(events.map(e => [e.id, e]));
  const items = [
    ...projects.map(p => ({ day: p.deadline, type: 'deadline', title: p.title, sub: 'Project deadline', href: `project-details.html?id=${p.id}` })),
    ...tasks.map(t => ({ day: t.due_date, type: 'task', title: t.title, sub: t.projects?.title, href: `project-details.html?id=${t.project_id}` })),
    ...invoices.map(i => ({ day: i.due_date, type: 'invoice', title: `${invNo(i)} due`, sub: i.clients?.name, href: `invoice-details.html?id=${i.id}` })),
    ...events.map(e => ({ day: e.starts_on, type: 'event', title: e.title, sub: [e.kind, e.start_time?.slice(0, 5), e.location, e.projects?.title].filter(Boolean).join(' · '), event: e.id }))
  ].sort((a, b) => a.day.localeCompare(b.day) || (a.type === 'event' ? -1 : 1));
  const byDay = {}; items.forEach(x => { (byDay[x.day] ||= []).push(x); });
  const chip = x => x.event
    ? `<button class="cal-chip ${CAL_TYPES[x.type][1]}" data-action="edit-event" data-id="${x.event}" title="${h(x.title)}">${h(x.title)}</button>`
    : `<a class="cal-chip ${CAL_TYPES[x.type][1]}" href="${x.href}" title="${h(x.title)}">${h(x.title)}</a>`;
  let cells = '';
  for (let k = 0; k < weeks * 7; k++) {
    const d = new Date(gridStart); d.setDate(gridStart.getDate() + k);
    const key = iso(d), list = byDay[key] || [];
    cells += `<div class="cal-cell ${d.getMonth() !== M - 1 ? 'other' : ''} ${key === today() ? 'today' : ''}"><div class="cal-day"><span>${d.getDate()}</span><button class="cal-add" data-create="event" data-date="${key}" title="Add event on ${key}" aria-label="Add event on ${key}">＋</button></div>${list.slice(0, 3).map(chip).join('')}${list.length > 3 ? `<span class="cal-more">+${list.length - 3} more</span>` : ''}</div>`;
  }
  const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const agenda = items.filter(x => x.day.startsWith(ym));
  content(`${panel(label, 'Red deadlines · orange tasks · blue events · green invoices due', `<div class="cal"><div class="cal-head">${names.map(n => `<span>${n}</span>`).join('')}</div><div class="cal-grid">${cells}</div></div>`)}${panel('Agenda', `Everything in ${label}`, tableHTML(['DATE', 'TYPE', 'WHAT', 'DETAILS', ''], agenda.map(x => `<tr><td>${date(x.day)}</td><td><span class="badge ${CAL_TYPES[x.type][1]}">${CAL_TYPES[x.type][0]}</span></td><td class="name-cell">${x.href ? `<a href="${x.href}">${h(x.title)}</a>` : h(x.title)}</td><td class="wrap">${h(x.sub || '')}</td><td class="row-actions">${x.event ? `<button class="button" data-action="edit-event" data-id="${x.event}">Edit</button><button class="button danger" data-action="delete-event" data-id="${x.event}">Delete</button>` : ''}</td></tr>`).join(''), 'Nothing scheduled this month.'))}`);
}

/* ---------- audit log ---------- */
const AUDIT_PAGE = 50;
const humanAction = a => { const m = /^db\.([a-z_]+)\.(insert|update|delete)$/.exec(a || ''); return m ? `${{ insert: 'Added', update: 'Changed', delete: 'Deleted' }[m[2]]} · ${m[1].replace(/_/g, ' ')}` : a; };
const fmtVal = v => v === null || v === undefined ? '∅' : typeof v === 'object' ? JSON.stringify(v) : String(v);
function describeLog(l) {
  const d = l.detail || {}, bits = [];
  if (d.label) bits.push(d.label);
  if (d.changed) for (const [k, v] of Object.entries(d.changed)) bits.push(v && typeof v === 'object' ? `${k}: ${fmtVal(v.from)} → ${fmtVal(v.to)}` : `${k} changed`);
  if (!bits.length && !String(l.action).startsWith('db.')) { const t = JSON.stringify(d); if (t !== '{}') bits.push(t.length > 160 ? t.slice(0, 160) + '…' : t); }
  return bits.join(' · ');
}
const uaLabel = ua => { ua = ua || ''; const b = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser', o = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : ''; return o ? `${b} on ${o}` : b; };
async function auditView() {
  const tab = params.get('tab') === 'signins' ? 'signins' : 'activity';
  const pg = Math.max(0, Math.floor(Number(params.get('p')) || 0));
  const dayRe = /^\d{4}-\d{2}-\d{2}$/, from = dayRe.test(params.get('from') || '') ? params.get('from') : '', to = dayRe.test(params.get('to') || '') ? params.get('to') : '', term = (params.get('q') || '').trim().slice(0, 60);
  const href = extra => { const u = new URLSearchParams(); u.set('tab', tab); if (from) u.set('from', from); if (to) u.set('to', to); if (term) u.set('q', term); Object.entries(extra).forEach(([k, v]) => v ? u.set(k, v) : u.delete(k)); return `audit.html?${u}`; };
  const tabs = `<div class="head-actions tabs"><a class="button ${tab === 'activity' ? 'primary' : ''}" href="audit.html">Activity</a><a class="button ${tab === 'signins' ? 'primary' : ''}" href="audit.html?tab=signins">Sign-ins</a></div>`;
  let r, body, headers, filter = '';
  if (tab === 'activity') {
    r = supabase.from('activity_logs').select('*,profiles(full_name,email),clients(name),projects(title)', { count: 'exact' }).order('created_at', { ascending: false });
    if (from) r = r.gte('created_at', new Date(`${from}T00:00:00`).toISOString());
    if (to) r = r.lt('created_at', new Date(new Date(`${to}T00:00:00`).getTime() + 86400000).toISOString());
    if (term) r = r.ilike('action', `%${term.replace(/[\\%_]/g, '\\$&')}%`);
    filter = `<form class="toolbar wrap-tools" method="get" action="audit.html"><input type="hidden" name="tab" value="activity"><label>From<input class="field" type="date" name="from" value="${h(from)}"></label><label>To<input class="field" type="date" name="to" value="${h(to)}"></label><label>Action contains<input class="search" name="q" value="${h(term)}" maxlength="60" placeholder="e.g. invoices, payments, delete"></label><button class="button primary" type="submit">Filter</button><a class="button" href="audit.html">Reset</a></form>`;
    headers = ['WHEN', 'WHO', 'WHAT', 'DETAILS', 'CLIENT / PROJECT'];
  } else {
    r = supabase.from('login_events').select('*,profiles(full_name,email)', { count: 'exact' }).order('created_at', { ascending: false });
    headers = ['WHEN', 'WHO', 'DEVICE', 'IP ADDRESS', 'FLAGS'];
  }
  const { data, error, count } = await r.range(pg * AUDIT_PAGE, pg * AUDIT_PAGE + AUDIT_PAGE - 1);
  if (error) throw error;
  const who = pr => h(pr?.full_name || pr?.email || 'System / public form');
  body = tab === 'activity'
    ? data.map(l => `<tr><td>${new Date(l.created_at).toLocaleString()}</td><td>${who(l.profiles)}</td><td>${h(humanAction(l.action))}</td><td class="wrap">${h(describeLog(l))}</td><td class="wrap">${h([l.clients?.name, l.projects?.title].filter(Boolean).join(' · ') || '—')}</td></tr>`).join('')
    : data.map(l => `<tr><td>${new Date(l.created_at).toLocaleString()}</td><td>${who(l.profiles)}</td><td>${h(uaLabel(l.user_agent))}</td><td>${h(l.ip || '—')}</td><td>${l.new_device ? '<span class="badge red">New device</span> ' : ''}${l.new_ip ? '<span class="badge orange">New IP</span>' : ''}${l.new_device || l.new_ip ? '' : '—'}</td></tr>`).join('');
  const total = count || 0, first = total ? pg * AUDIT_PAGE + 1 : 0, last = Math.min(total, (pg + 1) * AUDIT_PAGE);
  const pager = `<div class="pager"><span class="sub-cell">${first}–${last} of ${total}</span>${pg > 0 ? `<a class="button" href="${href({ p: pg - 1 })}">← Newer</a>` : ''}${last < total ? `<a class="button" href="${href({ p: pg + 1 })}">Older →</a>` : ''}</div>`;
  content(tabs + panel(tab === 'activity' ? 'Activity' : 'Sign-ins', tab === 'activity' ? 'Every change made to business records, newest first. Entries cannot be edited or deleted.' : 'Admin and client sign-ins. “New device” means this browser had never signed in to the account before.', filter + tableHTML(headers, body, tab === 'activity' ? 'No matching activity.' : 'No sign-ins recorded yet. They appear after the next login (run supabase/features.sql first).') + pager));
}

/* ---------- boot ---------- */
function paintUser() {
  const name = state.profile.full_name || state.user.email;
  $('[data-user-name]').textContent = name;
  $('[data-avatar]').textContent = name.slice(0, 2).toUpperCase();
}
async function refresh() {
  try { await view.render(); }
  catch (error) { content(`<div class="panel"><p class="form-error">${h(error.message)}</p><p class="muted">Check that you applied <code>supabase/schema.sql</code>, <code>fixes.sql</code>, <code>upgrade.sql</code>, <code>security.sql</code> and <code>features.sql</code> and configured the project URL and key.</p></div>`); }
}
async function run() {
  if (localStorage.getItem('sd-theme') === 'dark') document.documentElement.classList.add('dark');
  layout();
  const auth = await requireUser(clientMode ? 'client' : 'admin');
  if (!auth) return;
  state.user = auth.user; state.profile = auth.profile;
  paintUser();
  const { data: biz } = await supabase.from('business_settings').select('*').eq('id', true).maybeSingle();
  state.biz = biz || {}; setCurrency(state.biz.currency);
  if (!clientMode) { try { await supabase.rpc('sync_invoice_statuses'); } catch (_) { /* optional until upgrade.sql is applied */ } try { await supabase.rpc('generate_reminders'); } catch (_) { /* optional until features.sql is applied */ } }
  refreshBell().catch(() => {}); setInterval(() => refreshBell().catch(() => {}), 60000);
  startIdleTimer();
  await refresh();
  mfaBanner();
}
async function mfaBanner() {
  if (clientMode || !['dashboard', 'settings'].includes(page)) return;
  try { const { data } = await supabase.auth.mfa.listFactors(); if (data?.totp?.length) return; } catch (_) { return; }
  $('#content').insertAdjacentHTML('beforebegin', '<div class="banner">🔐 Your admin account has no second sign-in step. <a href="../mfa.html">Set up two-step verification</a></div>');
}
// Sign out after 30 minutes without interaction (shared computers, forgotten tabs).
function startIdleTimer(limit = 30 * 60 * 1000) {
  let t;
  const reset = () => { clearTimeout(t); t = setTimeout(async () => { await supabase.auth.signOut(); location.href = `${clientMode ? '../client-login.html' : '../login.html'}?msg=idle`; }, limit); };
  ['click', 'keydown', 'pointerdown', 'scroll', 'visibilitychange'].forEach(ev => addEventListener(ev, reset, { passive: true }));
  reset();
}
run();
