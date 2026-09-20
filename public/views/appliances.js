// Appliances and home systems: warranty countdowns, expected lifespan, and their paperwork.
import {
  api, app, categoryLabel, ctx, esc, fmtDate, money, openForm, pill, state, toast, vendorLine, vendorOptions, DELETE_BUTTON, wireDelete,
} from '../lib.js';

/** Calendar-accurate "7 mo 25 d" span between today (derived from days_left) and the warranty end. */
function warrantySpan(a) {
  const end = new Date(`${a.warranty_end}T00:00:00Z`);
  const now = new Date(end.getTime() - a.days_left * 86400000);
  const [from, to] = a.days_left >= 0 ? [now, end] : [end, now];
  let years = to.getUTCFullYear() - from.getUTCFullYear();
  let months = to.getUTCMonth() - from.getUTCMonth();
  let days = to.getUTCDate() - from.getUTCDate();
  if (days < 0) {
    months -= 1;
    days += new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 0)).getUTCDate();
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  const parts = [];
  if (years) parts.push(`${years} yr`);
  if (months) parts.push(`${months} mo`);
  if (days && !years) parts.push(`${days} d`);
  return parts.join(' ') || '0 d';
}

export function warrantyBlock(a) {
  if (a.warranty_status === 'none') return '<div class="muted small">No warranty info yet. Add a purchase date and warranty length.</div>';
  const expired = a.days_left < 0;
  const elapsed = Math.min(100, Math.max(0, ((a.total_days - a.days_left) / a.total_days) * 100));
  return `<div class="countdown ${a.warranty_status}">
      <span class="days num">${expired ? 'Expired' : a.days_left.toLocaleString()}</span>
      <span class="muted">${expired ? `${warrantySpan(a)} ago` : `${a.days_left === 1 ? 'day' : 'days'} left · ${warrantySpan(a)}`}</span>
    </div>
    <div class="bar ${a.warranty_status === 'expiring' ? 'warn' : expired ? 'over' : ''}" aria-hidden="true"><span style="width:${elapsed.toFixed(1)}%"></span></div>
    <div class="small muted">Warranty ${expired ? 'ended' : 'ends'} ${fmtDate(a.warranty_end)}</div>`;
}

/** Age against expected life, so replacements are planned rather than surprises. */
export function lifeBlock(a) {
  if (a.life_status === 'none') return '';
  const tone = a.life_status === 'end' ? 'over' : a.life_status === 'aging' ? 'warn' : '';
  const remaining = new Date(`${a.replace_by}T00:00:00`) - new Date();
  const label = a.life_status === 'end' ? `Past its typical ${a.expected_life_years}-year life`
    : `About ${Math.max(0.1, remaining / 31557600000).toFixed(1)} years of typical life left`;
  return `<div class="life"><div class="small"><strong>${a.age_years} of ${a.expected_life_years} years old</strong> <span class="muted">· ${label}</span></div>
    <div class="bar ${tone}" aria-hidden="true"><span style="width:${Math.min(100, a.life_pct)}%"></span></div>
    <div class="small muted">Typical replacement around ${fmtDate(a.replace_by)}</div></div>`;
}

const fields = () => [
  { name: 'name', label: 'Appliance or system', required: true, full: true, placeholder: 'e.g. Dishwasher' },
  { name: 'category', label: 'Type', type: 'select', options: [['', '— choose —'], ...state.meta.appliance_categories.map((c) => [c.key, c.label])], hint: 'Sets a typical lifespan you can change.' },
  { name: 'location', label: 'Location', placeholder: 'e.g. Kitchen' },
  { name: 'brand', label: 'Brand' },
  { name: 'model', label: 'Model' },
  { name: 'serial', label: 'Serial number' },
  { name: 'purchase_date', label: 'Purchase or install date', type: 'date' },
  { name: 'purchase_price', label: 'Purchase price ($)', type: 'number', step: '0.01' },
  { name: 'warranty_length', label: 'Warranty length', type: 'number', step: 1, min: 1 },
  { name: 'warranty_unit', label: 'In', type: 'select', options: [['years', 'Years'], ['months', 'Months'], ['days', 'Days']], default: 'years' },
  { name: 'expected_life_years', label: 'Expected life (years)', type: 'number', step: 1, min: 1 },
  { name: 'vendor_id', label: 'Bought from / serviced by', type: 'select', options: vendorOptions() },
  { name: 'notes', label: 'Notes' },
];

