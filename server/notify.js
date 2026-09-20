// Push notifications via ntfy (https://ntfy.sh, or your own ntfy server).
import { db, getSettings, saveSetting } from './db.js';
import { addDays, pad, parse, prettyDate, today } from './dates.js';
import { blockPrivateUrls, guardedPost } from './netguard.js';
import { listAppliances, listMaintenance } from './resources.js';
import { HttpError } from './validate.js';

const WEEK_MS = 7 * 86400000;

export async function sendNtfy(settings, { title, message, priority = 3, tags = 'house' }) {
  if (!settings.ntfy_topic) throw new HttpError(400, 'Set an ntfy topic first');
  const base = settings.ntfy_url.replace(/\/+$/, '');
  const headers = { Title: title, Priority: String(priority), Tags: tags };
  if (settings.ntfy_token) headers.Authorization = `Bearer ${settings.ntfy_token}`;
  if (settings.app_url) headers.Click = settings.app_url; // tapping the notification opens the app
  const target = `${base}/${encodeURIComponent(settings.ntfy_topic)}`;

  let res;
  try {
    // On a shared deployment the address is typed in by users, so it must not reach internal networks.
    res = blockPrivateUrls()
      ? await guardedPost(target, { headers, body: message })
      : await fetch(target, { method: 'POST', headers, body: message, signal: AbortSignal.timeout(10_000) });
  } catch (err) {
    throw new HttpError(502, `Could not reach ${base}: ${err.cause?.code ?? err.code ?? err.message}`);
  }
  const ok = res.ok ?? (res.status >= 200 && res.status < 300); // guardedPost never follows redirects, so 3xx is a failure
  if (!ok) throw new HttpError(502, `ntfy answered ${res.status} ${res.statusText}`.trim());
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const vendorSuffix = (m) => (m.vendor_name ? ` - ${m.vendor_name}${m.vendor_phone ? ` ${m.vendor_phone}` : ''}` : '');

/** Everything that deserves a nudge right now. Each alert has a key so it is only sent once. */
export function collectAlerts(now = new Date()) {
  const t = today(now);
  const week = Math.floor(parse(t).getTime() / WEEK_MS);
  const alerts = [];

  for (const m of listMaintenance()) {
    const base = `m:${m.id}:${m.next_due}`;
    if (m.status === 'overdue') {
      // Overdue items repeat weekly until you mark them done.
      alerts.push({ key: `${base}:overdue:${week}`, urgent: true, text: `${m.name} is overdue (was due ${m.due_label})${vendorSuffix(m)}` });
    } else if (m.status === 'due') {
      alerts.push({ key: `${base}:due`, text: `${m.name} is due now (${m.due_label})${vendorSuffix(m)}` });
    } else if (m.status === 'upcoming') {
      alerts.push({ key: `${base}:soon`, text: `${m.name} comes due ${m.due_label}, in ${plural(m.days_until, 'day')}${vendorSuffix(m)}` });
    }
  }

  for (const a of listAppliances()) {
    if (a.warranty_status !== 'expiring') continue;
    const stage = a.days_left <= 7 ? 'week' : 'soon';
    alerts.push({
      key: `w:${a.id}:${a.warranty_end}:${stage}`,
      urgent: stage === 'week',
      text: `${a.name} warranty ends ${prettyDate(a.warranty_end)} (${plural(a.days_left, 'day')} left)`,
    });
  }

  // Equipment nearing the end of its expected life: one nudge per year per stage.
  for (const a of listAppliances()) {
    if (a.life_status !== 'aging' && a.life_status !== 'end') continue;
    const verb = a.life_status === 'end' ? 'is past its expected life' : 'is nearing the end of its expected life';
    alerts.push({
      key: `l:${a.id}:${t.slice(0, 4)}:${a.life_status}`,
      text: `${a.name} ${verb} (${a.age_years} of ${a.expected_life_years} years). Start planning a replacement.`,
    });
  }
  return alerts;
}

export async function runCheck({ now = new Date() } = {}) {
  const settings = getSettings();
  if (settings.notifications_enabled !== 'true') return { sent: 0, skipped: true, reason: 'Notifications are turned off' };
  if (!settings.ntfy_topic) return { sent: 0, skipped: true, reason: 'No ntfy topic set' };

  const seen = db.prepare('SELECT 1 FROM notification_log WHERE key = ?');
  const fresh = collectAlerts(now).filter((a) => !seen.get(a.key));
  if (!fresh.length) return { sent: 0, reason: 'Nothing new to report' };

  await sendNtfy(settings, {
    title: `Home Maintenance: ${plural(fresh.length, 'reminder')}`,
    message: fresh.map((a) => `- ${a.text}`).join('\n'),
    priority: fresh.some((a) => a.urgent) ? 4 : 3,
    tags: fresh.some((a) => a.urgent) ? 'warning' : 'house',
  });

  const stamp = today(now);
  const log = db.prepare('INSERT OR IGNORE INTO notification_log (key, sent_at) VALUES (?, ?)');
  for (const a of fresh) log.run(a.key, stamp);
  db.prepare('DELETE FROM notification_log WHERE sent_at < ?').run(addDays(stamp, -400));
  return { sent: fresh.length };
}

export function sendTest() {
  return sendNtfy(getSettings(), {
    title: 'Home Maintenance',
    message: 'Test notification. Reminders will show up here.',
    tags: 'white_check_mark',
  });
}

/** Checks every 10 minutes; once per day, after the configured time, sends the digest. */
export function startScheduler() {
  const tick = async () => {
    try {
      const now = new Date();
      const settings = getSettings();
      const t = today(now);
      const clock = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
      if (settings.last_notify_run === t || clock < settings.notify_time) return;

      const result = await runCheck({ now });
      // Don't burn today's run while notifications are off; turning them on later still sends.
      if (!result.skipped) saveSetting('last_notify_run', t);
    } catch (err) {
      console.error(`[notify] ${err.message} (will retry)`);
    }
  };
  const timer = setInterval(tick, 10 * 60 * 1000);
  timer.unref();
  setTimeout(tick, 5000).unref();
}
