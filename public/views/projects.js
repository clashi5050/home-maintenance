// Needs (things to buy) and projects (bigger jobs), with quote comparison.
import {
  $, api, app, cap, ctx, esc, fmtDate, money, openDialog, openForm, pill, plural, requestServiceDialog, toast, vendorLine, vendorOptions,
  DELETE_BUTTON, wireDelete,
} from '../lib.js';

const STATUS_LABEL = { idea: 'Idea', planned: 'Planned', in_progress: 'In progress', done: 'Done' };
const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };
const STATUS_RANK = { in_progress: 0, planned: 1, idea: 2, done: 3 };

let kind = 'need';
let statusFilter = 'open';
let cache = [];

const taskFields = () => [
  { name: 'kind', label: 'Type', type: 'select', options: [['need', 'Need (something to buy)'], ['project', 'Project']] },
  { name: 'title', label: 'Title', required: true },
  { name: 'priority', label: 'Priority', type: 'select', options: [['high', 'High'], ['medium', 'Medium'], ['low', 'Low']], default: 'medium' },
  { name: 'status', label: 'Status', type: 'select', options: Object.entries(STATUS_LABEL), default: 'idea' },
  { name: 'estimated_cost', label: 'Estimated cost ($)', type: 'number', step: '0.01' },
  { name: 'actual_cost', label: 'Actual cost ($)', type: 'number', step: '0.01', hint: 'Counts toward this year\'s budget once completed' },
  { name: 'completed_on', label: 'Completed on', type: 'date', hint: 'Filled in automatically when marked done' },
  { name: 'vendor_id', label: 'Vendor', type: 'select', options: vendorOptions() },
  { name: 'notes', label: 'Notes', full: true },
];

function taskCard(t) {
  return `<article class="item">
    <div class="item-top"><div class="item-name">${esc(t.title)}</div>${pill(t.priority, cap(t.priority))}</div>
    <div class="meta">
      ${t.estimated_cost != null ? `<span>Est. <strong>${money(t.estimated_cost)}</strong></span>` : ''}
      ${t.quote_count ? `<span>Lowest quote <strong>${money(t.lowest_quote)}</strong> of ${t.quote_count}</span>` : ''}
      ${t.actual_cost != null ? `<span>Actual <strong>${money(t.actual_cost)}</strong></span>` : ''}
      ${t.completed_on ? `<span>Done ${fmtDate(t.completed_on)}</span>` : ''}
      ${t.vendor_name ? vendorLine(t.vendor_name, t.vendor_phone) : ''}
    </div>
    ${t.notes ? `<div class="notes">${esc(t.notes)}</div>` : ''}
    <div class="actions">
      <select class="inline-select" data-status="${t.id}" aria-label="Status for ${esc(t.title)}">${Object.entries(STATUS_LABEL).map(([v, l]) => `<option value="${v}"${v === t.status ? ' selected' : ''}>${l}</option>`).join('')}</select>
      <button class="btn sm" data-action="quotes" data-id="${t.id}">Quotes${t.quote_count ? ` (${t.quote_count})` : ''}</button>
      <button class="btn sm" data-action="edit-task" data-id="${t.id}">Edit</button>
      <details class="menu"><summary class="btn sm">More</summary><div class="menu-list">
        <button data-action="open-docs" data-field="task_id" data-link="${t.id}" data-title="Documents: ${esc(t.title)}" data-category="contract">Documents${t.doc_count ? ` (${t.doc_count})` : ''}</button>
        <button data-action="request-quote" data-id="${t.id}">Request a quote</button>
      </div></details>
    </div>
  </article>`;
}

export async function render() {
  cache = await api('GET', '/api/tasks');
  const ofKind = cache.filter((t) => t.kind === kind);
  const shown = ofKind
    .filter((t) => (statusFilter === 'open' ? t.status !== 'done' : statusFilter === 'all' ? true : t.status === statusFilter))
    .sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.title.localeCompare(b.title));
  const total = shown.reduce((sum, t) => sum + (t.status === 'done' ? (t.actual_cost ?? 0) : (t.estimated_cost ?? 0)), 0);
  const label = kind === 'need' ? 'Needs' : 'Projects';
  const filters = [['open', 'Open'], ['idea', 'Idea'], ['planned', 'Planned'], ['in_progress', 'In progress'], ['done', 'Done'], ['all', 'All']];
  const open = (k) => cache.filter((t) => t.kind === k && t.status !== 'done').length;

  app.innerHTML = `
    <div class="page-head"><div><h1>Needs &amp; Projects</h1><p class="sub">Things to buy and bigger jobs, with priority, status, quotes and cost.</p></div><button class="btn primary" data-action="add-task">Add ${kind === 'need' ? 'need' : 'project'}</button></div>
    <div class="page-head">
      <div class="seg" role="group" aria-label="Type"><button data-action="task-kind" data-kind="need" aria-pressed="${kind === 'need'}">Needs (${open('need')})</button><button data-action="task-kind" data-kind="project" aria-pressed="${kind === 'project'}">Projects (${open('project')})</button></div>
      <span class="muted small">${plural(shown.length, label.slice(0, -1).toLowerCase())} · ${money(total)} total</span>
    </div>
    <div class="chips">${filters.map(([v, l]) => `<button class="chip" data-action="task-filter" data-filter="${v}" aria-pressed="${statusFilter === v}">${l}</button>`).join('')}</div>
    <div class="grid">${shown.map(taskCard).join('') || `<div class="card empty" style="grid-column:1/-1">No ${label.toLowerCase()} here.</div>`}</div>`;
}

