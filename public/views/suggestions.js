// A library of common home maintenance tasks, matched to your home and the season.
import { MONTHS, api, app, ctx, esc, openForm, pill, plural, state, toast, vendorOptions } from '../lib.js';

let season = 'now';
let category = '';
let showAll = false;
let cache = [];

const SEASONS = [['now', 'In season now'], ['all', 'All year'], ['spring', 'Spring'], ['summer', 'Summer'], ['fall', 'Fall'], ['winter', 'Winter']];
const featureLabel = (key) => state.meta.home_features.find((f) => f.key === key)?.label ?? key;

function card(s) {
  return `<article class="item${s.applicable ? '' : ' dim'}">
    <div class="item-top">
      <div><div class="item-name">${esc(s.name)}</div>
        <div class="small muted">Typically ${MONTHS[s.month - 1]} · ${s.interval_months === 12 ? 'yearly' : `every ${plural(s.interval_months, 'month')}`}</div></div>
      <div class="pill-stack">${pill('idea', s.category)}${s.pro ? pill('due', 'Pro recommended') : ''}</div>
    </div>
    <div class="notes">${esc(s.why)}</div>
    ${s.applicable ? '' : `<div class="small muted">For homes with: ${s.requires.map((f) => esc(featureLabel(f))).join(' and ')}</div>`}
    <div class="actions">${s.added
    ? '<button class="btn sm" disabled>On your list</button>'
    : `<button class="btn sm primary" data-action="sug-add" data-key="${esc(s.key)}">Add to my list</button>`}</div>
  </article>`;
}

export async function render() {
  const data = await api('GET', '/api/suggestions');
  cache = data.items;
  const categories = [...new Set(cache.map((s) => s.category))].sort();

  const shown = cache.filter((s) => (showAll || s.applicable)
    && (!category || s.category === category)
    && (season === 'all' || (season === 'now' ? s.in_season : s.season === season)));
  const open = shown.filter((s) => !s.added);
  const added = shown.filter((s) => s.added);

  app.innerHTML = `
    <div class="page-head"><div><h1>Suggestions</h1><p class="sub">Common upkeep worth doing, matched to your home. Add the ones you want and set a month.</p></div></div>
    ${data.features.length ? '' : `<section class="card callout"><strong>Get suggestions that fit your home.</strong> Tell us what it has, like gutters, a fence or a pool, and we'll only show what applies. <a href="#/home">Set up My Home</a></section>`}
    <div class="chips">${SEASONS.map(([v, l]) => `<button class="chip" data-action="sug-season" data-season="${v}" aria-pressed="${season === v}">${l}</button>`).join('')}</div>
    <div class="toolbar">
      <select id="sug-cat" aria-label="Category"><option value="">All categories</option>${categories.map((c) => `<option${c === category ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select>
      <label class="check"><input type="checkbox" id="sug-all"${showAll ? ' checked' : ''}> Include tasks that do not apply to my home</label>
    </div>
    ${open.length ? `<div class="grid">${open.map(card).join('')}</div>` : `<div class="card empty">${season === 'now' ? 'Nothing more in season right now. Try "All year".' : 'Nothing matches these filters.'}</div>`}
    ${added.length ? `<h2 class="group-title">Already on your list <span class="muted small">${added.length}</span></h2><div class="grid">${added.map(card).join('')}</div>` : ''}`;
}

function add(_id, data) {
  const s = cache.find((x) => x.key === data.key);
  openForm({
    title: `Add: ${s.name}`,
    intro: s.why,
    submit: 'Add to my list',
    fields: [
      { name: 'service_month', label: 'Service month', type: 'select', options: MONTHS.map((m, i) => [i + 1, m]) },
      { name: 'interval_months', label: 'Repeat every (months)', type: 'number', step: 1, min: 1 },
      { name: 'vendor_id', label: 'Vendor', type: 'select', options: vendorOptions() },
      { name: 'estimated_cost', label: 'Estimated cost ($)', type: 'number', step: '0.01' },
    ],
    values: { service_month: s.month, interval_months: s.interval_months },
    onSubmit: async (d) => {
      await api('POST', `/api/suggestions/${s.key}/add`, d);
      toast('Added to your maintenance list');
      ctx.render();
    },
  });
}

export const actions = {
  'sug-add': add,
  'sug-season': (_id, data) => { season = data.season; ctx.render(); },
};

document.addEventListener('change', (e) => {
  if (e.target.id === 'sug-cat') { category = e.target.value; ctx.render(); }
  if (e.target.id === 'sug-all') { showAll = e.target.checked; ctx.render(); }
});