/** Picking a type fills in its typical lifespan, unless one is already entered. */
function prefillLife(dlg) {
  const category = dlg.querySelector('[name=category]');
  const life = dlg.querySelector('[name=expected_life_years]');
  category.addEventListener('change', () => {
    const years = state.meta.appliance_categories.find((c) => c.key === category.value)?.years;
    if (years && !life.value) life.value = years;
  });
}

let cache = [];

export async function render() {
  cache = await api('GET', '/api/appliances');
  const sorted = [...cache].sort((a, b) => (a.days_left ?? 1e9) - (b.days_left ?? 1e9) || a.name.localeCompare(b.name));
  const statusPill = { active: ['active', 'Covered'], expiring: ['expiring', 'Expiring'], expired: ['expired', 'Expired'], none: ['none', 'No warranty'] };

  app.innerHTML = `
    <div class="page-head"><div><h1>Appliances &amp; systems</h1><p class="sub">Warranty countdowns, expected lifespan, model numbers and paperwork.</p></div><button class="btn primary" data-action="add-appl">Add appliance</button></div>
    <div class="grid">${sorted.map((a) => `<article class="item">
      <div class="item-top"><div><div class="item-name">${esc(a.name)}</div><div class="small muted">${[categoryLabel(a.category), a.brand, a.model, a.location].filter(Boolean).map(esc).join(' · ')}</div></div>${pill(...statusPill[a.warranty_status])}</div>
      ${warrantyBlock(a)}
      ${lifeBlock(a)}
      <div class="meta">${a.vendor_name ? vendorLine(a.vendor_name, a.vendor_phone) : ''}${a.purchase_date ? `<span>Bought <strong>${fmtDate(a.purchase_date)}</strong>${a.purchase_price != null ? ` · ${money(a.purchase_price)}` : ''}</span>` : ''}${a.serial ? `<span>S/N <strong>${esc(a.serial)}</strong></span>` : ''}</div>
      ${a.notes ? `<div class="notes">${esc(a.notes)}</div>` : ''}
      <div class="actions">
        <button class="btn sm" data-action="open-docs" data-field="appliance_id" data-link="${a.id}" data-title="Documents: ${esc(a.name)}" data-category="warranty">Documents${a.doc_count ? ` (${a.doc_count})` : ''}</button>
        <button class="btn sm" data-action="log-repair" data-id="${a.id}">Log a repair</button>
        <button class="btn sm" data-action="edit-appl" data-id="${a.id}">Edit</button>
      </div>
    </article>`).join('') || '<div class="card empty" style="grid-column:1/-1">No appliances yet. Add one to start a warranty countdown.</div>'}</div>`;
}

function addAppl() {
  const dlg = openForm({ title: 'Add appliance', fields: fields(), values: { warranty_unit: 'years' }, onSubmit: async (d) => { await api('POST', '/api/appliances', d); toast('Added'); ctx.render(); } });
  prefillLife(dlg);
}

function editAppl(id) {
  const a = cache.find((x) => x.id === id);
  const dlg = openForm({
    title: 'Edit appliance', fields: fields(), values: a, extraActions: DELETE_BUTTON,
    onSubmit: async (d) => { await api('PUT', `/api/appliances/${id}`, d); toast('Saved'); ctx.render(); },
  });
  wireDelete(dlg, { confirmText: `Delete "${a.name}"? Its documents stay in your library.`, url: `/api/appliances/${id}` });
  prefillLife(dlg);
}

export const actions = {
  'add-appl': addAppl,
  'edit-appl': editAppl,
};