function addTask() {
  openForm({ title: `Add ${kind === 'need' ? 'need' : 'project'}`, fields: taskFields(), values: { kind, priority: 'medium', status: 'idea' }, onSubmit: async (d) => { await api('POST', '/api/tasks', d); toast('Added'); ctx.render(); } });
}

function editTask(id) {
  const t = cache.find((x) => x.id === id);
  const dlg = openForm({
    title: `Edit ${t.kind}`, fields: taskFields(), values: t, extraActions: DELETE_BUTTON,
    onSubmit: async (d) => { await api('PUT', `/api/tasks/${id}`, d); toast('Saved'); ctx.render(); },
  });
  wireDelete(dlg, { confirmText: `Delete "${t.title}" and its quotes?`, url: `/api/tasks/${id}` });
}

// ---- Quotes ---------------------------------------------------------------------

async function quotesDialog(taskId) {
  const t = cache.find((x) => x.id === taskId);
  const dlg = openDialog('<div class="form"><h2></h2><div class="quotes stack"></div><div class="actions"><button class="btn" data-add-quote>Add a quote</button><button class="btn primary" data-close>Done</button></div></div>', { wide: true });
  $('h2', dlg).textContent = `Quotes: ${t.title}`;
  const listEl = $('.quotes', dlg);
  dlg.addEventListener('close', () => ctx.render());
  dlg.addEventListener('click', (e) => { if (e.target === dlg || e.target.closest('[data-close]')) ctx.render(); });

  const refresh = async () => {
    const quotes = await api('GET', `/api/quotes?task_id=${taskId}`);
    const lowest = Math.min(...quotes.filter((q) => q.status !== 'declined').map((q) => q.amount));
    listEl.innerHTML = quotes.map((q) => `<div class="history-row quote ${q.status}">
      <div><strong>${esc(q.vendor_name ?? 'Unnamed contractor')}</strong>${q.vendor_phone ? ` · <a href="tel:${esc(q.vendor_phone.replace(/[^\d+]/g, ''))}">${esc(q.vendor_phone)}</a>` : ''}
        <div class="small muted">${[q.quote_date && fmtDate(q.quote_date), q.notes].filter(Boolean).map(esc).join(' · ') || '&nbsp;'}</div>
        <div class="actions" style="margin-top:6px">${q.status === 'pending' ? `<button class="btn sm primary" data-accept="${q.id}">Accept</button>` : ''}<button class="btn sm danger" data-del-quote="${q.id}">Delete</button></div></div>
      <div class="quote-side"><div class="num"><strong>${money(q.amount)}</strong></div>${q.status === 'accepted' ? pill('done', 'Accepted') : q.status === 'declined' ? pill('none', 'Declined') : q.amount === lowest && quotes.length > 1 ? pill('upcoming', 'Lowest') : ''}</div></div>`).join('')
      || '<div class="empty">No quotes yet. Add the ones you collect to compare them side by side.</div>';
  };
  await refresh();

  dlg.addEventListener('click', async (e) => {
    try {
      if (e.target.closest('[data-add-quote]')) {
        openForm({
          title: 'Add a quote', submit: 'Add',
          fields: [
            { name: 'vendor_id', label: 'Contractor', type: 'select', options: vendorOptions(), hint: 'Add them under Vendors first if they are not listed.' },
            { name: 'amount', label: 'Amount ($)', type: 'number', step: '0.01', required: true },
            { name: 'quote_date', label: 'Quote date', type: 'date' },
            { name: 'notes', label: 'What it includes' },
          ],
          onSubmit: async (d) => { await api('POST', '/api/quotes', { ...d, task_id: taskId }); await refresh(); },
        });
      }
      const accept = e.target.closest('[data-accept]');
      if (accept) { await api('POST', `/api/quotes/${accept.dataset.accept}/accept`); toast('Quote accepted. The project now uses this price and contractor.'); await refresh(); }
      const del = e.target.closest('[data-del-quote]');
      if (del && confirm('Delete this quote?')) { await api('DELETE', `/api/quotes/${del.dataset.delQuote}`); await refresh(); }
    } catch (err) { toast(err.message, true); }
  });
}

function requestQuote(id) {
  const t = cache.find((x) => x.id === id);
  return requestServiceDialog({
    subject: `Quote request: ${t.title}`,
    vendorId: t.vendor_id,
    lines: [`I'm looking for a quote for: ${t.title}.`, t.notes ? `Details: ${t.notes}` : '', t.estimated_cost != null ? `My rough budget is ${money(t.estimated_cost)}.` : ''].filter(Boolean),
  });
}

export const actions = {
  'add-task': addTask,
  'edit-task': editTask,
  quotes: quotesDialog,
  'request-quote': requestQuote,
  'task-kind': (_id, data) => { kind = data.kind; ctx.render(); },
  'task-filter': (_id, data) => { statusFilter = data.filter; ctx.render(); },
};

/** Inline status dropdown on each card. */
document.addEventListener('change', async (e) => {
  if (!e.target.matches('[data-status]')) return;
  try {
    await api('PUT', `/api/tasks/${e.target.dataset.status}`, { status: e.target.value });
    toast(`Marked ${STATUS_LABEL[e.target.value].toLowerCase()}`);
  } catch (err) { toast(err.message, true); }
  ctx.render();
});

