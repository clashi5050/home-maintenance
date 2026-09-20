// Shared helpers for every screen: formatting, the API client, dialogs and forms.

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const $ = (sel, root = document) => root.querySelector(sel);
export const app = $('#app');

export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const money = (n) => (n == null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: Number.isInteger(n) ? 0 : 2 }).format(n));
export const fmtDate = (s) => (s ? new Date(`${s}T00:00:00`).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—');
export const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
export const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');
export const fileSize = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);
export const pill = (cls, label) => `<span class="pill ${esc(cls)}">${esc(label)}</span>`;

/** Lets modules refresh the current screen without importing the router. */
export const ctx = { render: () => {} };

export async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

let toastTimer;
export function toast(message, isError = false) {
  const el = $('#toast');
  el.textContent = message;
  el.className = `show${isError ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, isError ? 5000 : 2500);
}

// ---- Data every screen needs -----------------------------------------------------

export const state = { vendors: [], appliances: [], meta: null };

export async function loadShared() {
  const [vendors, appliances, meta] = await Promise.all([
    api('GET', '/api/vendors'),
    api('GET', '/api/appliances'),
    state.meta ? Promise.resolve(state.meta) : api('GET', '/api/meta'),
  ]);
  Object.assign(state, { vendors, appliances, meta });
}

export const vendorOptions = () => [['', '— none —'], ...state.vendors.map((v) => [v.id, v.name])];
export const applianceOptions = () => [['', '— none —'], ...state.appliances.map((a) => [a.id, a.name])];
export const categoryLabel = (key) => state.meta.appliance_categories.find((c) => c.key === key)?.label ?? '';

export function vendorLine(name, phone) {
  if (!name) return '';
  const tel = phone ? ` · <a href="tel:${esc(phone.replace(/[^\d+]/g, ''))}">${esc(phone)}</a>` : '';
  return `<span><strong>${esc(name)}</strong>${tel}</span>`;
}

// ---- Dialogs and forms ---------------------------------------------------------

/** A plain modal. Returns the dialog element; call dlg.remove() to close it. */
export function openDialog(html, { wide = false } = {}) {
  const dlg = document.createElement('dialog');
  if (wide) dlg.className = 'wide';
  dlg.innerHTML = html;
  document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove()); // Esc key
  dlg.addEventListener('click', (e) => { if (e.target === dlg || e.target.closest('[data-close]')) dlg.remove(); });
  dlg.showModal();
  return dlg;
}

function fieldHtml(f, values) {
  const v = values[f.name] ?? f.default ?? '';
  const id = `f-${f.name}`;
  const off = f.disabled ? ' disabled' : '';
  let input;
  if (f.type === 'select') {
    input = `<select id="${id}" name="${f.name}"${off}>${f.options.map(([val, label]) => `<option value="${esc(val)}"${String(val) === String(v) ? ' selected' : ''}>${esc(label)}</option>`).join('')}</select>`;
  } else if (f.type === 'textarea') {
    input = `<textarea id="${id}" name="${f.name}"${off}>${esc(v)}</textarea>`;
  } else if (f.type === 'checkbox') {
    return `<div class="field full"><label class="check"><input id="${id}" type="checkbox" name="${f.name}"${v ? ' checked' : ''}${off}> ${esc(f.label)}</label>${f.hint ? `<span class="hint">${esc(f.hint)}</span>` : ''}</div>`;
  } else if (f.type === 'file') {
    input = `<input id="${id}" name="${f.name}" type="file"${f.accept ? ` accept="${esc(f.accept)}"` : ''}${f.multiple ? ' multiple' : ''}${f.required ? ' required' : ''}>`;
  } else {
    const attrs = [
      f.type === 'number' ? `inputmode="decimal" step="${f.step ?? 'any'}" min="${f.min ?? 0}"` : '',
      f.max != null ? `max="${f.max}"` : '',
      f.required ? 'required' : '',
      f.placeholder ? `placeholder="${esc(f.placeholder)}"` : '',
      f.type === 'tel' ? 'autocomplete="off"' : '',
      off,
    ].filter(Boolean).join(' ');
    input = `<input id="${id}" name="${f.name}" type="${f.type || 'text'}" value="${esc(v)}" ${attrs}>`;
  }
  return `<div class="field${f.full || f.type === 'textarea' ? ' full' : ''}"><label for="${id}">${esc(f.label)}</label>${input}${f.hint ? `<span class="hint">${esc(f.hint)}</span>` : ''}</div>`;
}

/**
 * Builds and opens a form dialog. `onSubmit` receives the collected values (files as File objects);
 * throw from it to show an error in the dialog. Returns the dialog element.
 */
export function openForm({ title, intro = '', fields, values = {}, submit = 'Save', onSubmit, extraActions = '', wide = false }) {
  const dlg = openDialog(`<form class="form">
    <h2>${esc(title)}</h2>
    ${intro ? `<p class="muted small" style="margin:0">${esc(intro)}</p>` : ''}
    <div class="fields">${fields.map((f) => fieldHtml(f, values)).join('')}</div>
    <p class="form-error" role="alert" hidden></p>
    <div class="actions">${extraActions}<button type="button" class="btn ghost" data-close>Cancel</button><button type="submit" class="btn primary">${esc(submit)}</button></div>
  </form>`, { wide });

  const form = $('form', dlg);
  const error = $('.form-error', dlg);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = {};
    for (const f of fields) {
      const el = form.elements[f.name];
      if (f.type === 'checkbox') data[f.name] = el.checked;
      else if (f.type === 'file') data[f.name] = f.multiple ? [...el.files] : (el.files[0] ?? null);
      else {
        const raw = el.value.trim();
        data[f.name] = f.type === 'number' ? (raw === '' ? null : Number(raw)) : raw === '' ? null : raw;
      }
    }
    const button = $('button[type=submit]', form);
    button.disabled = true;
    error.hidden = true;
    try {
      await onSubmit(data);
      dlg.remove();
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      button.disabled = false;
    }
  });
  return dlg;
}

export const DELETE_BUTTON = '<button type="button" class="btn danger" data-delete style="margin-right:auto">Delete</button>';

/** Wires the Delete button rendered by DELETE_BUTTON in a form dialog. */
export function wireDelete(dlg, { confirmText, url }) {
  $('[data-delete]', dlg).addEventListener('click', async () => {
    if (!confirm(confirmText)) return;
    try {
      await api('DELETE', url);
      dlg.remove();
      toast('Deleted');
      ctx.render();
    } catch (err) {
      toast(err.message, true);
    }
  });
}

// ---- Files ---------------------------------------------------------------------

export async function uploadFile(file, params = {}) {
  const query = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString();
  const res = await fetch(`/api/documents${query ? `?${query}` : ''}`, {
    method: 'POST', headers: { 'X-Filename': encodeURIComponent(file.name) }, body: file,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${file.name}: ${data.error || `upload failed (${res.status})`}`);
  return data;
}

