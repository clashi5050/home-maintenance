// Pure scheduling logic: when is a maintenance item next due, and when does a warranty end.
import { MONTH_NAMES, addDays, addMonths, daysBetween, endOfMonth, pad, prettyDate } from './dates.js';

/**
 * Items with a service month and a yearly interval are "anchored": they are due
 * during that month (the whole month counts as the due window). Everything else
 * is due on an exact date, last completion + interval.
 *
 * With no history, an item is scheduled for the next upcoming occurrence of its
 * service month (this year if the month hasn't ended, otherwise next year).
 */
export function nextDue(item, lastDone, todayStr) {
  const month = item.service_month || null;
  const interval = item.interval_months || 12;

  if (lastDone) {
    const base = addMonths(lastDone, interval);
    if (month && interval % 12 === 0) return { start: snapToMonth(base, month), anchored: true };
    return { start: base, anchored: false };
  }
  if (!month) return null;

  const year = Number(todayStr.slice(0, 4));
  let start = `${year}-${pad(month)}-01`;
  if (endOfMonth(start) < todayStr) start = `${year + 1}-${pad(month)}-01`;
  return { start, anchored: true };
}

/** First day of `month` in the year closest to `base`, so early/late completions stay on cycle. */
function snapToMonth(base, month) {
  const year = Number(base.slice(0, 4));
  let best = null;
  let bestDiff = Infinity;
  for (const y of [year - 1, year, year + 1]) {
    const candidate = `${y}-${pad(month)}-01`;
    const diff = Math.abs(daysBetween(base, candidate));
    if (diff < bestDiff) {
      best = candidate;
      bestDiff = diff;
    }
  }
  return best;
}

export function dueInfo(item, lastDone, todayStr, leadDays) {
  const nd = nextDue(item, lastDone, todayStr);
  if (!nd) return { next_due: null, due_end: null, anchored: false, status: 'unscheduled', days_until: null, due_label: null };

  const end = nd.anchored ? endOfMonth(nd.start) : nd.start;
  let status;
  if (todayStr > end) status = 'overdue';
  else if (todayStr >= nd.start) status = 'due';
  else if (daysBetween(todayStr, nd.start) <= leadDays) status = 'upcoming';
  else status = 'ok';

  return {
    next_due: nd.start,
    due_end: end,
    anchored: nd.anchored,
    status,
    days_until: daysBetween(todayStr, nd.start),
    due_label: nd.anchored ? `${MONTH_NAMES[Number(nd.start.slice(5, 7)) - 1]} ${nd.start.slice(0, 4)}` : prettyDate(nd.start),
  };
}

export function warrantyInfo(appliance, todayStr, leadDays) {
  const { purchase_date: purchase, warranty_length: length, warranty_unit: unit } = appliance;
  if (!purchase || !length) return { warranty_end: null, days_left: null, total_days: null, warranty_status: 'none' };

  const end =
    unit === 'days' ? addDays(purchase, length)
    : unit === 'months' ? addMonths(purchase, length)
    : addMonths(purchase, length * 12);
  const daysLeft = daysBetween(todayStr, end);

  return {
    warranty_end: end,
    days_left: daysLeft,
    total_days: daysBetween(purchase, end),
    warranty_status: daysLeft < 0 ? 'expired' : daysLeft <= leadDays ? 'expiring' : 'active',
  };
}
