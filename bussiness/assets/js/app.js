import { supabase } from './supabase.js';
import { requireUser, money, date, toast, escapeHTML as h, logActivity } from './common.js';

/* ---------- setup ---------- */
const clientMode = document.body.dataset.role === 'client';
const page = (location.pathname.split('/').pop() || '').replace(/\.html$/, '');
const params = new URLSearchParams(location.search);
const state = { user: null, profile: null };
const $ = s => document.querySelector(s);
const today = () => new Date().toLocaleDateString('en-CA');
const monthKey = d => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`; };
const sum = (arr, f) => arr.reduce((n, x) => n + Number(f(x) || 0), 0);
const clean = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'string' ? (v.trim() === '' ? null : v.trim()) : v]));

const PROJECT_STATUSES = ['New Enquiry', 'Quotation Sent', 'Awaiting Confirmation', 'Confirmed', 'In Progress', 'Internal Review', 'Client Review', 'Revision Requested', 'Approved', 'Ready for Delivery', 'Completed', 'On Hold', 'Cancelled'];
const FILE_CATEGORIES = ['References', 'Original Photos', 'Raw Videos', 'Design Files', 'Previews', 'Edited Videos', 'Final Deliverables', 'Documents', 'Invoices', 'Receipts'];
const QUOTE_STATUSES = ['Draft', 'Sent', 'Accepted', 'Declined', 'Expired'];

const navAdmin = [['Dashboard', 'dashboard.html', '◫'], ['Clients', 'clients.html', '♙'], ['Projects', 'projects.html', '▣'], ['Tasks', 'tasks.html', '✓'], ['Quotations', 'quotations.html', '▤'], ['Invoices', 'invoices.html', '▧'], ['Payments', 'payments.html', '＄'], ['Files', 'files.html', '⌁'], ['Messages', 'messages.html', '✉'], ['Reports', 'reports.html', '▥'], ['Settings', 'settings.html', '⚙']];
const navClient = [['Overview', 'client-dashboard.html', '◫'], ['My projects', 'client-projects.html', '▣'], ['Files', 'client-files.html', '⌁'], ['Invoices', 'client-invoices.html', '▧'], ['Messages', 'client-messages.html', '✉'], ['My profile', 'client-profile.html', '♙']];
const nav = clientMode ? navClient : navAdmin;
const parentPage = { 'client-details': 'clients', 'project-details': 'projects', 'invoice-details': 'invoices', 'client-project-details': 'client-projects', 'client-invoice-details': 'client-invoices' };

const VIEWS = {
  dashboard: { title: 'Dashboard', sub: 'Here’s what’s happening across your studio.', render: () => dashboard() },
  'client-dashboard': { title: 'Overview', sub: 'Your projects, updates and next steps.', render: () => dashboard() },
  clients: { title: 'Clients', sub: 'Manage relationships and keep every client detail in one place.', action: ['＋ New client', 'client'], render: () => clientsList() },
  'client-details': { title: 'Client', sub: 'Contact details, projects and portal access.', render: () => clientDetails() },
  projects: { title: 'Projects', sub: 'Track creative work from enquiry through final delivery.', action: ['＋ New project', 'project'], render: () => projectsList() },
  'project-details': { title: 'Project', sub: 'Status, tasks, files and conversation.', render: () => projectDetails() },
  tasks: { title: 'Tasks', sub: 'Keep the next actions and deadlines in view.', action: ['＋ New task', 'task'], render: () => tasksList() },
  quotations: { title: 'Quotations', sub: 'Prepare and follow up on project quotations.', action: ['＋ New quotation', 'quote'], render: () => quotationsList() },
  invoices: { title: 'Invoices', sub: 'Track billing and outstanding balances.', action: ['＋ New invoice', 'invoice'], render: () => invoicesList() },
  'invoice-details': { title: 'Invoice', sub: 'Line items, payments and balance.', render: () => invoiceDetails() },
  payments: { title: 'Payments', sub: 'Review verified receipts and payment history.', action: ['＋ Record payment', 'payment'], render: () => paymentsList() },
  files: { title: 'Files', sub: 'Project assets and client approved deliverables.', action: ['＋ Upload files', 'upload'], render: () => filesList() },
  messages: { title: 'Messages', sub: 'Project conversations in one place.', action: ['＋ New message', 'message'], render: () => messagesList() },
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
  const actionHtml = view.action ? `<button class="button primary" data-create="${view.action[1]}">${view.action[0]}</button>` : '';
  document.body.innerHTML = `<div class="app-shell"><aside class="sidebar"><a class="brand" href="${clientMode ? 'client-dashboard.html' : 'dashboard.html'}"><span class="brand-mark">S</span><span>StudioDesk<small>${clientMode ? 'CLIENT PORTAL' : 'CREATIVE OPERATIONS'}</small></span></a><div class="nav-label">${clientMode ? 'WORKSPACE' : 'MANAGE'}</div><nav>${nav.map(([label, url, icon]) => `<a class="nav-link ${active === url ? 'active' : ''}" href="${url}" title="${label}"><span class="nav-icon">${icon}</span><span>${label}</span></a>`).join('')}</nav><div class="sidebar-bottom"><div class="side-user"><span class="side-name"><b data-user-name>Loading…</b><br><span class="muted">${clientMode ? 'Client' : 'Administrator'}</span></span><button class="icon-btn" data-action="signout" title="Sign out">↗</button></div></div></aside><main class="main"><header class="topbar"><span class="crumb">${clientMode ? 'Client portal' : 'StudioDesk'}　/　<span id="crumb-title">${h(view.title)}</span></span><div class="top-actions"><button class="icon-btn" data-action="theme" title="Toggle theme">◐</button><span class="avatar" data-avatar>SD</span></div></header><section class="page-content"><div class="page-head"><div><p class="eyebrow">${clientMode ? 'YOUR WORKSPACE' : 'STUDIO OVERVIEW'}</p><h1 id="page-title">${h(view.title)}</h1><p id="page-sub">${h(view.sub)}</p></div><div id="page-action" class="head-actions">${actionHtml}</div></div><div id="content"><div class="empty">Loading your workspace…</div></div></section></main></div>`;
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
const must = ({ error }) => { if (error) throw error; };

/* ---------- ui helpers ---------- */
const statusClass = s => ['Completed', 'Paid', 'Approved', 'Accepted', 'Ready for Delivery'].includes(s) ? 'green' : ['Overdue', 'Cancelled', 'Declined', 'Void', 'Expired'].includes(s) ? 'red' : ['In Progress', 'Partially Paid', 'Client Review', 'Internal Review', 'Sent', 'Confirmed'].includes(s) ? 'blue' : ['On Hold', 'Pending', 'Awaiting Confirmation', 'Revision Requested'].includes(s) ? 'orange' : '';
const badge = s => `<span class="badge ${statusClass(s)}">${h(s)}</span>`;
const invStatus = i => (i.status === 'Pending' && i.due_date && i.due_date < today()) ? 'Overdue' : i.status;
const options = (list, selected) => list.map(o => `<option ${o === selected ? 'selected' : ''}>${h(o)}</option>`).join('');
const stat = (label, value, note, icon) => `<article class="stat-card"><div class="stat-top"><span>${label}</span><span class="stat-icon">${icon}</span></div><div class="stat-value">${value}</div><div class="stat-note">${note}</div></article>`;
const kv = (label, value) => `<div class="kv"><span>${label}</span><b>${value || '—'}</b></div>`;
const panel = (heading, sub, body, headExtra = '') => `<section class="panel"><div class="panel-head"><div><h2>${heading}</h2>${sub ? `<p>${sub}</p>` : ''}</div>${headExtra}</div>${body}</section>`;
const tableHTML = (headers, rowsHtml, empty) => `<div class="table-wrap"><table><thead><tr>${headers.map(x => `<th>${x}</th>`).join('')}</tr></thead><tbody>${rowsHtml || `<tr><td colspan="${headers.length}" class="empty">${empty}</td></tr>`}</tbody></table></div>`;
const back = (href, label) => `<a class="button" href="${href}">← ${label}</a>`;
const invNo = i => i.invoice_number ? `INV-${i.invoice_number}` : 'Draft';

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
  const income = sum(payments.filter(p => p.verified && p.paid_at && monthKey(p.paid_at) === month), p => p.amount);
  const stats = clientMode
    ? stat('Active projects', open.length, 'Currently underway', '▣') + stat('Completed projects', projects.filter(x => x.status === 'Completed').length, 'Ready in your history', '✓') + stat('Open invoices', live.filter(i => i.status !== 'Paid').length, 'Available to review', '▧') + stat('Outstanding balance', money(outstanding), 'Across your invoices', '＄')
    : stat('Total clients', clients.filter(x => !x.archived_at).length, 'In your client database', '♙') + stat('Active projects', open.length, 'Across your studio', '▣') + stat('Completed projects', projects.filter(x => x.status === 'Completed').length, 'In project history', '✓') + stat('Monthly income', money(income), 'Verified payments this month', '＄') + stat('Total invoiced', money(sum(live, i => i.total)), 'All non-void invoices', '▤') + stat('Outstanding', money(outstanding), 'Unpaid invoice balances', '◷') + stat('Pending projects', projects.filter(x => ['New Enquiry', 'Quotation Sent', 'Awaiting Confirmation'].includes(x.status)).length, 'Awaiting next step', '◌') + stat('Upcoming deadlines', open.filter(p => p.deadline && p.deadline >= today()).length, 'Open projects', '⌁');
  const link = id => `${clientMode ? 'client-' : ''}project-details.html?id=${id}`;
  const recent = (clientMode ? projects.filter(p => p.status !== 'Cancelled') : open).slice(0, 6).map(p => `<tr><td><a class="name-cell" href="${link(p.id)}">${h(p.title)}</a><div class="sub-cell">${h(p.category || 'Other')}</div></td><td>${badge(p.status)}</td><td>${date(p.deadline)}</td><td><div class="progress"><span style="width:${p.progress || 0}%"></span></div><div class="sub-cell">${p.progress || 0}%</div></td></tr>`).join('');
  const activities = projects.slice().sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 5).map(p => `<div class="activity"><span class="activity-dot"></span><span><b>${h(p.title)}</b> · ${h(p.status)}<time>${date(p.created_at)}</time></span></div>`).join('') || '<div class="empty">Your updates will appear here.</div>';
  content(`<div class="stats-grid">${stats}</div><div class="grid-two">${panel(clientMode ? 'Your projects' : 'Recent projects', 'Current progress and upcoming deadlines', tableHTML(['PROJECT', 'STATUS', 'DEADLINE', 'PROGRESS'], recent, 'No projects yet.'), `<a href="${clientMode ? 'client-projects.html' : 'projects.html'}">View all →</a>`)}${panel(clientMode ? 'Recent updates' : 'Revenue overview', clientMode ? 'Latest project activity' : 'Verified LKR payments · last six months', clientMode ? `<div class="activity-list">${activities}</div>` : revenueBars(payments))}</div>`);
}
async function reports() {
  const [projects, invoices, payments] = await Promise.all([q('projects', 'id,status'), q('invoices', 'id,status,total,due_date,clients(name)'), q('payments', 'invoice_id,amount,verified,paid_at')]);
  const count = (arr, f) => arr.reduce((m, x) => { const k = f(x); m[k] = (m[k] || 0) + 1; return m; }, {});
  const rowsOf = (obj, cls) => Object.entries(obj).map(([k, v]) => `<tr><td>${cls ? badge(k) : h(k)}</td><td>${v}</td></tr>`).join('');
  const live = invoices.filter(i => i.status !== 'Void');
  const byClient = {};
  live.forEach(i => { const n = i.clients?.name || 'Unknown'; byClient[n] = (byClient[n] || 0) + Number(i.total); });
  const top = Object.entries(byClient).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n, v]) => `<tr><td>${h(n)}</td><td>${money(v)}</td></tr>`).join('');
  content(`<div class="grid-two">${panel('Revenue overview', 'Verified LKR payments · last six months', revenueBars(payments))}${panel('Top clients', 'By invoiced total', tableHTML(['CLIENT', 'INVOICED'], top, 'No invoices yet.'))}</div><div class="grid-two">${panel('Projects by status', '', tableHTML(['STATUS', 'COUNT'], rowsOf(count(projects, p => p.status), true), 'No projects yet.'))}${panel('Invoices by status', '', tableHTML(['STATUS', 'COUNT'], rowsOf(count(invoices, invStatus), true), 'No invoices yet.'))}</div>`);
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
  content(dataTable({ headers: ['QUOTE', 'CLIENT', 'DATE', 'VALID UNTIL', 'TOTAL', 'STATUS'], rows, placeholder: 'Search quotations…', status: r => r.status, search: r => ['Q-' + r.quote_number, r.clients?.name].join(' '), row: r => `<tr><td class="name-cell">Q-${r.quote_number}</td><td>${h(r.clients?.name)}</td><td>${date(r.created_at)}</td><td>${date(r.valid_until)}</td><td>${money(r.total)}</td><td><select class="inline-select" data-change="quote-status" data-id="${r.id}">${options(QUOTE_STATUSES, r.status)}</select></td></tr>` }));
}
async function invoicesList() {
  const [rows, payments] = await Promise.all([q('invoices', '*,clients(name)', newest), q('payments', 'invoice_id,amount,verified')]);
  const { balance } = balances(rows, payments);
  const base = clientMode ? 'client-invoice-details.html' : 'invoice-details.html';
  content(dataTable({ headers: ['INVOICE', 'CLIENT', 'DATE', 'DUE', 'TOTAL', 'BALANCE', 'STATUS'], rows, placeholder: 'Search invoices…', status: invStatus, search: r => [invNo(r), r.clients?.name].join(' '), row: r => `<tr><td><a class="name-cell" href="${base}?id=${r.id}">${invNo(r)}</a></td><td>${h(r.clients?.name)}</td><td>${date(r.issue_date)}</td><td>${date(r.due_date)}</td><td>${money(r.total)}</td><td>${r.status === 'Void' ? '—' : money(balance(r))}</td><td>${badge(invStatus(r))}</td></tr>` }));
}
async function paymentsList() {
  const rows = await q('payments', '*,invoices(invoice_number,clients(name))', r => r.order('paid_at', { ascending: false }));
  content(dataTable({ headers: ['RECEIPT', 'INVOICE', 'CLIENT', 'DATE', 'METHOD', 'AMOUNT', 'STATUS'], rows, placeholder: 'Search payments…', status: r => r.verified ? 'Verified' : 'Pending', search: r => [r.invoices?.clients?.name, r.reference, r.method, 'INV-' + r.invoices?.invoice_number].join(' '), row: r => `<tr><td class="name-cell">${h(r.reference || r.id.slice(0, 8))}</td><td>${r.invoices ? `<a href="invoice-details.html?id=${r.invoice_id}">INV-${r.invoices.invoice_number}</a>` : '—'}</td><td>${h(r.invoices?.clients?.name)}</td><td>${date(r.paid_at)}</td><td>${h(r.method)}</td><td>${money(r.amount)}</td><td><span class="badge ${r.verified ? 'green' : 'orange'}">${r.verified ? 'Verified' : 'Pending'}</span></td></tr>` }));
}
function fileRows(rows, showProject = true) {
  return rows.map(r => `<tr><td class="name-cell">${h(r.name)}</td>${showProject ? `<td>${h(r.projects?.title)}</td>` : ''}<td>${h(r.category)}</td><td>${r.visible_to_client ? 'Client' : 'Admin only'}</td><td>${date(r.created_at)}</td><td class="row-actions"><button class="button" data-action="download" data-path="${h(r.storage_path)}" data-name="${h(r.name)}">Download</button>${clientMode ? '' : `<button class="button" data-action="toggle-visibility" data-id="${r.id}" data-visible="${r.visible_to_client}">${r.visible_to_client ? 'Hide' : 'Share'}</button><button class="button danger" data-action="delete-file" data-id="${r.id}" data-path="${h(r.storage_path)}">Delete</button>`}</td></tr>`).join('');
}
async function filesList() {
  const rows = await q('project_files', '*,projects(title)', newest);
  content(panel('Project files', 'Private files use expiring secure download links.', tableHTML(['FILE', 'PROJECT', 'CATEGORY', 'VISIBILITY', 'ADDED', ''], fileRows(rows), 'No project files yet.')));
}
async function messagesList() {
  const rows = await q('messages', '*,projects(title),profiles(full_name)', newest);
  content(panel('Conversations', 'Newest first', `<div class="activity-list">${rows.map(m => `<div class="activity"><span class="activity-dot"></span><span><b>${h(m.projects?.title || 'Project')} · ${m.sender_id === state.user.id ? 'You' : h(m.profiles?.full_name || (clientMode ? 'Studio team' : 'Client'))}</b><div class="msg-body">${h(m.body)}</div><time>${new Date(m.created_at).toLocaleString()}</time></span></div>`).join('') || '<div class="empty">No messages yet.</div>'}</div>`));
}

/* ---------- settings & profile ---------- */
async function settings() {
  const { data: s, error } = await supabase.from('business_settings').select('*').eq('id', true).maybeSingle();
  if (error) throw error;
  if (!s) { content('<div class="panel empty">No settings row found. Run <code>insert into public.business_settings(id) values(true);</code> in the SQL editor.</div>'); return; }
  const f = (name, label, type = 'text', extra = '') => `<label>${label}<input class="field" name="${name}" type="${type}" value="${h(s[name])}" ${extra}></label>`;
  content(panel('Business settings', 'Business name, currency, tax rate and payment terms.', `<div id="settings-form" class="form-grid">${f('business_name', 'Business name', 'text', 'required')}${f('currency', 'Currency')}${f('tax_rate', 'Tax rate (%)', 'number', 'step=".01" min="0"')}${f('payment_terms', 'Payment terms')}${f('email', 'Business email', 'email')}${f('phone', 'Business phone', 'tel')}<label class="wide">Address<textarea class="field" name="address">${h(s.address)}</textarea></label><div class="wide"><button class="button primary" data-action="save-settings">Save settings</button></div></div>`));
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
  setAction(`${back('clients.html', 'Clients')}<button class="button" data-action="archive-client" data-id="${c.id}" data-archived="${!!c.archived_at}">${c.archived_at ? 'Restore client' : 'Archive client'}</button><button class="button primary" data-create="project" data-client="${c.id}">＋ New project</button>`);
  const [projects, invoices, payments, links] = await Promise.all([q('projects', '*', r => r.eq('client_id', id).order('created_at', { ascending: false })), q('invoices', '*', r => r.eq('client_id', id).order('created_at', { ascending: false })), q('payments', 'invoice_id,amount,verified'), q('client_users', 'user_id,profiles(full_name,email)', r => r.eq('client_id', id))]);
  const { balance } = balances(invoices, payments);
  content(`<div class="grid-two">${panel('Contact', c.archived_at ? 'Archived' : 'Active client', `<div class="kvs">${kv('Email', h(c.email))}${kv('Phone', h(c.phone))}${kv('Business', h(c.business_name))}${kv('Address', h(c.address))}${kv('Registered', date(c.created_at))}</div>`)}${panel('Portal access', 'Let this client sign in to the client portal', `<div class="activity-list">${links.map(l => `<div class="activity"><span class="activity-dot"></span><span><b>${h(l.profiles?.full_name || l.profiles?.email)}</b><div class="sub-cell">${h(l.profiles?.email)}</div></span><button class="button danger small-btn" data-action="unlink" data-user="${l.user_id}" data-client="${id}">Remove</button></div>`).join('') || '<div class="empty">No portal account linked.</div>'}</div><div class="link-row"><input class="field" id="link-email" type="email" placeholder="Registered user's email"><button class="button primary" data-action="link-account" data-client="${id}">Link account</button></div><p class="sub-cell">Create the user first in Supabase → Authentication → Users, then link their email here.</p>`)}</div>${panel('Projects', '', tableHTML(['PROJECT', 'STATUS', 'DEADLINE', 'PROGRESS'], projects.map(p => `<tr><td><a class="name-cell" href="project-details.html?id=${p.id}">${h(p.title)}</a></td><td>${badge(p.status)}</td><td>${date(p.deadline)}</td><td>${p.progress}%</td></tr>`).join(''), 'No projects for this client yet.'))}${panel('Invoices', '', tableHTML(['INVOICE', 'DUE', 'TOTAL', 'BALANCE', 'STATUS'], invoices.map(i => `<tr><td><a class="name-cell" href="invoice-details.html?id=${i.id}">${invNo(i)}</a></td><td>${date(i.due_date)}</td><td>${money(i.total)}</td><td>${i.status === 'Void' ? '—' : money(balance(i))}</td><td>${badge(invStatus(i))}</td></tr>`).join(''), 'No invoices for this client yet.'))}`);
}
async function projectDetails() {
  const id = params.get('id');
  const p = id && await one('projects', '*,clients(name)', id);
  const listPage = clientMode ? 'client-projects.html' : 'projects.html';
  if (!p) { content(`<div class="panel empty">Project not found. ${back(listPage, 'Back to projects')}</div>`); return; }
  setHead(p.title, `P-${p.project_code} · ${p.clients?.name || ''}`);
  setAction(back(listPage, 'Projects') + (clientMode ? `<button class="button primary" data-create="message" data-project="${p.id}">＋ New message</button>` : `<button class="button" data-create="task" data-project="${p.id}">＋ Task</button><button class="button" data-create="upload" data-project="${p.id}">＋ Files</button><button class="button primary" data-create="message" data-project="${p.id}">＋ Message</button>`));
  const [tasks, files, msgs] = await Promise.all([q('project_tasks', '*', r => r.eq('project_id', id).order('created_at')), q('project_files', '*', r => r.eq('project_id', id).order('created_at', { ascending: false })), q('messages', '*,profiles(full_name)', r => r.eq('project_id', id).order('created_at', { ascending: false }))]);
  const controls = clientMode ? '' : `<div class="form-grid control-row"><label>Status<select class="field" data-change="project-status" data-id="${p.id}">${options(PROJECT_STATUSES, p.status)}</select></label><label>Progress (%)<span class="inline-row"><input class="field" id="progress-input" type="number" min="0" max="100" value="${p.progress}"><button class="button" data-action="set-progress" data-id="${p.id}">Update</button></span></label></div>`;
  content(`${panel('Overview', '', `<div class="kvs kv-wide">${kv('Status', badge(p.status))}${kv('Category', h(p.category))}${kv('Priority', h(p.priority))}${kv('Deadline', date(p.deadline))}${clientMode ? '' : kv('Agreed price', money(p.agreed_price))}${kv('Progress', `${p.progress}%`)}</div><div class="progress big"><span style="width:${p.progress}%"></span></div>${p.description ? `<p class="desc">${h(p.description)}</p>` : ''}${controls}`)}<div class="grid-two">${panel('Tasks', `${tasks.filter(t => t.completed).length} of ${tasks.length} complete`, tableHTML(['TASK', 'DUE', 'STATUS'], tasks.map(t => `<tr><td class="name-cell">${h(t.title)}</td><td>${date(t.due_date)}</td><td>${taskButton(t)}</td></tr>`).join(''), 'No tasks yet.'))}${panel('Messages', '', `<div class="activity-list">${msgs.map(m => `<div class="activity"><span class="activity-dot"></span><span><b>${m.sender_id === state.user.id ? 'You' : h(m.profiles?.full_name || (clientMode ? 'Studio team' : 'Client'))}</b><div class="msg-body">${h(m.body)}</div><time>${new Date(m.created_at).toLocaleString()}</time></span></div>`).join('') || '<div class="empty">No messages yet.</div>'}</div>`)}</div>${panel('Files', '', tableHTML(['FILE', 'CATEGORY', 'VISIBILITY', 'ADDED', ''], fileRows(files, false), 'No files yet.'))}`);
}
async function invoiceDetails() {
  const id = params.get('id');
  const i = id && await one('invoices', '*,clients(name,email,address),projects(title)', id);
  const listPage = clientMode ? 'client-invoices.html' : 'invoices.html';
  if (!i) { content(`<div class="panel empty">Invoice not found. ${back(listPage, 'Back to invoices')}</div>`); return; }
  const [items, payments, biz] = await Promise.all([q('invoice_items', '*', r => r.eq('invoice_id', id)), q('payments', '*', r => r.eq('invoice_id', id).order('paid_at')), supabase.from('business_settings').select('business_name,address,email,phone').eq('id', true).maybeSingle().then(r => r.data)]);
  const paid = sum(payments.filter(p => p.verified), p => p.amount), bal = Math.max(0, Number(i.total) - paid);
  setHead(invNo(i), i.clients?.name || '');
  setAction(back(listPage, 'Invoices') + `<button class="button" data-action="print">Print / PDF</button>` + (clientMode ? '' : (i.status === 'Void' ? `<button class="button" data-action="reopen-invoice" data-id="${i.id}" data-paid="${paid}" data-total="${i.total}">Reopen</button>` : `<button class="button danger" data-action="void-invoice" data-id="${i.id}">Void</button>${bal > 0 ? `<button class="button primary" data-create="payment" data-invoice="${i.id}">＋ Record payment</button>` : ''}`)));
  content(`<div class="panel invoice-sheet"><div class="inv-head"><div><h2>${h(biz?.business_name || 'StudioDesk')}</h2><p class="sub-cell">${h(biz?.address)}<br>${h(biz?.email)} ${h(biz?.phone)}</p></div><div class="inv-meta"><b>${invNo(i)}</b><div>${badge(invStatus(i))}</div><div class="sub-cell">Issued ${date(i.issue_date)} · Due ${date(i.due_date)}</div></div></div><div class="kvs kv-wide">${kv('Bill to', h(i.clients?.name))}${kv('Email', h(i.clients?.email))}${kv('Project', h(i.projects?.title))}${kv('Terms', h(i.payment_terms))}</div>${tableHTML(['DESCRIPTION', 'QTY', 'UNIT PRICE', 'AMOUNT'], items.map(x => `<tr><td>${h(x.description)}</td><td>${x.quantity}</td><td>${money(x.unit_price)}</td><td>${money(x.quantity * x.unit_price)}</td></tr>`).join(''), 'No line items.')}<div class="totals"><div><span>Subtotal</span><b>${money(i.subtotal)}</b></div>${Number(i.discount) ? `<div><span>Discount</span><b>−${money(i.discount)}</b></div>` : ''}${Number(i.tax_rate) ? `<div><span>Tax (${i.tax_rate}%)</span><b>${money(i.total - (i.subtotal - i.discount))}</b></div>` : ''}<div><span>Total</span><b>${money(i.total)}</b></div><div><span>Paid</span><b>${money(paid)}</b></div><div class="grand"><span>Balance due</span><b>${i.status === 'Void' ? '—' : money(bal)}</b></div></div></div>${panel('Payments', '', tableHTML(['DATE', 'METHOD', 'REFERENCE', 'AMOUNT', 'STATUS'], payments.map(p => `<tr><td>${date(p.paid_at)}</td><td>${h(p.method)}</td><td>${h(p.reference || '—')}</td><td>${money(p.amount)}</td><td><span class="badge ${p.verified ? 'green' : 'orange'}">${p.verified ? 'Verified' : 'Pending'}</span></td></tr>`).join(''), 'No payments recorded yet.'))}`);
}

/* ---------- modal forms ---------- */
const field = (name, label, type = 'text', required = true, extra = '') => `<label>${label}<input class="field" name="${name}" type="${type}" ${required ? 'required' : ''} ${extra}></label>`;
const sel = (name, label, first, required = true, wide = false) => `<label ${wide ? 'class="wide"' : ''}>${label}<select class="field" name="${name}" ${required ? 'required' : ''}><option value="">${first}</option></select></label>`;
const textarea = (name, label, required = false) => `<label class="wide">${label}<textarea class="field" name="${name}" ${required ? 'required' : ''}></textarea></label>`;

const FORMS = {
  client: { title: 'Add client', fields: () => field('name', 'Client name') + field('business_name', 'Business name', 'text', false) + field('email', 'Email', 'email') + field('phone', 'Contact number', 'tel', false) + textarea('address', 'Address') },
  project: { title: 'Create project', fields: () => field('title', 'Project title') + sel('client_id', 'Client', 'Choose a client') + `<label>Category<select class="field" name="category">${options(['Graphic Design', 'Photography', 'Videography', 'Video Editing', 'Social Media Design', 'Advertising Campaign', 'Other'])}</select></label><label>Deadline<input class="field" name="deadline" type="date"></label>` + field('agreed_price', 'Agreed price (LKR)', 'number', false, 'min="0" step=".01"') + `<label>Priority<select class="field" name="priority">${options(['Normal', 'Low', 'High', 'Urgent'])}</select></label>` + textarea('description', 'Description') },
  task: { title: 'New task', fields: () => sel('project_id', 'Project', 'Choose a project', true, true) + field('title', 'Task title') + field('due_date', 'Due date', 'date', false) },
  quote: { title: 'New quotation', fields: () => sel('client_id', 'Client', 'Choose a client') + sel('project_id', 'Project', 'No project linked', false) + field('description', 'Service description') + field('total', 'Quotation total (LKR)', 'number', true, 'min="0.01" step=".01"') + field('valid_until', 'Valid until', 'date', false) + textarea('notes', 'Notes') },
  invoice: { title: 'New invoice', fields: () => sel('client_id', 'Client', 'Choose a client') + sel('project_id', 'Project', 'No project linked', false) + field('description', 'Service description') + field('total', 'Invoice total (LKR)', 'number', true, 'min="0.01" step=".01"') + field('due_date', 'Due date', 'date') + field('payment_terms', 'Payment terms', 'text', false) },
  payment: { title: 'Record payment', fields: () => sel('invoice_id', 'Invoice', 'Choose an invoice', true, true) + field('amount', 'Amount (LKR)', 'number', true, 'min="0.01" step=".01"') + field('paid_on', 'Payment date', 'date', true, `value="${today()}"`) + `<label>Method<select class="field" name="method">${options(['Bank transfer', 'Cash', 'Card', 'Other'])}</select></label>` + field('reference', 'Reference', 'text', false) },
  message: { title: 'Send a project message', fields: () => sel('project_id', 'Project', 'Choose a project', true, true) + textarea('body', 'Message', true) },
  upload: { title: 'Upload files', fields: () => sel('project_id', 'Project', 'Choose a project', true, true) + `<label>Category<select class="field" name="category">${options(FILE_CATEGORIES, 'Documents')}</select></label><label class="check"><input type="checkbox" name="visible_to_client"> Visible to client</label><label class="wide">Files<input class="field" name="files" type="file" multiple required></label>` }
};

const SUBMIT = {
  async client(d) { d.email = d.email.toLowerCase(); must(await supabase.from('clients').insert(clean(d))); await logActivity('Created client', { name: d.name }); },
  async project(d) { const row = clean(d); row.agreed_price = Number(d.agreed_price || 0); must(await supabase.from('projects').insert(row)); await logActivity('Created project', { title: d.title }); },
  async task(d) { must(await supabase.from('project_tasks').insert(clean(d))); },
  async quote(d) {
    const total = Number(d.total);
    const { data: qt, error } = await supabase.from('quotations').insert({ client_id: d.client_id, project_id: d.project_id || null, subtotal: total, total, valid_until: d.valid_until || null, notes: d.notes?.trim() || null }).select().single();
    if (error) throw error;
    const r = await supabase.from('quotation_items').insert({ quotation_id: qt.id, description: d.description, quantity: 1, unit_price: total });
    if (r.error) { await supabase.from('quotations').delete().eq('id', qt.id); throw r.error; }
    await logActivity('Created quotation', { id: qt.id });
  },
  async invoice(d) {
    const total = Number(d.total);
    const { data: inv, error } = await supabase.from('invoices').insert({ client_id: d.client_id, project_id: d.project_id || null, subtotal: total, total, due_date: d.due_date, payment_terms: d.payment_terms?.trim() || null, created_by: state.user.id }).select().single();
    if (error) throw error;
    const r = await supabase.from('invoice_items').insert({ invoice_id: inv.id, description: d.description, quantity: 1, unit_price: total });
    if (r.error) { await supabase.from('invoices').delete().eq('id', inv.id); throw r.error; }
    await logActivity('Created invoice', { id: inv.id });
  },
  async payment(d, form) {
    const amount = Number(d.amount), balance = Number(form.querySelector('[name=invoice_id] option:checked')?.dataset.balance ?? Infinity);
    if (!(amount > 0)) throw new Error('Enter an amount greater than zero.');
    if (amount > balance + 0.005) throw new Error(`Amount exceeds the remaining balance (${money(balance)}).`);
    must(await supabase.from('payments').insert({ invoice_id: d.invoice_id, amount, method: d.method, reference: d.reference?.trim() || null, verified: true, recorded_by: state.user.id, paid_at: new Date(`${d.paid_on}T12:00:00`).toISOString() }));
    await logActivity('Recorded payment', { invoice_id: d.invoice_id, amount });
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
      await SUBMIT[kind](d, form);
      backdrop.remove(); toast('Saved successfully'); await refresh();
    } catch (error) { err.textContent = error.message; save.disabled = false; save.textContent = 'Save'; }
  });
  form.querySelector('input,select,textarea')?.focus();
}

/* ---------- actions (event delegation: survives every re-render) ---------- */
const ACTIONS = {
  async signout() { await supabase.auth.signOut(); location.href = clientMode ? '../client-login.html' : '../login.html'; },
  theme() { document.documentElement.classList.toggle('dark'); localStorage.setItem('sd-theme', document.documentElement.classList.contains('dark') ? 'dark' : 'light'); },
  print() { window.print(); },
  async 'toggle-task'(el) { must(await supabase.from('project_tasks').update({ completed: el.dataset.done !== 'true' }).eq('id', el.dataset.id)); await refresh(); },
  async download(el) { const { data, error } = await supabase.storage.from('project-files').createSignedUrl(el.dataset.path, 120, { download: el.dataset.name }); if (error) throw error; location.href = data.signedUrl; },
  async 'toggle-visibility'(el) { must(await supabase.from('project_files').update({ visible_to_client: el.dataset.visible !== 'true' }).eq('id', el.dataset.id)); await refresh(); },
  async 'delete-file'(el) { if (!confirm('Delete this file permanently?')) return; must(await supabase.from('project_files').delete().eq('id', el.dataset.id)); await supabase.storage.from('project-files').remove([el.dataset.path]); toast('File deleted'); await refresh(); },
  async 'archive-client'(el) { must(await supabase.from('clients').update({ archived_at: el.dataset.archived === 'true' ? null : new Date().toISOString() }).eq('id', el.dataset.id)); await refresh(); },
  async 'link-account'(el) {
    const email = $('#link-email').value.trim().toLowerCase(); if (!email) return toast('Enter the user’s email.');
    const { data: prof, error } = await supabase.from('profiles').select('id,role').ilike('email', email).maybeSingle(); if (error) throw error;
    if (!prof) return toast('No registered user with that email. Create them in Supabase → Authentication → Users first.');
    if (prof.role !== 'client') return toast('That user is an admin, not a client account.');
    must(await supabase.from('client_users').insert({ client_id: el.dataset.client, user_id: prof.id })); toast('Account linked'); await refresh();
  },
  async unlink(el) { if (!confirm('Remove this portal access?')) return; must(await supabase.from('client_users').delete().eq('client_id', el.dataset.client).eq('user_id', el.dataset.user)); await refresh(); },
  async 'void-invoice'(el) { if (!confirm('Void this invoice?')) return; must(await supabase.from('invoices').update({ status: 'Void' }).eq('id', el.dataset.id)); await refresh(); },
  async 'reopen-invoice'(el) { const paid = Number(el.dataset.paid), total = Number(el.dataset.total); const status = paid >= total && total > 0 ? 'Paid' : paid > 0 ? 'Partially Paid' : 'Pending'; must(await supabase.from('invoices').update({ status }).eq('id', el.dataset.id)); await refresh(); },
  async 'set-progress'(el) { const v = Math.round(Number($('#progress-input').value)); if (!(v >= 0 && v <= 100)) return toast('Progress must be between 0 and 100.'); must(await supabase.from('projects').update({ progress: v }).eq('id', el.dataset.id)); toast('Progress updated'); await refresh(); },
  async 'save-settings'() {
    const values = Object.fromEntries([...document.querySelectorAll('#settings-form [name]')].map(i => [i.name, i.value.trim() === '' && i.name !== 'business_name' && i.name !== 'currency' ? null : i.value.trim()]));
    values.tax_rate = Number(values.tax_rate || 0); values.updated_at = new Date().toISOString();
    if (!values.business_name) return toast('Business name is required.');
    must(await supabase.from('business_settings').update(values).eq('id', true)); toast('Settings saved');
  },
  async 'save-profile'() {
    const name = $('#profile-name').value.trim();
    must(await supabase.from('profiles').update({ full_name: name }).eq('id', state.user.id)); state.profile.full_name = name; paintUser(); toast('Profile saved');
  }
};
const CHANGES = {
  async 'quote-status'(el) { must(await supabase.from('quotations').update({ status: el.value }).eq('id', el.dataset.id)); toast('Quotation updated'); },
  async 'project-status'(el) { must(await supabase.from('projects').update({ status: el.value, updated_at: new Date().toISOString() }).eq('id', el.dataset.id)); toast('Status updated'); await refresh(); }
};
const guard = fn => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message || 'Something went wrong'); } };
document.addEventListener('click', guard(async e => {
  const create = e.target.closest('[data-create]');
  if (create) { const d = create.dataset; return showModal(d.create, { client_id: d.client, project_id: d.project, invoice_id: d.invoice }); }
  const el = e.target.closest('[data-action]');
  if (el && ACTIONS[el.dataset.action]) { el.disabled = true; try { await ACTIONS[el.dataset.action](el); } finally { el.disabled = false; } }
}));
document.addEventListener('change', guard(async e => {
  if (e.target.id === 'table-filter') applyFilter();
  const el = e.target.closest('[data-change]'); if (el && CHANGES[el.dataset.change]) await CHANGES[el.dataset.change](el);
}));
document.addEventListener('input', e => { if (e.target.id === 'table-search') applyFilter(); });

/* ---------- boot ---------- */
function paintUser() {
  const name = state.profile.full_name || state.user.email;
  $('[data-user-name]').textContent = name;
  $('[data-avatar]').textContent = name.slice(0, 2).toUpperCase();
}
async function refresh() {
  try { await view.render(); }
  catch (error) { content(`<div class="panel"><p class="form-error">${h(error.message)}</p><p class="muted">Check that you applied <code>supabase/schema.sql</code> (and <code>supabase/fixes.sql</code> if you set up the database earlier) and configured the project URL and key.</p></div>`); }
}
async function run() {
  if (localStorage.getItem('sd-theme') === 'dark') document.documentElement.classList.add('dark');
  layout();
  const auth = await requireUser(clientMode ? 'client' : 'admin');
  if (!auth) return;
  state.user = auth.user; state.profile = auth.profile;
  paintUser();
  await refresh();
}
run();
