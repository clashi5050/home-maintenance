// Your own trusted pros: contact details, ratings, and every job they've done for you.
import { api, app, ctx, esc, fmtDate, openForm, plural, state, toast, DELETE_BUTTON, wireDelete } from '../lib.js';

let tradeFilter = '';
let cache = [];

const stars = (n) => (n ? `<span class="stars" aria-label="${n} out of 5">${'★'.repeat(n)}<span class="off">${'★'.repeat(5 - n)}</span></span>` : '');

const fields = () => [
  { name: 'name', label: 'Business or person', required: true, full: true },
  { name: 'category', label: 'Trade', type: 'select', options: [['', '— choose —'], ...state.meta.vendor_categories.map((c) => [c, c])] },
  { name: 'rating', label: 'Your rating', type: 'select', options: [['', 'Not rated'], ['5', '5 – Excellent'], ['4', '4 – Good'], ['3', '3 – Okay'], ['2', '2 – Poor'], ['1', '1 – Avoid']] },
  { name: 'phone', label: 'Phone', type: 'tel' },
  { name: 'email', label: 'Email', type: 'email' },
  { name: 'website', label: 'Website', placeholder: 'https://' },
  { name: 'notes', label: 'Notes', placeholder: 'Account #, who to ask for, what they do for you', full: true },
];

export async function render() {
  cache = await api('GET', '/api/vendors');
  const trades = [...new Set(cache.map((v) => v.category).filter(Boolean))].sort();
  const shown = tradeFilter ? cache.filter((v) => v.category === tradeFilter) : cache;
  const safeUrl = (u) => (/^https?:\/\//i.test(u) ? u : `https://${u}`);

  app.innerHTML = `
    <div class="page-head"><div><h1>Vendors</h1><p class="sub">The people you trust for the house. Phone numbers are tap-to-call on your phone.</p></div><button class="btn primary" data-action="add-vendor">Add vendor</button></div>
    ${trades.length ? `<div class="chips"><button class="chip" data-action="vendor-trade" data-trade="" aria-pressed="${tradeFilter === ''}">All</button>${trades.map((t) => `<button class="chip" data-action="vendor-trade" data-trade="${esc(t)}" aria-pressed="${tradeFilter === t}">${esc(t)}</button>`).join('')}</div>` : ''}
    <div class="grid">${shown.map((v) => `<article class="item">
      <div class="item-top"><div><div class="item-name">${esc(v.name)}</div><div class="small muted">${esc(v.category ?? '')}</div></div>${stars(v.rating)}</div>
      <div class="meta">${v.phone ? `<span><a href="tel:${esc(v.phone.replace(/[^\d+]/g, ''))}">${esc(v.phone)}</a></span>` : '<span>No phone yet</span>'}${v.email ? `<span><a href="mailto:${esc(v.email)}">${esc(v.email)}</a></span>` : ''}${v.website ? `<span><a href="${esc(safeUrl(v.website))}" target="_blank" rel="noopener noreferrer">Website</a></span>` : ''}</div>
      <div class="meta">${v.used_by ? `<span>${plural(v.used_by, 'job')} and item</span>` : ''}${v.last_used ? `<span>Last used ${fmtDate(v.last_used)}</span>` : ''}</div>
      ${v.notes ? `<div class="notes">${esc(v.notes)}</div>` : ''}
      <div class="actions">
        <button class="btn sm" data-action="open-docs" data-field="vendor_id" data-link="${v.id}" data-title="Documents: ${esc(v.name)}" data-category="contract">Documents${v.doc_count ? ` (${v.doc_count})` : ''}</button>
        <button class="btn sm" data-action="edit-vendor" data-id="${v.id}">Edit</button>
      </div>
    </article>`).join('') || '<div class="card empty" style="grid-column:1/-1">No vendors yet.</div>'}</div>`;
}

function addVendor() {
  openForm({ title: 'Add vendor', fields: fields(), onSubmit: async (d) => { await api('POST', '/api/vendors', d); toast('Added'); ctx.render(); } });
}

function editVendor(id) {
  const v = cache.find((x) => x.id === id);
  const dlg = openForm({
    title: 'Edit vendor', fields: fields(), values: { ...v, rating: v.rating ?? '' }, extraActions: DELETE_BUTTON,
    onSubmit: async (d) => { await api('PUT', `/api/vendors/${id}`, { ...d, rating: d.rating ? Number(d.rating) : null }); toast('Saved'); ctx.render(); },
  });
  wireDelete(dlg, { confirmText: `Delete "${v.name}"? Items that used them keep working, just without a vendor.`, url: `/api/vendors/${id}` });
}

export const actions = {
  'add-vendor': addVendor,
  'edit-vendor': editVendor,
  'vendor-trade': (_id, data) => { tradeFilter = data.trade; ctx.render(); },
};

