// Recurring maintenance: the list, the 12-month planner, and everything you can do to an item.
import {
  MONTHS, api, app, applianceOptions, copyText, ctx, esc, fmtDate, money, openDialog, openForm, pill, plural,
  requestServiceDialog, state, todayStr, toast, uploadFile, vendorLine, vendorOptions, DELETE_BUTTON, wireDelete,
} from '../lib.js';

let mode = 'list';
let cache = [];
export const setCache = (items) => { cache = items; };

const STATUS_LABEL = { overdue: 'Overdue', due: 'Due', upcoming: 'Upcoming', ok: 'On track', unscheduled: 'Unscheduled', snoozed: 'Snoozed' };

function dueText(m) {
  switch (m.status) {
    case 'overdue': return `Overdue · was due ${m.due_label}`;
    case 'due': return m.anchored ? `Due this month · ${m.due_label}` : 'Due today';
    case 'upcoming': return `Due ${m.due_label} · in ${plural(m.days_until, 'day')}`;
    case 'snoozed': return `Snoozed until ${fmtDate(m.snoozed_until)} · ${m.base_status === 'overdue' ? 'was due' : 'due'} ${m.due_label}`;
    case 'unscheduled': return 'No service month set';
    default: return `Next: ${m.due_label}`;
  }
}

export function maintenanceCard(m, { compact = false } = {}) {
  const interval = m.interval_months === 12 ? 'Yearly' : `Every ${plural(m.interval_months, 'month')}`;
  const snoozeAction = m.status === 'snoozed'
    ? `<button class="btn sm" data-action="unsnooze-maint" data-id="${m.id}">Unsnooze</button>`
    : `<button class="btn sm" data-action="snooze-maint" data-id="${m.id}">Snooze</button>`;

  return `<article class="item ${m.status}">
    <div class="item-top">
      <div><div class="item-name">${esc(m.name)}</div><div class="small ${m.status === 'overdue' ? '' : 'muted'}">${esc(dueText(m))}</div></div>
      ${pill(m.status, STATUS_LABEL[m.status])}
    </div>
    <div class="meta">
      ${m.vendor_name ? vendorLine(m.vendor_name, m.vendor_phone) : ''}
      ${m.appliance_name ? `<span>For <strong>${esc(m.appliance_name)}</strong></span>` : ''}
      ${m.estimated_cost != null ? `<span>Est. <strong>${money(m.estimated_cost)}</strong></span>` : ''}
      ${compact ? '' : `<span>${interval}${m.service_month ? ` · ${MONTHS[m.service_month - 1]}` : ''}</span>`}
      ${m.last_done ? `<span>Last done <strong>${fmtDate(m.last_done)}</strong>${m.last_cost != null ? ` · ${money(m.last_cost)}` : ''}</span>` : '<span>Never logged</span>'}
    </div>
    ${!compact && m.notes ? `<div class="notes">${esc(m.notes)}</div>` : ''}
    <div class="actions">
      <button class="btn sm primary" data-action="done-maint" data-id="${m.id}">Mark done</button>
      ${compact ? snoozeAction : `<button class="btn sm" data-action="edit-maint" data-id="${m.id}">Edit</button>
      <details class="menu"><summary class="btn sm">More</summary><div class="menu-list">
        <button data-action="hist-maint" data-id="${m.id}">History</button>
        <button data-action="open-docs" data-id="${m.id}" data-field="item_id" data-link="${m.id}" data-title="Documents: ${esc(m.name)}">Documents${m.doc_count ? ` (${m.doc_count})` : ''}</button>
        <button data-action="${m.status === 'snoozed' ? 'unsnooze-maint' : 'snooze-maint'}" data-id="${m.id}">${m.status === 'snoozed' ? 'Unsnooze' : 'Snooze reminders'}</button>
        <button data-action="request-maint" data-id="${m.id}">Request service</button>
      </div></details>`}
    </div>
  </article>`;
}

const maintFields = () => [
  { name: 'name', label: 'What needs doing', required: true, full: true },
  { name: 'service_month', label: 'Service month', type: 'select', options: [['', '— not set —'], ...MONTHS.map((m, i) => [i + 1, m])] },
  { name: 'interval_months', label: 'Repeat every (months)', type: 'number', step: 1, min: 1, default: 12, hint: '12 = yearly' },
  { name: 'vendor_id', label: 'Vendor', type: 'select', options: vendorOptions() },
  { name: 'appliance_id', label: 'Appliance or system', type: 'select', options: applianceOptions() },
  { name: 'estimated_cost', label: 'Estimated cost ($)', type: 'number', step: '0.01' },
  { name: 'category', label: 'Category', placeholder: 'e.g. HVAC' },
  { name: 'notes', label: 'Notes' },
];

