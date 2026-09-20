import { api, app, cap, esc, fmtDate, money, pill, plural } from '../lib.js';
import { lifeBlock, warrantyBlock } from './appliances.js';
import { maintenanceCard, setCache } from './maintenance.js';

export function scoreRing(score, grade) {
  const r = 42;
  const c = 2 * Math.PI * r;
  const tone = grade === 'Excellent' ? 'excellent' : grade === 'Good' ? 'good' : grade === 'Fair' ? 'fair' : 'poor';
  return `<svg viewBox="0 0 100 100" class="ring ${tone}" role="img" aria-label="Home Score ${score} out of 100, ${grade}">
    <circle cx="50" cy="50" r="${r}" class="ring-bg"/>
    <circle cx="50" cy="50" r="${r}" class="ring-fg" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c * (1 - score / 100)).toFixed(1)}" transform="rotate(-90 50 50)"/>
    <text x="50" y="55" text-anchor="middle" class="ring-num">${score}</text></svg>`;
}

function scoreCard(s) {
  const weakest = [...s.parts].sort((a, b) => a.points / a.max - b.points / b.max).slice(0, 2);
  return `<section class="card score-card">
    <h2>Home Score <a class="small" href="#/home">See the breakdown</a></h2>
    <div class="score-row">
      ${scoreRing(s.score, s.grade)}
      <div><div class="score-grade">${esc(s.grade)}</div>
        <ul class="tips">${weakest.map((p) => `<li><strong>${esc(p.label)}:</strong> ${esc(p.tip)}</li>`).join('')}</ul></div>
    </div>
  </section>`;
}

function budgetCard(b) {
  const pct = (n) => (b.amount ? Math.min(100, (n / b.amount) * 100) : 0);
  const spentPct = pct(b.spent);
  const projPct = Math.min(100 - spentPct, pct(b.projected_maintenance));
  const state = b.amount == null ? '' : b.spent > b.amount ? 'over' : b.spent + b.projected_maintenance > b.amount ? 'warn' : '';
  return `<section class="card">
    <h2>${b.year} budget <button class="btn sm" data-action="edit-budget">${b.amount == null ? 'Set budget' : 'Edit'}</button></h2>
    ${b.amount == null
    ? `<p class="muted">Set an annual budget to see how much is left after maintenance and projects.</p><dl class="kv"><dt>Spent so far</dt><dd class="num">${money(b.spent)}</dd></dl>`
    : `<div class="budget-figure"><span class="big num">${money(b.remaining)}</span><span class="muted">left of ${money(b.amount)}</span></div>
       <div class="bar ${state}" role="img" aria-label="${Math.round(spentPct)}% of budget spent"><span style="width:${spentPct}%"></span><span class="projected" style="width:${projPct}%"></span></div>
       <dl class="kv">
         <dt>Maintenance and repairs</dt><dd class="num">${money(b.spent_maintenance)}</dd>
         <dt>Needs &amp; projects</dt><dd class="num">${money(b.spent_projects)}</dd>
         <dt>Maintenance still expected</dt><dd class="num">${money(b.projected_maintenance)}</dd>
         <dt>Left after expected</dt><dd class="num">${money(b.remaining_after_projected)}</dd>
         ${b.planned_projects ? `<dt>Planned needs &amp; projects (est.)</dt><dd class="num">${money(b.planned_projects)}</dd>` : ''}
       </dl>`}
  </section>`;
}

export async function render() {
  const s = await api('GET', '/api/summary');
  setCache(s.attention); // "Mark done" on the dashboard reads from here

  const attention = s.attention.map((m) => maintenanceCard(m, { compact: true })).join('');
  const warranties = s.warranties.map((a) => `<article class="item"><div class="item-top"><div class="item-name">${esc(a.name)}</div>${pill(a.warranty_status, 'Expiring')}</div>${warrantyBlock(a)}</article>`).join('');
  const aging = s.aging.map((a) => `<article class="item"><div class="item-top"><div class="item-name">${esc(a.name)}</div>${pill(a.life_status === 'end' ? 'expired' : 'expiring', a.life_status === 'end' ? 'Past expected life' : 'Aging')}</div>${lifeBlock(a)}</article>`).join('');
  const progress = s.in_progress.map((t) => `<article class="item"><div class="item-top"><div class="item-name">${esc(t.title)}</div>${pill(t.priority, cap(t.priority))}</div><div class="meta"><span>${t.kind === 'need' ? 'Need' : 'Project'}</span>${t.estimated_cost != null ? `<span>Est. <strong>${money(t.estimated_cost)}</strong></span>` : ''}</div></article>`).join('');

  app.innerHTML = `
    <div class="page-head"><div><h1>Dashboard</h1><p class="sub">${fmtDate(s.today)} · ${plural(s.counts.maintenance, 'maintenance item')}, ${plural(s.counts.appliances, 'appliance')}</p></div></div>
    <div class="grid">
      ${scoreCard(s.score)}
      ${budgetCard(s.budget)}
      <section class="card">
        <h2>Needs attention</h2>
        <div class="stack">${attention || '<div class="empty">Nothing due soon. You\'re all caught up.</div>'}</div>
        ${s.unscheduled ? `<p class="small muted" style="margin:12px 0 0">${plural(s.unscheduled, 'item')} without a service month. <a href="#/maintenance">Schedule them</a></p>` : ''}
        ${s.snoozed ? `<p class="small muted" style="margin:${s.unscheduled ? 4 : 12}px 0 0">${plural(s.snoozed, 'item')} snoozed.</p>` : ''}
      </section>
      <section class="card">
        <h2>Warranties ending soon</h2>
        <div class="stack">${warranties || '<div class="empty">No warranties ending soon.</div>'}</div>
      </section>
      ${aging ? `<section class="card"><h2>Plan ahead</h2><div class="stack">${aging}</div></section>` : ''}
      <section class="card">
        <h2>In progress <a class="small" href="#/projects">All projects</a></h2>
        <div class="stack">${progress || `<div class="empty">Nothing in progress. ${plural(s.counts.projects_open, 'project')} and ${plural(s.counts.needs_open, 'need')} on the list.</div>`}</div>
      </section>
    </div>`;
}

export const actions = {};
