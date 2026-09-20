// Equipment age and end-of-life tracking, plus the Home Score.
import { addMonths, daysBetween } from './dates.js';

const YEAR_DAYS = 365.25;

/**
 * Age against expected life. Needs a purchase/install date and an expected life in years.
 * Status: ok (<80% of life used), aging (80-100%), end (past expected life).
 */
export function lifespanInfo(appliance, todayStr) {
  const { purchase_date: purchase, expected_life_years: life } = appliance;
  if (!purchase || !life) {
    return { age_years: null, life_pct: null, replace_by: null, life_status: 'none' };
  }
  const ageDays = daysBetween(purchase, todayStr);
  const pct = ageDays / (life * YEAR_DAYS);
  return {
    age_years: Math.max(0, Math.round((ageDays / YEAR_DAYS) * 10) / 10),
    life_pct: Math.max(0, Math.round(pct * 100)),
    replace_by: addMonths(purchase, life * 12),
    life_status: pct >= 1 ? 'end' : pct >= 0.8 ? 'aging' : 'ok',
  };
}

const clamp01 = (n) => Math.max(0, Math.min(1, n));

/**
 * A 0-100 "how well is this home being looked after" number, built from five parts you can
 * act on. It is a simple heuristic, not an appraisal: each part reports its points and a tip.
 *
 *   Schedule health  40  scheduled items that are not overdue
 *   Planning         20  items that have a schedule at all
 *   Records          15  appliances with purchase/warranty info and a document on file
 *   Equipment age    10  appliances not past their expected life
 *   Follow-through   15  work logged in the last 12 months vs. items being tracked
 */
export function homeScore({ maintenance, appliances, documentApplianceIds, completionsLast12m }) {
  const parts = [];
  const scheduled = maintenance.filter((m) => m.status !== 'unscheduled');
  const overdue = scheduled.filter((m) => m.status === 'overdue');

  // 1. Schedule health
  {
    const frac = scheduled.length ? 1 - overdue.length / scheduled.length : 0.5;
    parts.push({
      key: 'schedule', label: 'Schedule health', max: 40, frac,
      tip: !scheduled.length ? 'Give your maintenance items a service month so they can be tracked.'
        : overdue.length ? `${overdue.length} overdue: ${overdue.slice(0, 3).map((m) => m.name).join(', ')}${overdue.length > 3 ? '…' : ''}.`
        : 'Nothing is overdue.',
    });
  }

  // 2. Planning
  {
    const frac = maintenance.length ? scheduled.length / maintenance.length : 0;
    const missing = maintenance.length - scheduled.length;
    parts.push({
      key: 'planning', label: 'Planning', max: 20, frac,
      tip: !maintenance.length ? 'Add items from Suggestions to build your plan.'
        : missing ? `${missing} item${missing === 1 ? ' has' : 's have'} no service month yet.` : 'Every item has a schedule.',
    });
  }

  // 3. Records
  {
    if (!appliances.length) {
      parts.push({ key: 'records', label: 'Records', max: 15, frac: 0.5, tip: 'Add your appliances and attach warranties or manuals.' });
    } else {
      const info = appliances.filter((a) => a.purchase_date && a.warranty_length).length / appliances.length;
      const docs = appliances.filter((a) => documentApplianceIds.has(a.id)).length / appliances.length;
      const frac = (info + docs) / 2;
      parts.push({
        key: 'records', label: 'Records', max: 15, frac,
        tip: docs < 1 ? `${appliances.length - Math.round(docs * appliances.length)} appliance(s) have no document attached.`
          : info < 1 ? 'Some appliances are missing a purchase date or warranty length.' : 'Appliance records are complete.',
      });
    }
  }

  // 4. Equipment age
  {
    const aged = appliances.filter((a) => a.life_status !== 'none');
    const past = aged.filter((a) => a.life_status === 'end');
    const aging = aged.filter((a) => a.life_status === 'aging');
    const frac = aged.length ? clamp01(1 - (past.length + aging.length * 0.4) / aged.length) : 0.5;
    parts.push({
      key: 'equipment', label: 'Equipment age', max: 10, frac,
      tip: !aged.length ? 'Add purchase dates and expected life to see equipment age.'
        : past.length ? `${past.map((a) => a.name).join(', ')} past expected life.`
        : aging.length ? `${aging.map((a) => a.name).join(', ')} approaching end of life.` : 'Equipment is within its expected life.',
    });
  }

  // 5. Follow-through
  {
    const tracked = Math.max(1, scheduled.length);
    const frac = clamp01(completionsLast12m / tracked);
    parts.push({
      key: 'followthrough', label: 'Follow-through', max: 15, frac,
      tip: completionsLast12m ? `${completionsLast12m} job${completionsLast12m === 1 ? '' : 's'} logged in the last 12 months.` : 'Log completed work to build your record.',
    });
  }

  for (const p of parts) p.points = Math.round(p.frac * p.max * 10) / 10;
  const score = Math.round(parts.reduce((sum, p) => sum + p.points, 0));
  const grade = score >= 85 ? 'Excellent' : score >= 70 ? 'Good' : score >= 50 ? 'Fair' : 'Needs attention';
  return { score, grade, parts: parts.map(({ frac, ...p }) => p) };
}