/** Shrinks a photo before it is sent anywhere: smaller upload, fewer tokens, and it strips location data. */
export async function downscaleImage(file, maxEdge = 1568) {
  let bitmap;
  try { bitmap = await createImageBitmap(file); } catch { throw new Error('That photo could not be read. Try a JPEG or PNG.'); }
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve) => { canvas.toBlob(resolve, 'image/jpeg', 0.85); });
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  return { media_type: 'image/jpeg', data: dataUrl.slice(dataUrl.indexOf(',') + 1), preview: dataUrl };
}

/** Copies text; falls back for plain-http pages where the Clipboard API is unavailable. */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const el = document.createElement('textarea');
    el.value = text;
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.append(el);
    el.select();
    document.execCommand('copy');
    el.remove();
  }
}

/** Opens an email or text draft to a vendor. Used for maintenance items and project quotes. */
export async function requestServiceDialog({ subject, vendorId, lines }) {
  const vendor = state.vendors.find((v) => v.id === vendorId);
  const profile = await api('GET', '/api/profile');
  const home = [profile.address, profile.year_built ? `built ${profile.year_built}` : ''].filter(Boolean).join(', ');
  const message = [
    `Hi ${vendor ? vendor.name : 'there'},`,
    '',
    ...lines,
    ...(home ? ['', `Home: ${home}`] : []),
    '',
    'Could you let me know your availability and a price? Thanks!',
  ].join('\n');

  const dlg = openDialog(`<div class="form">
    <h2>Request service</h2>
    <p class="muted small" style="margin:0">Edit the message, then send it from your own email or messages app.${vendor ? '' : ' Pick a vendor on the item to fill in their contact details.'}</p>
    <div class="field"><label for="rs-msg">Message</label><textarea id="rs-msg" rows="9">${esc(message)}</textarea></div>
    <div class="actions">
      <button class="btn ghost" data-close>Close</button>
      <button class="btn" data-copy>Copy</button>
      ${vendor?.phone ? '<button class="btn" data-sms>Text</button>' : ''}
      <button class="btn primary" data-email>Email</button>
    </div>
  </div>`);
  const text = () => $('#rs-msg', dlg).value;
  dlg.addEventListener('click', async (e) => {
    if (e.target.closest('[data-copy]')) { await copyText(text()); toast('Copied'); }
    if (e.target.closest('[data-email]')) location.href = `mailto:${vendor?.email ?? ''}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text())}`;
    if (e.target.closest('[data-sms]')) location.href = `sms:${vendor.phone.replace(/[^\d+]/g, '')}?body=${encodeURIComponent(text())}`;
  });
}
