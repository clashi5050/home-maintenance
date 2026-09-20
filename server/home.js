// Things that look across the whole home: the score, the printable report,
// CSV export, and global search.
import { db } from './db.js';
import { addMonths, today } from './dates.js';
import { homeScore } from './lifecycle.js';
import {
  getProfile, list, listAppliances, listCompletions, listMaintenance,
} from './resources.js';
import { listDocuments } from './documents.js';

export function currentScore() {
  const maintenance = listMaintenance().map((m) => ({ ...m, status: m.base_status }));
  const appliances = listAppliances();
  const documentApplianceIds = new Set(
    db.prepare('SELECT DISTINCT appliance_id FROM documents WHERE appliance_id IS NOT NULL').all().map((r) => r.appliance_id),
  );
  const { n: completionsLast12m } = db.prepare('SELECT COUNT(*) AS n FROM completions WHERE done_on >= ?').get(addMonths(today(), -12));
  return homeScore({ maintenance, appliances, documentApplianceIds, completionsLast12m });
}

/** Everything a buyer, insurer or accountant might want, in one payload for the print view. */
export function buildReport() {
  const log = listCompletions();
  const byYear = {};
  for (const entry of log) {
    const year = entry.done_on.slice(0, 4);
    const bucket = (byYear[year] ??= { year: Number(year), entries: [], total: 0 });
    bucket.entries.push(entry);
    bucket.total += entry.cost ?? 0;
  }
  const years = Object.values(byYear).sort((a, b) => b.year - a.year);
  const projects = list('tasks', "WHERE t.status = 'done'");

  return {
    generated: today(),
    profile: getProfile(),
    facts: list('facts'),
    score: currentScore(),
    appliances: listAppliances(),
    maintenance: listMaintenance(),
    log_by_year: years,
    completed_projects: projects,
    documents: listDocuments(),
    vendors: list('vendors'),
    totals: {
      logged: log.reduce((sum, e) => sum + (e.cost ?? 0), 0),
      projects: projects.reduce((sum, p) => sum + (p.actual_cost ?? 0), 0),
      entries: log.length,
    },
  };
}

const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

/** The full home log as a spreadsheet, for taxes, insurance or a sale. */
export function historyCsv({ year } = {}) {
  const rows = [['Date', 'Type', 'Job', 'Appliance', 'Done by', 'DIY', 'Cost', 'Notes']];
  for (const e of listCompletions({ year })) {
    rows.push([e.done_on, e.kind, e.name, e.appliance_name, e.vendor_name, e.diy ? 'yes' : '', e.cost, e.notes]);
  }
  return `${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

// ---- Search ---------------------------------------------------------------------

const ESC = '!';
const likeOf = (q) => `%${q.replace(/[!%_]/g, '!$&')}%`;

export function search(q, perType = 6) {
  const term = String(q ?? '').trim();
  if (term.length < 2) return [];
  const like = likeOf(term);
  const results = [];
  const run = (type, route, sql, map) => {
    const likes = Array(sql.match(/\?/g).length - 1).fill(like); // every placeholder but LIMIT
    for (const row of db.prepare(sql).all(...likes, perType)) {
      results.push({ type, route, id: row.id, ...map(row) });
    }
  };
  const L = (col) => `${col} LIKE ? ESCAPE '${ESC}'`;

  run('Maintenance', 'maintenance',
    `SELECT id, name, notes FROM maintenance_items WHERE ${L('name')} OR ${L('notes')} LIMIT ?`,
    (r) => ({ title: r.name, sub: r.notes }));
  run('Appliance', 'appliances',
    `SELECT id, name, brand, model, location FROM appliances WHERE ${L('name')} OR ${L('brand')} OR ${L('model')} OR ${L('serial')} OR ${L('location')} LIMIT ?`,
    (r) => ({ title: r.name, sub: [r.brand, r.model, r.location].filter(Boolean).join(' · ') }));
  run('Vendor', 'vendors',
    `SELECT id, name, category, phone FROM vendors WHERE ${L('name')} OR ${L('category')} OR ${L('phone')} OR ${L('notes')} LIMIT ?`,
    (r) => ({ title: r.name, sub: [r.category, r.phone].filter(Boolean).join(' · ') }));
  run('Project', 'projects',
    `SELECT id, title, kind, status FROM tasks WHERE ${L('title')} OR ${L('notes')} LIMIT ?`,
    (r) => ({ title: r.title, sub: `${r.kind} · ${r.status.replace('_', ' ')}` }));
  run('Document', 'documents',
    `SELECT id, title, category FROM documents WHERE ${L('title')} OR ${L('filename')} OR ${L('notes')} LIMIT ?`,
    (r) => ({ title: r.title, sub: r.category }));
  run('Log', 'log',
    `SELECT c.id, COALESCE(c.title, m.name) AS name, c.done_on FROM completions c LEFT JOIN maintenance_items m ON m.id = c.item_id
       WHERE ${L('c.title')} OR ${L('m.name')} OR ${L('c.notes')} LIMIT ?`,
    (r) => ({ title: r.name, sub: r.done_on }));
  run('Home fact', 'home',
    `SELECT id, label, value FROM home_facts WHERE ${L('label')} OR ${L('value')} OR ${L('group_name')} LIMIT ?`,
    (r) => ({ title: r.label, sub: r.value }));
  return results;
}

