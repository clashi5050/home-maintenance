// My Home: the profile, what the house has, quick-reference facts, and the Home Score in detail.
import { $, api, app, ctx, esc, openForm, state, toast, DELETE_BUTTON, wireDelete } from '../lib.js';
import { scoreRing } from './dashboard.js';

let facts = [];

const PRESETS = ['Main water shutoff', 'Electrical panel', 'HVAC filter size', 'Water heater location', 'Paint: living room', 'Gas shutoff', 'Sprinkler controller'];

const num = (v) => (v == null ? '' : v);
const profileField = (id, label, value, attrs = '') => `<div class="field"><label for="p-${id}">${label}</label><input id="p-${id}" name="${id}" value="${esc(num(value))}" ${attrs}></div>`;

function factsHtml() {
  if (!facts.length) return '<div class="empty">Nothing yet. Add the things you always have to look up.</div>';
  const groups = new Map();
  for (const f of facts) {
    const key = f.group_name || 'General';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f);
  }
  return [...groups].map(([group, list]) => `<h3 class="fact-group">${esc(group)}</h3>
    <dl class="facts">${list.map((f) => `<div class="fact"><dt>${esc(f.label)}</dt><dd>${esc(f.value)}</dd>
      <button class="link-btn" data-action="edit-fact" data-id="${f.id}">Edit</button></div>`).join('')}</dl>`).join('');
}

function scoreBlock(score) {
  return `<div class="score-detail">
    <div class="score-hero">${scoreRing(score.score, score.grade)}<div><div class="score-grade">${esc(score.grade)}</div>
      <p class="muted small" style="margin:4px 0 0">A simple 0 to 100 measure of how well the house is being looked after. It is built from the five parts below, and each one tells you what would improve it.</p></div></div>
    <ul class="parts">${score.parts.map((p) => `<li>
      <div class="part-top"><strong>${esc(p.label)}</strong><span class="num">${p.points} / ${p.max}</span></div>
      <div class="bar${p.points / p.max < 0.5 ? ' warn' : ''}" aria-hidden="true"><span style="width:${(p.points / p.max) * 100}%"></span></div>
      <div class="small muted">${esc(p.tip)}</div></li>`).join('')}</ul></div>`;
}

export async function render() {
  const [profile, factList, score] = await Promise.all([api('GET', '/api/profile'), api('GET', '/api/facts'), api('GET', '/api/score')]);
  facts = factList;
  const have = new Set(profile.features);

  app.innerHTML = `
    <div class="page-head"><div><h1>My Home</h1><p class="sub">Tell the app about your house so suggestions, reminders and reports fit it.</p></div>
      <a class="btn" href="#/report">Home report</a></div>
    <div class="grid">
      <section class="card">
        <h2>Home details</h2>
        <form id="profile-form" class="stack">
          <div class="fields">
            ${profileField('name', 'Home name', profile.name, 'placeholder="e.g. Maple Street"')}
            ${profileField('address', 'Address', profile.address, 'autocomplete="street-address"')}
            ${profileField('year_built', 'Year built', profile.year_built, 'inputmode="numeric"')}
            ${profileField('sq_ft', 'Square feet', profile.sq_ft, 'inputmode="numeric"')}
            ${profileField('bedrooms', 'Bedrooms', profile.bedrooms, 'inputmode="decimal"')}
            ${profileField('bathrooms', 'Bathrooms', profile.bathrooms, 'inputmode="decimal"')}
            ${profileField('purchase_date', 'Purchased', profile.purchase_date, 'type="date"')}
            ${profileField('purchase_price', 'Purchase price ($)', profile.purchase_price, 'inputmode="decimal"')}
            ${profileField('insurance_provider', 'Insurance provider', profile.insurance_provider)}
            ${profileField('insurance_policy', 'Policy number', profile.insurance_policy)}
            <div class="field full"><label for="p-notes">Notes</label><textarea id="p-notes" name="notes">${esc(profile.notes ?? '')}</textarea></div>
          </div>
          <div class="actions"><button class="btn primary" type="submit">Save details</button></div>
        </form>
      </section>
      <section class="card">
        <h2>What your home has</h2>
        <p class="muted small" style="margin-top:0">These switch on the matching suggestions. They save as you tick them.</p>
        <div class="check-grid" id="features">${state.meta.home_features.map((f) => `<label class="check"><input type="checkbox" value="${esc(f.key)}"${have.has(f.key) ? ' checked' : ''}> ${esc(f.label)}</label>`).join('')}</div>
      </section>
      <section class="card">
        <h2>Home facts <button class="btn sm" data-action="add-fact">Add</button></h2>
        <p class="muted small" style="margin-top:0">The things you always have to look up: shutoff locations, filter sizes, paint colors.</p>
        <div class="chips">${PRESETS.map((p) => `<button class="chip" data-action="add-fact" data-label="${esc(p)}">${esc(p)}</button>`).join('')}</div>
        ${factsHtml()}
      </section>
      <section class="card">
        <h2>Home Score</h2>
        ${scoreBlock(score)}
      </section>
    </div>`;

  $('#profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target).entries());
    try { await api('PUT', '/api/profile', body); toast('Saved'); ctx.render(); } catch (err) { toast(err.message, true); }
  });
  $('#features').addEventListener('change', async () => {
    const features = [...document.querySelectorAll('#features input:checked')].map((i) => i.value);
    try { await api('PUT', '/api/profile', { features }); toast('Saved'); } catch (err) { toast(err.message, true); }
  });
}

function factForm(fact = {}) {
  return [
    { name: 'label', label: 'What', required: true, full: true, placeholder: 'e.g. Main water shutoff' },
    { name: 'value', label: 'Details', required: true, type: 'textarea', placeholder: 'e.g. Garage, left wall behind the workbench' },
    { name: 'group_name', label: 'Group', placeholder: 'e.g. Plumbing', full: true, hint: 'Optional. Facts are listed together by group.' },
  ].map((f) => ({ ...f, default: fact[f.name] }));
}

function addFact(_id, data) {
  openForm({
    title: 'Add a home fact', fields: factForm(), values: { label: data.label ?? '' },
    onSubmit: async (d) => { await api('POST', '/api/facts', d); toast('Added'); ctx.render(); },
  });
}

function editFact(id) {
  const f = facts.find((x) => x.id === id);
  const dlg = openForm({
    title: 'Edit home fact', fields: factForm(f), values: f, extraActions: DELETE_BUTTON,
    onSubmit: async (d) => { await api('PUT', `/api/facts/${id}`, d); toast('Saved'); ctx.render(); },
  });
  wireDelete(dlg, { confirmText: `Delete "${f.label}"?`, url: `/api/facts/${id}` });
}

export const actions = { 'add-fact': addFact, 'edit-fact': editFact };

