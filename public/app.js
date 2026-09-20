// Home Maintenance UI: vanilla JS modules, no build step, no external requests.
import { api, app, ctx, esc, loadShared, openForm, toast } from './lib.js';
import { initSearch } from './search.js';
import * as appliances from './views/appliances.js';
import * as assistant from './views/assistant.js';
import * as dashboard from './views/dashboard.js';
import * as documents from './views/documents.js';
import * as home from './views/home.js';
import * as log from './views/log.js';
import * as maintenance from './views/maintenance.js';
import * as projects from './views/projects.js';
import * as report from './views/report.js';
import * as settings from './views/settings.js';
import * as suggestions from './views/suggestions.js';
import * as vendors from './views/vendors.js';

const views = { dashboard, maintenance, suggestions, appliances, projects, documents, log, vendors, home, assistant, settings, report };

// Every screen contributes the buttons it owns (data-action="name"); they are merged here.
const actions = {
  ...Object.assign({}, ...Object.values(views).map((v) => v.actions ?? {})),
  'edit-budget': async () => {
    const b = await api('GET', '/api/budget');
    openForm({
      title: `${b.year} budget`,
      intro: 'Your total spending limit for the year. It carries forward to next year until you change it.',
      fields: [{ name: 'amount', label: 'Annual budget ($)', type: 'number', step: '1', full: true }],
      values: { amount: b.amount },
      onSubmit: async (d) => { await api('PUT', '/api/budget', { year: b.year, amount: d.amount }); toast('Budget saved'); render(); },
    });
  },
};

// Report is reached from My Home and Settings, so it highlights that tab. The old History link now goes to the log.
const NAV_FOR = { report: 'home' };
const ALIAS = { history: 'log' };

async function renderOnce() {
  const raw = location.hash.replace(/^#\/?/, '') || 'dashboard';
  const name = ALIAS[raw] ?? raw;
  const view = views[name] ? name : 'dashboard';
  const active = NAV_FOR[view] ?? view;
  for (const a of document.querySelectorAll('#nav a')) {
    if (a.dataset.view === active) {
      a.setAttribute('aria-current', 'page');
      a.scrollIntoView?.({ block: 'nearest', inline: 'center' });
    } else a.removeAttribute('aria-current');
  }

  try {
    await loadShared();
    await views[view].render();
  } catch (err) {
    app.innerHTML = `<div class="card empty">Something went wrong: ${esc(err.message)}</div>`;
  }
}

// Renders never overlap, so a slow earlier screen can't paint over a newer one.
// If another render is requested while one is running, it runs once the current one finishes.
let rendering = false;
let dirty = false;
async function render() {
  if (rendering) { dirty = true; return; }
  rendering = true;
  try {
    do { dirty = false; await renderOnce(); } while (dirty);
  } finally {
    rendering = false;
  }
}
ctx.render = render;

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || !actions[el.dataset.action]) return;
  el.closest('details.menu')?.removeAttribute('open');
  try {
    await actions[el.dataset.action](el.dataset.id ? Number(el.dataset.id) : undefined, el.dataset);
  } catch (err) {
    toast(err.message, true);
  }
});

// A menu that would run off the screen opens leftward (or upward) instead.
document.addEventListener('toggle', (e) => {
  const menu = e.target;
  if (!menu.matches?.('details.menu') || !menu.open) return;
  const list = menu.querySelector('.menu-list');
  list.classList.remove('flip', 'up');
  const box = list.getBoundingClientRect();
  if (box.right > window.innerWidth - 8) list.classList.add('flip');
  if (box.bottom > window.innerHeight - 8) list.classList.add('up');
}, true);

// Menus close when you tap anywhere else.
document.addEventListener('click', (e) => {
  for (const menu of document.querySelectorAll('details.menu[open]')) if (!menu.contains(e.target)) menu.removeAttribute('open');
});

window.addEventListener('hashchange', render);
initSearch();
render();
