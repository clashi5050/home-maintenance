import { db } from './db.js';
import { today } from './dates.js';
import { currentScore } from './home.js';
import { list, listAppliances, listMaintenance } from './resources.js';
import { HttpError } from './validate.js';

const sumOf = (sql, ...params) => db.prepare(sql).get(...params).total;

export function budgetFor(year, maintenance = listMaintenance()) {
  // A budget carries forward until you set a new one for a later year.
  const row = db.prepare('SELECT amount FROM budgets WHERE year <= ? ORDER BY year DESC LIMIT 1').get(year);
  const amount = row ? row.amount : null;
  const y = String(year);

  const spentMaintenance = sumOf('SELECT COALESCE(SUM(cost), 0) AS total FROM completions WHERE substr(done_on, 1, 4) = ?', y);
  const spentProjects = sumOf(
    'SELECT COALESCE(SUM(actual_cost), 0) AS total FROM tasks WHERE completed_on IS NOT NULL AND substr(completed_on, 1, 4) = ?',
    y,
  );

  // Maintenance still expected this year, including overdue items (only meaningful for the current year).
  const isCurrent = y === today().slice(0, 4);
  const projected = isCurrent
    ? maintenance
        .filter((m) => m.next_due && m.next_due.slice(0, 4) <= y)
        .reduce((sum, m) => sum + (m.estimated_cost ?? 0), 0)
    : 0;
  const planned = isCurrent
    ? sumOf("SELECT COALESCE(SUM(estimated_cost), 0) AS total FROM tasks WHERE status IN ('planned', 'in_progress')")
    : 0;

  const spent = spentMaintenance + spentProjects;
  return {
    year,
    amount,
    spent_maintenance: spentMaintenance,
    spent_projects: spentProjects,
    spent,
    projected_maintenance: projected,
    planned_projects: planned,
    remaining: amount == null ? null : amount - spent,
    remaining_after_projected: amount == null ? null : amount - spent - projected,
  };
}

export function setBudget(year, amount) {
  if (!Number.isInteger(year) || year < 2000 || year > 2200) throw new HttpError(400, 'Year is not valid');
  if (amount == null || amount === '') {
    db.prepare('DELETE FROM budgets WHERE year = ?').run(year);
  } else {
    const n = Number(amount);
    if (!Number.isFinite(n) || n < 0 || n > 1e9) throw new HttpError(400, 'Budget must be a positive amount');
    db.prepare('INSERT INTO budgets (year, amount) VALUES (?, ?) ON CONFLICT(year) DO UPDATE SET amount = excluded.amount').run(year, n);
  }
  return budgetFor(year);
}

export function summary() {
  const t = today();
  const year = Number(t.slice(0, 4));
  const maintenance = listMaintenance();
  const appliances = listAppliances();

  return {
    today: t,
    budget: budgetFor(year, maintenance),
    attention: maintenance.filter((m) => ['overdue', 'due', 'upcoming'].includes(m.status)),
    unscheduled: maintenance.filter((m) => m.status === 'unscheduled').length,
    warranties: appliances.filter((a) => a.warranty_status === 'expiring'),
    aging: appliances.filter((a) => a.life_status === 'aging' || a.life_status === 'end'),
    snoozed: maintenance.filter((m) => m.status === 'snoozed').length,
    score: currentScore(),
    in_progress: list('tasks', "WHERE t.status = 'in_progress'"),
    counts: {
      maintenance: maintenance.length,
      appliances: appliances.length,
      needs_open: db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE kind = 'need' AND status != 'done'").get().n,
      projects_open: db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE kind = 'project' AND status != 'done'").get().n,
    },
  };
}
