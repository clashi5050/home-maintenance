// Receipts, manuals, warranties and photos.
import { $, api, app, cap, ctx, esc, fileSize, fmtDate, openDialog, openForm, pill, state, toast, uploadFile } from '../lib.js';

const filter = { q: '', category: '' };
const isImage = (d) => d.mime.startsWith('image/') && d.mime !== 'image/heic';
const ext = (d) => d.filename.split('.').pop().toUpperCase();
const catLabel = (key) => state.meta.doc_categories.find((c) => c.key === key)?.label ?? cap(key);

const linkedTo = (d) => [
  d.appliance_name && `Appliance: ${d.appliance_name}`,
  d.item_name && `Maintenance: ${d.item_name}`,
  d.task_title && `Project: ${d.task_title}`,
  d.vendor_name && `Vendor: ${d.vendor_name}`,
].filter(Boolean);

function docCard(d, { compact = false } = {}) {
  const thumb = isImage(d)
    ? `<a class="thumb" href="/api/documents/${d.id}/file" target="_blank" rel="noopener"><img src="/api/documents/${d.id}/file" alt="" loading="lazy"></a>`
    : `<a class="thumb badge" href="/api/documents/${d.id}/file" target="_blank" rel="noopener" aria-label="Open ${esc(d.title)}"><span>${esc(ext(d))}</span></a>`;
  return `<article class="item doc">
    ${thumb}
    <div class="doc-body">
      <div class="item-top"><div class="item-name">${esc(d.title)}</div>${pill('idea', catLabel(d.category))}</div>
      <div class="meta"><span>${esc(d.filename)}</span><span>${fileSize(d.size)}</span><span>${fmtDate(d.uploaded_at.slice(0, 10))}</span></div>
      ${!compact && linkedTo(d).length ? `<div class="meta">${linkedTo(d).map((t) => `<span>${esc(t)}</span>`).join('')}</div>` : ''}
      ${!compact && d.notes ? `<div class="notes">${esc(d.notes)}</div>` : ''}
      <div class="actions">
        <a class="btn sm primary" href="/api/documents/${d.id}/file" target="_blank" rel="noopener">View</a>
        <a class="btn sm" href="/api/documents/${d.id}/file?download=1">Download</a>
        ${compact ? '' : `<button class="btn sm" data-action="edit-doc" data-id="${d.id}">Edit</button>`}
        <button class="btn sm danger" data-action="del-doc" data-id="${d.id}">Delete</button>
      </div>
    </div>
  </article>`;
}

let cache = [];