// ---- List ---------------------------------------------------------------------

const modeToggle = () => `<div class="seg" role="group" aria-label="View">
  <button data-action="maint-mode" data-mode="list" aria-pressed="${mode === 'list'}">List</button>
  <button data-action="maint-mode" data-mode="planner" aria-pressed="${mode === 'planner'}">Year planner</button></div>`;

async function renderList() {
  cache = await api('GET', '/api/maintenance');
  const groups = [
    ['Overdue', 'overdue'], ['Due now', 'due'], ['Coming up', 'upcoming'], ['Later', 'ok'], ['Snoozed', 'snoozed'], ['Not scheduled yet', 'unscheduled'],
  ].map(([label, status]) => [label, cache.filter((m) => m.status === status)]).filter(([, items]) => items.length);

  app.innerHTML = `
    <div class="page-head"><div><h1>Maintenance</h1><p class="sub">Recurring upkeep. Mark items done to log the cost and reset the schedule.</p></div>
      <div class="head-actions">${modeToggle()}<button class="btn primary" data-action="add-maint">Add item</button></div></div>
    ${groups.length
    ? groups.map(([label, items]) => `<h2 class="group-title">${label} <span class="muted small">${items.length}</span></h2><div class="grid">${items.map((m) => maintenanceCard(m)).join('')}</div>`).join('')
    : `<div class="card empty">No maintenance items yet. <a href="#/suggestions">Browse suggestions</a> or add your own.</div>`}`;
}

// ---- Planner ------------------------------------------------------------------

function plannerEvent(e) {
  if (e.type === 'warranty') return `<li class="ev warranty"><span>${esc(e.name)}</span><span class="muted small">${fmtDate(e.date)}</span></li>`;
  if (e.type === 'replace') return `<li class="ev replace"><span>${esc(e.name)}</span><span class="muted small">plan ahead</span></li>`;
  return `<li class="ev${e.overdue ? ' overdue' : ''}"><span>${esc(e.name)}${e.overdue ? ' <span class="pill overdue">Overdue</span>' : ''}</span>
    <span class="num small">${e.cost != null ? money(e.cost) : ''}</span></li>`;
}

async function renderPlanner() {
  const plan = await api('GET', '/api/planner');
  const feed = `${location.origin}/api/calendar.ics`;
  const webcal = feed.replace(/^https?:/, 'webcal:');
  const busiest = Math.max(...plan.months.map((m) => m.total), 1);

  app.innerHTML = `
    <div class="page-head"><div><h1>Maintenance</h1><p class="sub">The next 12 months of work, and what it should cost.</p></div>
      <div class="head-actions">${modeToggle()}</div></div>
    <section class="card cal-card">
      <div><strong>Estimated maintenance spend, next 12 months:</strong> <span class="num big-inline">${money(plan.total)}</span></div>
      <details class="cal-sub"><summary>Show these dates in your phone's calendar</summary>
        <p class="muted small">Subscribe to this address in Google Calendar, Apple Calendar or Outlook. It stays up to date as you make changes. It works while your phone is on the same network as the server.</p>
        <div class="copy-row"><input readonly value="${esc(feed)}" aria-label="Calendar feed address"><button class="btn sm" data-action="copy-feed" data-feed="${esc(feed)}">Copy</button><a class="btn sm" href="${esc(webcal)}">Subscribe</a></div>
      </details>
    </section>
    <div class="months">${plan.months.map((mo) => `<section class="card month${mo.items.length ? '' : ' quiet'}">
      <h3>${esc(mo.label)}${mo.total ? `<span class="num">${money(mo.total)}</span>` : ''}</h3>
      ${mo.total ? `<div class="bar thin" aria-hidden="true"><span style="width:${(mo.total / busiest) * 100}%"></span></div>` : ''}
      ${mo.items.length ? `<ul class="ev-list">${mo.items.map(plannerEvent).join('')}</ul>` : '<p class="muted small">Nothing scheduled.</p>'}
    </section>`).join('')}</div>`;
}

export const render = () => (mode === 'planner' ? renderPlanner() : renderList());

// ---- Actions --------------------------------------------------------------------

const find = (id) => cache.find((x) => x.id === id);

function addMaint() {
  openForm({ title: 'Add maintenance item', fields: maintFields(), values: { interval_months: 12 }, onSubmit: async (d) => { await api('POST', '/api/maintenance', d); toast('Added'); ctx.render(); } });
}

