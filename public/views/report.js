// A printable summary of the house for a buyer, an insurer or your accountant.
import { api, app, cap, esc, fmtDate, money } from '../lib.js';

const row = (cells, cls = '') => `<tr class="${cls}">${cells.map((c, i) => `<td${i === cells.length - 1 && /^\$/.test(String(c)) ? ' class="r num"' : ''}>${c}</td>`).join('')}</tr>`;
const section = (title, body) => `<section class="rep-section"><h2>${esc(title)}</h2>${body}</section>`;
const table = (head, rows) => (rows.length
  ? `<table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`
  : '<p class="muted">None recorded.</p>');

export async function render() {
  const r = await api('GET', '/api/report');
  const p = r.profile;
  const title = p.name || p.address || 'My home';

  const details = [
    p.address && ['Address', p.address], p.year_built && ['Year built', p.year_built], p.sq_ft && ['Size', `${p.sq_ft.toLocaleString()} sq ft`],
    p.bedrooms && ['Bedrooms', p.bedrooms], p.bathrooms && ['Bathrooms', p.bathrooms],
    p.purchase_date && ['Purchased', fmtDate(p.purchase_date)], p.purchase_price && ['Purchase price', money(p.purchase_price)],
    p.insurance_provider && ['Insurance', `${p.insurance_provider}${p.insurance_policy ? `, policy ${p.insurance_policy}` : ''}`],
  ].filter(Boolean);

  app.innerHTML = `
    <div class="page-head no-print"><div><h1>Home report</h1><p class="sub">Everything about the house in one printable page. Use Print, then choose Save as PDF.</p></div>
      <div class="head-actions"><a class="btn" href="#/home">Back</a><button class="btn primary" data-action="print-report">Print or save as PDF</button></div></div>
    <article class="report">
      <header class="rep-head"><h1>${esc(title)}</h1><p>Home maintenance report · ${fmtDate(r.generated)}</p></header>
      ${details.length ? `<dl class="rep-details">${details.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : ''}
      ${p.notes ? `<p>${esc(p.notes)}</p>` : ''}
      <p class="rep-score"><strong>Home Score: ${r.score.score} / 100 (${esc(r.score.grade)})</strong></p>

      ${section('Appliances and systems', table(['Item', 'Type / details', 'Installed', 'Warranty', 'Age / expected life'], r.appliances.map((a) => row([
    `<strong>${esc(a.name)}</strong>${a.location ? `<br>${esc(a.location)}` : ''}`,
    esc([a.brand, a.model, a.serial && `S/N ${a.serial}`].filter(Boolean).join(' · ')),
    a.purchase_date ? fmtDate(a.purchase_date) : '—',
    a.warranty_end ? `${a.warranty_status === 'expired' ? 'Expired' : 'Until'} ${fmtDate(a.warranty_end)}` : '—',
    a.age_years != null ? `${a.age_years} of ${a.expected_life_years} years` : '—',
  ]))))}

      ${section('Maintenance schedule', table(['Task', 'Repeats', 'Last done', 'Next due', 'Vendor'], r.maintenance.map((m) => row([
    `<strong>${esc(m.name)}</strong>`,
    m.interval_months === 12 ? 'Yearly' : `Every ${m.interval_months} months`,
    m.last_done ? fmtDate(m.last_done) : 'Never logged',
    esc(m.due_label ?? 'Not scheduled'),
    esc(m.vendor_name ?? ''),
  ]))))}

      ${section('Service history', r.log_by_year.length ? r.log_by_year.map((y) => `<h3>${y.year} <span class="rep-sub">${money(y.total)}</span></h3>${table(['Date', 'Job', 'Type', 'Done by', 'Cost'], y.entries.map((e) => row([
    fmtDate(e.done_on),
    `${esc(e.name)}${e.appliance_name ? `<br><span class="muted">${esc(e.appliance_name)}</span>` : ''}`,
    esc(cap(e.kind)),
    e.diy ? 'Owner' : esc(e.vendor_name ?? ''),
    money(e.cost),
  ])))}`).join('') + `<p class="rep-total"><strong>Total recorded: ${money(r.totals.logged)}</strong> across ${r.totals.entries} entries</p>` : '<p class="muted">Nothing logged yet.</p>')}

      ${r.completed_projects.length ? section('Completed projects and purchases', table(['Completed', 'Project', 'Cost'], r.completed_projects.map((t) => row([
    fmtDate(t.completed_on), `<strong>${esc(t.title)}</strong>${t.notes ? `<br>${esc(t.notes)}` : ''}`, money(t.actual_cost),
  ])))) : ''}

      ${r.facts.length ? section('Home facts', `<dl class="rep-details">${r.facts.map((f) => `<div><dt>${esc(f.label)}</dt><dd>${esc(f.value)}</dd></div>`).join('')}</dl>`) : ''}

      ${section('Documents on file', table(['Document', 'Category', 'Belongs to', 'Added'], r.documents.map((d) => row([
    `<strong>${esc(d.title)}</strong>`, esc(cap(d.category)),
    esc([d.appliance_name, d.item_name, d.task_title, d.vendor_name].filter(Boolean).join(', ')), fmtDate(d.uploaded_at.slice(0, 10)),
  ]))))}

      ${section('Trusted vendors', table(['Name', 'Trade', 'Phone'], r.vendors.map((v) => row([`<strong>${esc(v.name)}</strong>`, esc(v.category ?? ''), esc(v.phone ?? '')]))))}
    </article>`;
}

export const actions = { 'print-report': () => window.print() };