export async function render() {
  const params = new URLSearchParams();
  if (filter.q) params.set('q', filter.q);
  if (filter.category) params.set('category', filter.category);
  cache = await api('GET', `/api/documents?${params}`);
  const cats = [['', 'All'], ...state.meta.doc_categories.map((c) => [c.key, c.label])];

  app.innerHTML = `
    <div class="page-head"><div><h1>Documents</h1><p class="sub">Warranties, receipts, manuals and photos, kept with the appliances and jobs they belong to.</p></div>
      <button class="btn primary" data-action="add-doc">Add files</button></div>
    <div class="toolbar"><input id="doc-search" type="search" placeholder="Search documents" value="${esc(filter.q)}" aria-label="Search documents"></div>
    <div class="chips">${cats.map(([v, l]) => `<button class="chip" data-doc-cat="${v}" aria-pressed="${filter.category === v}">${esc(l)}</button>`).join('')}</div>
    <div class="grid">${cache.map((d) => docCard(d)).join('') || `<div class="card empty" style="grid-column:1/-1">${filter.q || filter.category ? 'No documents match.' : 'No documents yet. Add a warranty or receipt to start your record.'}</div>`}</div>`;

  const search = $('#doc-search');
  search.addEventListener('input', () => {
    filter.q = search.value.trim();
    clearTimeout(search._t);
    search._t = setTimeout(async () => { await render(); const el = $('#doc-search'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }, 250);
  });
}

/** One "Attach to" dropdown covering everything a document can belong to. */
async function attachOptions() {
  const [maintenance, tasks] = await Promise.all([api('GET', '/api/maintenance'), api('GET', '/api/tasks')]);
  return [
    ['', '— nothing in particular —'],
    ...state.appliances.map((a) => [`appliance_id:${a.id}`, `Appliance: ${a.name}`]),
    ...maintenance.map((m) => [`item_id:${m.id}`, `Maintenance: ${m.name}`]),
    ...tasks.map((t) => [`task_id:${t.id}`, `Project: ${t.title}`]),
    ...state.vendors.map((v) => [`vendor_id:${v.id}`, `Vendor: ${v.name}`]),
  ];
}

const parseAttach = (value) => (value ? Object.fromEntries([value.split(':')]) : {});
const categoryOptions = () => state.meta.doc_categories.map((c) => [c.key, c.label]);
const accept = () => state.meta.upload_extensions.join(',');

async function uploadMany(files, params, { single = null } = {}) {
  let done = 0;
  for (const file of files) {
    toast(`Uploading ${done + 1} of ${files.length}…`);
    await uploadFile(file, { ...params, ...(files.length === 1 && single ? { title: single } : {}) });
    done += 1;
  }
  toast(files.length === 1 ? 'Uploaded' : `Uploaded ${files.length} files`);
}

async function addDoc() {
  openForm({
    title: 'Add files',
    intro: `Up to ${state.meta.max_upload_mb} MB each. PDFs, photos, and common office files.`,
    submit: 'Upload',
    fields: [
      { name: 'files', label: 'Files', type: 'file', multiple: true, required: true, accept: accept(), full: true },
      { name: 'title', label: 'Title', hint: 'Optional. Used when you pick a single file.' },
      { name: 'category', label: 'Category', type: 'select', options: categoryOptions(), default: 'other' },
      { name: 'attach', label: 'Attach to', type: 'select', options: await attachOptions(), full: true },
      { name: 'notes', label: 'Notes' },
    ],
    onSubmit: async (d) => {
      if (!d.files.length) throw new Error('Choose at least one file');
      await uploadMany(d.files, { category: d.category, notes: d.notes, ...parseAttach(d.attach) }, { single: d.title });
      ctx.render();
    },
  });
}

async function editDoc(id) {
  const d = cache.find((x) => x.id === id);
  openForm({
    title: 'Edit document', values: d,
    fields: [
      { name: 'title', label: 'Title', required: true, full: true },
      { name: 'category', label: 'Category', type: 'select', options: categoryOptions() },
      { name: 'notes', label: 'Notes' },
    ],
    onSubmit: async (v) => { await api('PUT', `/api/documents/${id}`, v); toast('Saved'); ctx.render(); },
  });
}

async function delDoc(id, _data, onDone = () => ctx.render()) {
  if (!confirm('Delete this document? The file is removed from storage.')) return;
  await api('DELETE', `/api/documents/${id}`);
  toast('Deleted');
  onDone();
}

/**
 * A small library for one thing: an appliance, a maintenance item, a project, a vendor or a service entry.
 * `link` is the query field and id, such as { appliance_id: 3 }.
 */
export async function openDocsDialog({ title, link, defaultCategory = 'other' }) {
  const [[field, id]] = Object.entries(link);
  const dlg = openDialog('<div class="form"><h2></h2><div class="docs-list stack"></div><div class="docs-add"></div></div>', { wide: true });
  $('h2', dlg).textContent = title;
  const listEl = $('.docs-list', dlg);
  dlg.addEventListener('close', () => ctx.render());
  dlg.addEventListener('click', (e) => { if (e.target === dlg || e.target.closest('[data-close]')) ctx.render(); });

  const refresh = async () => {
    const docs = await api('GET', `/api/documents?${field}=${id}`);
    listEl.innerHTML = docs.map((d) => docCard(d, { compact: true })).join('') || '<div class="empty">Nothing attached yet.</div>';
  };
  await refresh();

  $('.docs-add', dlg).innerHTML = `<div class="fields">
      <div class="field"><label for="dd-cat">Category</label><select id="dd-cat">${categoryOptions().map(([v, l]) => `<option value="${v}"${v === defaultCategory ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
      <div class="field"><label for="dd-file">Add files</label><input id="dd-file" type="file" multiple accept="${esc(accept())}"></div>
    </div>
    <p class="form-error" hidden></p>
    <div class="actions"><button class="btn primary" data-close>Done</button></div>`;

  const input = $('#dd-file', dlg);
  const error = $('.form-error', dlg);
  input.addEventListener('change', async () => {
    error.hidden = true;
    try {
      await uploadMany([...input.files], { category: $('#dd-cat', dlg).value, [field]: id });
      input.value = '';
      await refresh();
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    }
  });
  listEl.addEventListener('click', async (e) => {
    const del = e.target.closest('[data-action="del-doc"]');
    if (del) { e.stopPropagation(); await delDoc(Number(del.dataset.id), null, refresh); }
  });
}

export const actions = {
  'add-doc': addDoc,
  'edit-doc': editDoc,
  'del-doc': delDoc,
  'open-docs': (_id, data) => openDocsDialog({
    title: data.title, link: { [data.field]: Number(data.link) }, defaultCategory: data.category || 'other',
  }),
};

// Category chips are plain buttons, so they are wired here rather than through data-action.
document.addEventListener('click', (e) => {
  const chip = e.target.closest('[data-doc-cat]');
  if (chip) { filter.category = chip.dataset.docCat; ctx.render(); }
});
