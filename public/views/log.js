// The home log: everything done to the house, with costs. Useful for taxes, insurance and resale.
import {
  $, api, app, applianceOptions, cap, ctx, esc, fmtDate, money, openForm, pill, state, todayStr, toast, uploadFile, vendorOptions,
} from '../lib.js';

let year = new Date().getFullYear(); // 0 means every year
let kind = '';
let cache = [];

const KINDS = [['', 'All'], ['maintenance', 'Maintenance'], ['repair', 'Repairs'], ['upgrade', 'Upgrades'], ['inspection', 'Inspections']];

export async function render() {
  const params = new URLSearchParams();
  if (year) params.set('year', year);
  if (kind) params.set('kind', kind);
  const { years, entries } = await api('GET', `/api/history?${params}`);
  cache = entries;
  const total = entries.reduce((sum, e) => sum + (e.cost ?? 0), 0);
  const csv = `/api/history.csv${year ? `?year=${year}` : ''}`;

  app.innerHTML = `
    <div class="page-head"><div><h1>Home log</h1><p class="sub">Every job, repair and upgrade, with what it cost.</p></div>
      <div class="head-actions">
        <select id="year" class="inline-select" aria-label="Year" style="min-height:40px"><option value="0"${year === 0 ? ' selected' : ''}>All years</option>${years.map((y) => `<option${y === year ? ' selected' : ''}>${y}</option>`).join('')}</select>
        <a class="btn" href="${csv}" download>Export CSV</a>
        <button class="btn primary" data-action="log-repair">Log a job</button>
      </div></div>
    <div class="chips">${KINDS.map(([v, l]) => `<button class="chip" data-action="log-kind" data-kind="${v}" aria-pressed="${kind === v}">${l}</button>`).join('')}</div>
    <div class="card table-wrap">${entries.length ? `<table>
      <thead><tr><th>Date</th><th>Job</th><th>Appliance</th><th>Done by</th><th class="r">Cost</th><th></th></tr></thead>
      <tbody>${entries.map((e) => `<tr>
        <td class="num">${fmtDate(e.done_on)}</td>
        <td><strong>${esc(e.name)}</strong> ${e.kind !== 'maintenance' ? pill(e.kind === 'repair' ? 'due' : e.kind === 'upgrade' ? 'upcoming' : 'idea', cap(e.kind)) : ''}${e.notes ? `<div class="small muted">${esc(e.notes)}</div>` : ''}</td>
        <td>${esc(e.appliance_name ?? '')}</td>
        <td>${e.diy ? 'Me' : esc(e.vendor_name ?? '')}</td>
        <td class="r num">${money(e.cost)}</td>
        <td class="r nowrap"><button class="link-btn" data-action="open-docs" data-field="completion_id" data-link="${e.id}" data-title="Documents: ${esc(e.name)}" data-category="receipt">Files${e.doc_count ? ` (${e.doc_count})` : ''}</button>
          <button class="link-btn" data-action="edit-log" data-id="${e.id}">Edit</button></td></tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="4">${year || 'All years'} total</td><td class="r num">${money(total)}</td><td></td></tr></tfoot></table>`
    : `<div class="empty">Nothing logged${year ? ` in ${year}` : ''}. Use "Mark done" on a maintenance item, or "Log a job" for a repair or upgrade.</div>`}</div>`;
}

const kindOptions = () => [['repair', 'Repair'], ['upgrade', 'Upgrade'], ['maintenance', 'Maintenance'], ['inspection', 'Inspection']];

/** Logs a one-off job. `values` can preselect an appliance. */
function logJob(_id, _data, values = {}) {
  openForm({
    title: 'Log a job', submit: 'Log it',
    intro: 'For repairs, upgrades and inspections that are not part of a recurring item.',
    fields: [
      { name: 'title', label: 'What was done', required: true, full: true, placeholder: 'e.g. Replaced garbage disposal' },
      { name: 'kind', label: 'Type', type: 'select', options: kindOptions(), default: 'repair' },
      { name: 'done_on', label: 'Date', type: 'date', required: true, default: todayStr() },
      { name: 'cost', label: 'Cost ($)', type: 'number', step: '0.01' },
      { name: 'appliance_id', label: 'Appliance or system', type: 'select', options: applianceOptions() },
      { name: 'vendor_id', label: 'Done by', type: 'select', options: vendorOptions() },
      { name: 'diy', label: 'I did it myself', type: 'checkbox' },
      { name: 'notes', label: 'Notes', full: true },
      { name: 'receipt', label: 'Attach a receipt or photo (optional)', type: 'file', accept: state.meta.upload_extensions.join(','), full: true },
    ],
    values: { kind: 'repair', done_on: todayStr(), ...values },
    onSubmit: async ({ receipt, ...d }) => {
      const entry = await api('POST', '/api/history', d);
      let message = 'Logged';
      if (receipt) {
        try { await uploadFile(receipt, { category: 'receipt', completion_id: entry.id, appliance_id: d.appliance_id }); } catch (err) { message = `Logged, but the file was not saved: ${err.message}`; }
      }
      toast(message);
      ctx.render();
    },
  });
}

function editLog(id) {
  const e = cache.find((x) => x.id === id);
  const linked = e.item_id != null;
  const dlg = openForm({
    title: linked ? `Edit: ${e.name}` : 'Edit job',
    fields: [
      ...(linked ? [] : [{ name: 'title', label: 'What was done', required: true, full: true }, { name: 'kind', label: 'Type', type: 'select', options: kindOptions() }]),
      { name: 'done_on', label: 'Date', type: 'date', required: true },
      { name: 'cost', label: 'Cost ($)', type: 'number', step: '0.01' },
      { name: 'appliance_id', label: 'Appliance or system', type: 'select', options: applianceOptions() },
      { name: 'vendor_id', label: 'Done by', type: 'select', options: vendorOptions() },
      { name: 'diy', label: 'I did it myself', type: 'checkbox' },
      { name: 'notes', label: 'Notes', full: true },
    ],
    values: e,
    extraActions: '<button type="button" class="btn danger" data-delete style="margin-right:auto">Delete</button>',
    onSubmit: async (d) => { await api('PUT', `/api/history/${id}`, d); toast('Saved'); ctx.render(); },
  });
  $('[data-delete]', dlg).addEventListener('click', async () => {
    if (!confirm(`Delete this entry?${linked ? ' The next due date will be recalculated.' : ''}`)) return;
    try { await api('DELETE', `/api/history/${id}`); dlg.remove(); toast('Deleted'); ctx.render(); } catch (err) { toast(err.message, true); }
  });
}

export const actions = {
  'log-repair': (id) => logJob(null, null, id ? { appliance_id: id } : {}),
  'edit-log': editLog,
  'log-kind': (_id, data) => { kind = data.kind; ctx.render(); },
};

document.addEventListener('change', (e) => {
  if (e.target.id === 'year') { year = Number(e.target.value); ctx.render(); }
});

