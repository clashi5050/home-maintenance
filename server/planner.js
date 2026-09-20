// Year-at-a-glance planner and the iCalendar feed. Both are built from the same
// list of upcoming events, projected from each item's schedule.
import { addDays, addMonths, MONTH_NAMES, today } from './dates.js';
import { listAppliances, listMaintenance } from './resources.js';

/**
 * Every maintenance occurrence, warranty end and replacement date within the window.
 * Recurring items are projected forward assuming each one is done on schedule.
 * Overdue items appear in the first month, flagged.
 */
export function occurrences({ months = 12, todayStr = today() } = {}) {
  const start = `${todayStr.slice(0, 7)}-01`;
  const end = addMonths(start, months); // exclusive
  const events = [];

  for (const m of listMaintenance()) {
    if (!m.next_due) continue;
    const base = {
      type: 'maintenance', id: m.id, name: m.name, cost: m.estimated_cost, vendor_name: m.vendor_name,
      vendor_phone: m.vendor_phone, anchored: m.anchored, notes: m.notes,
    };
    let date = m.next_due;
    if (date < start) {
      events.push({ ...base, date: start, overdue: true, was_due: m.next_due, label: m.due_label });
      while (date < start) date = addMonths(date, m.interval_months);
    }
    for (; date < end; date = addMonths(date, m.interval_months)) {
      events.push({ ...base, date, overdue: false, label: date === m.next_due ? m.due_label : null });
    }
  }

  for (const a of listAppliances()) {
    if (a.warranty_end && a.warranty_end >= start && a.warranty_end < end) {
      events.push({ type: 'warranty', id: a.id, name: `${a.name} warranty ends`, date: a.warranty_end, cost: null });
    }
    if (a.replace_by && a.replace_by >= start && a.replace_by < end) {
      events.push({ type: 'replace', id: a.id, name: `${a.name} reaches expected life`, date: a.replace_by, cost: null });
    }
  }
  return events.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}

/** Twelve month buckets with the work and the estimated spend for each. */
export function buildPlanner({ months = 12, todayStr = today() } = {}) {
  const start = `${todayStr.slice(0, 7)}-01`;
  const buckets = Array.from({ length: months }, (_, i) => {
    const first = addMonths(start, i);
    return {
      key: first.slice(0, 7),
      label: `${MONTH_NAMES[Number(first.slice(5, 7)) - 1]} ${first.slice(0, 4)}`,
      items: [],
      total: 0,
    };
  });
  const byKey = new Map(buckets.map((b) => [b.key, b]));

  for (const e of occurrences({ months, todayStr })) {
    const bucket = byKey.get(e.date.slice(0, 7));
    if (!bucket) continue;
    bucket.items.push(e);
    if (e.type === 'maintenance') bucket.total += e.cost ?? 0;
  }
  return { start, months: buckets, total: buckets.reduce((sum, b) => sum + b.total, 0) };
}

// ---- iCalendar ------------------------------------------------------------------

const BACKSLASH = '\\';
const icsText = (s) => String(s ?? '')
  .replaceAll(BACKSLASH, BACKSLASH + BACKSLASH)
  .replaceAll(';', `${BACKSLASH};`)
  .replaceAll(',', `${BACKSLASH},`)
  .replace(/\r?\n/g, `${BACKSLASH}n`);

/** RFC 5545 requires lines to be folded at 75 octets. */
function fold(line) {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const parts = [];
  let i = 0;
  let limit = 75;
  while (i < bytes.length) {
    let end = Math.min(i + limit, bytes.length);
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--; // don't split a UTF-8 character
    parts.push(bytes.subarray(i, end).toString('utf8'));
    i = end;
    limit = 74; // continuation lines start with a space
  }
  return parts.join('\r\n ');
}

const compact = (date) => date.replaceAll('-', '');
const stamp = (now) => now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

export function buildIcs({ months = 18, now = new Date(), todayStr = today(now) } = {}) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Home Maintenance//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Home Maintenance',
    'REFRESH-INTERVAL;VALUE=DURATION:PT12H',
  ];

  for (const e of occurrences({ months, todayStr })) {
    const prefix = e.overdue ? 'OVERDUE: ' : e.type === 'maintenance' ? (e.anchored ? 'Due this month: ' : '') : '';
    const detail = [
      e.overdue && e.was_due ? `Was due ${e.label}.` : '',
      e.cost != null ? `Estimated cost: $${e.cost}` : '',
      e.vendor_name ? `Vendor: ${e.vendor_name}${e.vendor_phone ? ` ${e.vendor_phone}` : ''}` : '',
      e.notes ?? '',
    ].filter(Boolean).join('\n');

    lines.push(
      'BEGIN:VEVENT',
      `UID:hm-${e.type}-${e.id}-${compact(e.date)}@home-maintenance`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART;VALUE=DATE:${compact(e.date)}`,
      `DTEND;VALUE=DATE:${compact(addDays(e.date, 1))}`,
      `SUMMARY:${icsText(prefix + e.name)}`,
      ...(detail ? [`DESCRIPTION:${icsText(detail)}`] : []),
      'CATEGORIES:Home Maintenance',
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

