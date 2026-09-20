// Date-only helpers. Dates are 'YYYY-MM-DD' strings and all math is done in UTC
// so daylight-saving changes can never shift a date.

const DAY = 86400000;

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const pad = (n) => String(n).padStart(2, '0');

/** Today's date in the process time zone (set TZ in the container). */
export function today(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export const parse = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};

export const format = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

export const isValidDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && format(parse(s)) === s;

export const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / DAY);

export const addDays = (s, n) => format(new Date(parse(s).getTime() + n * DAY));

/** Adds months, clamping the day (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(s, n) {
  const d = parse(s);
  const day = d.getUTCDate();
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const lastDay = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(day, lastDay));
  return format(t);
}

export const endOfMonth = (s) => {
  const d = parse(s);
  return format(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
};

export const prettyDate = (s) =>
  parse(s).toLocaleDateString('en-US', { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' });