function editMaint(id) {
  const m = find(id);
  const dlg = openForm({
    title: 'Edit maintenance item', fields: maintFields(), values: m, extraActions: DELETE_BUTTON,
    onSubmit: async (d) => { await api('PUT', `/api/maintenance/${id}`, d); toast('Saved'); ctx.render(); },
  });
  wireDelete(dlg, { confirmText: `Delete "${m.name}" and its service history?`, url: `/api/maintenance/${id}` });
}

function doneMaint(id) {
  const m = find(id);
  openForm({
    title: `Mark done: ${m.name}`,
    intro: 'This is saved to your log and moves the next due date forward. Use an earlier date to log past work.',
    fields: [
      { name: 'done_on', label: 'Date done', type: 'date', required: true, default: todayStr() },
      { name: 'cost', label: 'What it cost ($)', type: 'number', step: '0.01' },
      { name: 'vendor_id', label: 'Done by', type: 'select', options: vendorOptions() },
      { name: 'diy', label: 'I did it myself', type: 'checkbox' },
      { name: 'notes', label: 'Notes', full: true },
      { name: 'receipt', label: 'Attach a receipt or photo (optional)', type: 'file', accept: state.meta.upload_extensions.join(','), full: true },
    ],
    values: { done_on: todayStr(), cost: m.estimated_cost, vendor_id: m.vendor_id },
    onSubmit: async ({ receipt, ...d }) => {
      const { completion_id: completionId, item } = await api('POST', `/api/maintenance/${id}/complete`, d);
      let message = `Logged. Next due ${item.due_label ?? 'not scheduled'}`;
      if (receipt) {
        try { await uploadFile(receipt, { category: 'receipt', completion_id: completionId, item_id: id }); } catch (err) { message = `Logged, but the file was not saved: ${err.message}`; }
      }
      toast(message);
      ctx.render();
    },
  });
}

function snooze(id) {
  const m = find(id);
  openForm({
    title: `Snooze: ${m.name}`,
    intro: 'Hides this item from your dashboard and stops reminders until the date. It still counts as overdue in your Home Score, and marking it done clears the snooze.',
    submit: 'Snooze',
    fields: [{ name: 'days', label: 'Snooze for', type: 'select', full: true, options: [['7', '1 week'], ['14', '2 weeks'], ['30', '1 month'], ['90', '3 months']], default: '14' }],
    onSubmit: async ({ days }) => {
      const d = new Date();
      d.setDate(d.getDate() + Number(days));
      const until = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      await api('PUT', `/api/maintenance/${id}`, { snoozed_until: until });
      toast(`Snoozed until ${fmtDate(until)}`);
      ctx.render();
    },
  });
}

async function unsnooze(id) {
  await api('PUT', `/api/maintenance/${id}`, { snoozed_until: null });
  toast('Reminders back on');
  ctx.render();
}

async function histMaint(id) {
  const m = find(id);
  const { entries } = await api('GET', `/api/history?item=${id}`);
  openDialog(`<div class="form"><h2>${esc(m.name)} history</h2>
    <div class="history-list">${entries.length ? entries.map((e) => `<div class="history-row"><div><strong>${fmtDate(e.done_on)}</strong>
      <div class="small muted">${[e.diy ? 'Did it myself' : e.vendor_name, e.notes].filter(Boolean).map(esc).join(' · ') || '&nbsp;'}</div></div>
      <div class="num"><strong>${money(e.cost)}</strong></div></div>`).join('') : '<div class="empty">Nothing logged yet.</div>'}</div>
    <div class="actions"><button class="btn primary" data-close>Close</button></div></div>`);
}

function requestMaint(id) {
  const m = find(id);
  return requestServiceDialog({
    subject: `Service request: ${m.name}`,
    vendorId: m.vendor_id,
    lines: [
      `I'd like to schedule: ${m.name}${m.appliance_name ? ` (${m.appliance_name})` : ''}.`,
      m.last_done ? `It was last done ${fmtDate(m.last_done)}.` : '',
      m.notes ? `Notes: ${m.notes}` : '',
    ].filter(Boolean),
  });
}

export const actions = {
  'add-maint': addMaint,
  'edit-maint': editMaint,
  'done-maint': doneMaint,
  'hist-maint': histMaint,
  'snooze-maint': snooze,
  'unsnooze-maint': unsnooze,
  'request-maint': requestMaint,
  'maint-mode': (_id, data) => { mode = data.mode; ctx.render(); },
  'copy-feed': async (_id, data) => { await copyText(data.feed); toast('Address copied'); },
};

