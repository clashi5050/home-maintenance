import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-api-'));
let child;
let base;

const freePort = () => new Promise((resolve) => {
  const s = net.createServer().listen(0, () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

before(async () => {
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, SEED: 'false', MAX_UPLOAD_MB: '1', TZ: 'America/New_York', ANTHROPIC_API_KEY: '' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${base}/healthz`)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
});
after(() => { child?.kill(); });

const call = async (method, url, body) => {
  const res = await fetch(base + url, {
    method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data, headers: res.headers, text };
};
const ok = async (...args) => {
  const r = await call(...args);
  assert.ok(r.status < 300, `${args[0]} ${args[1]} -> ${r.status} ${r.text}`);
  return r.data;
};

const year = new Date().getFullYear();
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const upload = (name, body, query = '') => fetch(`${base}/api/documents${query}`, {
  method: 'POST', headers: { 'X-Filename': encodeURIComponent(name) }, body,
});

test('reference data and profile', async () => {
  const meta = await ok('GET', '/api/meta');
  assert.ok(meta.home_features.length > 10);
  assert.ok(meta.appliance_categories.find((c) => c.key === 'water_heater').years === 10);
  assert.equal(meta.max_upload_mb, 1);

  const profile = await ok('PUT', '/api/profile', { name: 'Maple St', year_built: 1994, sq_ft: 2400, features: ['gutters', 'fence', 'gutters'] });
  assert.deepEqual(profile.features, ['gutters', 'fence']);
  assert.equal((await call('PUT', '/api/profile', { features: ['not-a-feature'] })).status, 400);
  assert.equal((await call('PUT', '/api/profile', { year_built: 1200 })).status, 400);
});

test('suggestions follow the profile and add to the list once', async () => {
  const { items } = await ok('GET', '/api/suggestions');
  assert.equal(items.find((s) => s.key === 'gutter-clean').applicable, true);
  assert.equal(items.find((s) => s.key === 'pool-service').applicable, false);

  const added = await ok('POST', '/api/suggestions/gutter-clean/add', { service_month: 10, vendor_id: null });
  assert.equal(added.name, 'Clean gutters and downspouts');
  assert.equal(added.service_month, 10);
  assert.equal(added.interval_months, 6);
  assert.equal(added.template_key, 'gutter-clean');

  assert.equal((await call('POST', '/api/suggestions/gutter-clean/add', {})).status, 409);
  assert.equal((await call('POST', '/api/suggestions/nope/add', {})).status, 404);
  const again = await ok('GET', '/api/suggestions');
  assert.equal(again.items.find((s) => s.key === 'gutter-clean').added, true);
});

test('home log: recurring completions and one-off repairs, filters and CSV', async () => {
  const item = await ok('POST', '/api/maintenance', { name: 'HVAC service, spring', service_month: 4, estimated_cost: 230 });
  await ok('POST', `/api/maintenance/${item.id}/complete`, { done_on: `${year}-03-02`, cost: 245.5, diy: false });
  await ok('POST', '/api/history', { kind: 'repair', title: 'Fixed "leaky" faucet', done_on: `${year}-02-10`, cost: 40, diy: true, notes: 'washer, seat' });
  await ok('POST', '/api/history', { kind: 'upgrade', title: 'New thermostat', done_on: `${year - 1}-11-20`, cost: 180 });
  assert.equal((await call('POST', '/api/history', { done_on: `${year}-01-01` })).status, 400);
  assert.equal((await call('POST', '/api/history', { title: 'x', done_on: '2026-13-40' })).status, 400);

  const all = await ok('GET', '/api/history');
  assert.equal(all.entries.length, 3);
  assert.deepEqual((await ok('GET', `/api/history?year=${year}`)).entries.map((e) => e.name).sort(), ['Fixed "leaky" faucet', 'HVAC service, spring']);
  assert.deepEqual((await ok('GET', '/api/history?kind=upgrade')).entries.map((e) => e.name), ['New thermostat']);
  assert.equal((await ok('GET', `/api/history?item=${item.id}`)).entries.length, 1);

  const csv = await call('GET', `/api/history.csv?year=${year}`);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.match(csv.headers.get('content-disposition'), /attachment; filename="home-log-\d{4}-\d{2}-\d{2}\.csv"/);
  const lines = csv.text.trim().split('\r\n');
  assert.equal(lines[0], 'Date,Type,Job,Appliance,Done by,DIY,Cost,Notes');
  assert.ok(lines.some((l) => l.includes('"Fixed ""leaky"" faucet"') && l.includes('yes') && l.includes('"washer, seat"')), 'quotes and commas are escaped');
  assert.ok(lines.some((l) => l.includes('"HVAC service, spring"')));
});

test('documents: upload, serve safely, link, search and delete', async () => {
  const appliance = await ok('POST', '/api/appliances', { name: 'Refrigerator', category: 'refrigerator', purchase_date: `${year - 1}-01-01`, warranty_length: 2, expected_life_years: 13 });

  const res = await upload('Fridge warranty.png', PNG, `?category=warranty&appliance_id=${appliance.id}&notes=serial%20on%20back`);
  assert.equal(res.status, 201);
  const doc = await res.json();
  assert.equal(doc.title, 'Fridge warranty');
  assert.equal(doc.category, 'warranty');
  assert.equal(doc.appliance_name, 'Refrigerator');
  assert.equal(doc.mime, 'image/png');
  assert.equal(doc.size, PNG.length);

  const file = await fetch(`${base}/api/documents/${doc.id}/file`);
  assert.equal(file.status, 200);
  assert.equal(file.headers.get('content-type'), 'image/png');
  assert.match(file.headers.get('content-disposition'), /^inline;/);
  assert.equal(file.headers.get('x-content-type-options'), 'nosniff');
  assert.match(file.headers.get('content-security-policy'), /sandbox/);
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), PNG);
  assert.match((await fetch(`${base}/api/documents/${doc.id}/file?download=1`)).headers.get('content-disposition'), /^attachment;/);

  assert.equal((await ok('GET', `/api/documents?appliance_id=${appliance.id}`)).length, 1);
  assert.equal((await ok('GET', '/api/documents?q=fridge')).length, 1);
  assert.equal((await ok('GET', '/api/documents?q=100%25')).length, 0, 'LIKE wildcards are escaped');
  assert.equal((await ok('GET', '/api/documents?category=receipt')).length, 0);
  assert.equal((await ok('GET', `/api/appliances`)).find((a) => a.id === appliance.id).doc_count, 1);

  const renamed = await ok('PUT', `/api/documents/${doc.id}`, { title: 'Fridge warranty card', category: 'manual' });
  assert.equal(renamed.title, 'Fridge warranty card');

  // the file is on disk until the document is deleted
  const stored = fs.readdirSync(path.join(dataDir, 'files')).filter((f) => f.endsWith('.png'));
  assert.equal(stored.length, 1);
  assert.equal((await call('DELETE', `/api/documents/${doc.id}`)).status, 204);
  assert.equal(fs.readdirSync(path.join(dataDir, 'files')).filter((f) => f.endsWith('.png')).length, 0);
  assert.equal((await fetch(`${base}/api/documents/${doc.id}/file`)).status, 404);
});

test('documents: unsafe, mislabelled and oversized uploads are rejected', async () => {
  const before = fs.readdirSync(path.join(dataDir, 'files')).length;
  const rejects = async (name, body, status, pattern) => {
    const res = await upload(name, body);
    assert.equal(res.status, status, `${name}: ${await res.clone().text()}`);
    assert.match((await res.json()).error, pattern);
  };
  await rejects('page.html', '<script>alert(1)</script>', 415, /Unsupported file type/);
  await rejects('image.svg', '<svg onload="alert(1)"/>', 415, /Unsupported file type/);
  await rejects('run.exe', 'MZ', 415, /Unsupported file type/);
  await rejects('fake.png', '<html>not a png</html>', 415, /do not match/);
  await rejects('fake.pdf', 'GIF89a....', 415, /do not match/);
  await rejects('empty.txt', '', 400, /empty/);
  await rejects('big.txt', Buffer.alloc(1.5 * 1024 * 1024, 65), 413, /larger than 1 MB/);
  assert.equal((await upload('ok.png', PNG, '?category=nonsense')).status, 400);
  assert.equal((await upload('ok.png', PNG, '?vendor_id=9999')).status, 400, 'unknown links are refused');
  assert.equal(fs.readdirSync(path.join(dataDir, 'files')).length, before, 'no stray files are left behind');

  // a path in the filename never escapes the files folder
  const res = await upload('../../evil.txt', 'harmless');
  assert.equal(res.status, 201);
  const doc = await res.json();
  assert.equal(doc.filename, 'evil.txt');
  assert.ok(fs.readdirSync(path.join(dataDir, 'files')).every((f) => /^[0-9a-f-]{36}\.\w+$/.test(f)));
  const served = await fetch(`${base}/api/documents/${doc.id}/file`);
  assert.match(served.headers.get('content-disposition'), /^attachment;/, 'text files are always downloaded');
});

test('quotes: comparing and accepting one updates the project', async () => {
  const vendor = await ok('POST', '/api/vendors', { name: 'Fence Co', category: 'Fencing', rating: 5 });
  const other = await ok('POST', '/api/vendors', { name: 'Budget Fence' });
  const task = await ok('POST', '/api/tasks', { kind: 'project', title: 'Replace fence' });
  const q1 = await ok('POST', '/api/quotes', { task_id: task.id, vendor_id: vendor.id, amount: 6200, quote_date: `${year}-05-01` });
  await ok('POST', '/api/quotes', { task_id: task.id, vendor_id: other.id, amount: 4800 });

  const listed = await ok('GET', `/api/quotes?task_id=${task.id}`);
  assert.deepEqual(listed.map((q) => q.amount), [4800, 6200], 'cheapest first');
  const withQuotes = (await ok('GET', '/api/tasks')).find((t) => t.id === task.id);
  assert.equal(withQuotes.quote_count, 2);
  assert.equal(withQuotes.lowest_quote, 4800);

  const accepted = await ok('POST', `/api/quotes/${q1.id}/accept`);
  assert.equal(accepted.status, 'accepted');
  const after = (await ok('GET', '/api/tasks')).find((t) => t.id === task.id);
  assert.equal(after.estimated_cost, 6200);
  assert.equal(after.vendor_id, vendor.id);
  assert.equal(after.status, 'planned');
  assert.deepEqual((await ok('GET', `/api/quotes?task_id=${task.id}`)).map((q) => q.status).sort(), ['accepted', 'declined']);

  assert.equal((await call('POST', '/api/quotes', { task_id: task.id })).status, 400, 'amount is required');
  assert.equal((await call('DELETE', `/api/tasks/${task.id}`)).status, 204);
  assert.equal((await ok('GET', `/api/quotes?task_id=${task.id}`)).length, 0, 'quotes go with the project');
});

test('snooze hides an overdue item from attention without hiding the truth', async () => {
  const item = await ok('POST', '/api/maintenance', { name: 'Overdue thing', interval_months: 12 });
  await ok('POST', `/api/maintenance/${item.id}/complete`, { done_on: `${year - 2}-03-05` });
  let m = (await ok('GET', '/api/maintenance')).find((x) => x.id === item.id);
  assert.equal(m.status, 'overdue');
  assert.ok((await ok('GET', '/api/summary')).attention.some((x) => x.id === item.id));

  await ok('PUT', `/api/maintenance/${item.id}`, { snoozed_until: `${year + 1}-01-01` });
  m = (await ok('GET', '/api/maintenance')).find((x) => x.id === item.id);
  assert.equal(m.status, 'snoozed');
  assert.equal(m.base_status, 'overdue');
  const summary = await ok('GET', '/api/summary');
  assert.ok(!summary.attention.some((x) => x.id === item.id));
  assert.ok(summary.snoozed >= 1);

  await ok('POST', `/api/maintenance/${item.id}/complete`, { done_on: `${year}-01-01` });
  m = (await ok('GET', '/api/maintenance')).find((x) => x.id === item.id);
  assert.equal(m.snoozed_until, null, 'completing clears the snooze');
  assert.notEqual(m.status, 'snoozed');
});

test('planner projects a year of work with costs, and flags overdue items', async () => {
  const planner = await ok('GET', '/api/planner');
  assert.equal(planner.months.length, 12);
  assert.match(planner.months[0].label, /^[A-Z][a-z]+ \d{4}$/);
  const names = planner.months.flatMap((mo) => mo.items.map((i) => i.name));
  assert.ok(names.includes('Clean gutters and downspouts'));
  const gutters = planner.months.flatMap((mo) => mo.items).filter((i) => i.name === 'Clean gutters and downspouts');
  assert.ok(gutters.length >= 2, 'a 6-month item appears twice in 12 months');
  assert.ok(planner.months.every((mo) => mo.total === mo.items.filter((i) => i.type === 'maintenance').reduce((s, i) => s + (i.cost ?? 0), 0)));
  assert.equal((await ok('GET', '/api/planner?months=3')).months.length, 3);
  assert.equal((await ok('GET', '/api/planner?months=999')).months.length, 24, 'capped');
});

test('calendar feed is valid iCalendar', async () => {
  await ok('POST', '/api/maintenance', { name: 'Clean, "tricky"; name with a very long title that needs to be folded across several lines for the calendar format', service_month: 6 });
  const stale = await ok('POST', '/api/maintenance', { name: 'Long overdue job' });
  await ok('POST', `/api/maintenance/${stale.id}/complete`, { done_on: `${year - 3}-02-01` });
  const res = await call('GET', '/api/calendar.ics');
  assert.match(res.headers.get('content-type'), /text\/calendar/);
  const text = res.text;
  assert.ok(text.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(text.endsWith('END:VCALENDAR\r\n'));
  assert.equal(text.split('BEGIN:VEVENT').length, text.split('END:VEVENT').length);
  assert.ok(!/[^\r]\n/.test(text), 'lines end with CRLF');
  for (const line of text.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75, `line too long: ${line}`);
  const unfolded = text.replace(/\r\n /g, '');
  assert.match(unfolded, /SUMMARY:.*Clean\\, "tricky"\\; name with a very long title/);
  assert.match(unfolded, /DTSTART;VALUE=DATE:\d{8}/);
  assert.match(unfolded, /SUMMARY:OVERDUE: Long overdue job/, 'overdue work is called out');
  const uids = [...unfolded.matchAll(/^UID:(.+)$/gm)].map((m) => m[1]);
  assert.equal(new Set(uids).size, uids.length, 'UIDs are unique');
});

test('search spans every kind of record', async () => {
  await ok('POST', '/api/facts', { label: 'Main water shutoff', value: 'Garage, left wall behind the workbench', group_name: 'Plumbing' });
  await ok('POST', '/api/vendors', { name: 'Zed Plumbing', category: 'Plumbing', phone: '804-555-0199' });
  const hits = await ok('GET', '/api/search?q=plumb');
  const kinds = new Set(hits.map((h) => h.type));
  assert.ok(kinds.has('Vendor') && kinds.has('Home fact'), [...kinds].join());
  assert.deepEqual(await ok('GET', '/api/search?q=a'), [], 'too short to search');
  assert.deepEqual(await ok('GET', '/api/search?q=%25'), [], 'wildcards are literal');
  assert.ok((await ok('GET', '/api/search?q=faucet')).some((h) => h.type === 'Log'));
});

test('score, summary and report bring it together', async () => {
  const score = await ok('GET', '/api/score');
  assert.ok(score.score >= 0 && score.score <= 100);
  assert.equal(score.parts.length, 5);
  assert.ok(score.parts.every((p) => p.points <= p.max && p.tip));

  const summary = await ok('GET', '/api/summary');
  assert.equal(summary.score.score, score.score);
  assert.ok(Array.isArray(summary.aging));

  const report = await ok('GET', '/api/report');
  assert.equal(report.profile.name, 'Maple St');
  assert.ok(report.log_by_year.length >= 2);
  assert.equal(report.log_by_year[0].year, year);
  const spent = report.log_by_year.flatMap((y) => y.entries).reduce((s, e) => s + (e.cost ?? 0), 0);
  assert.equal(report.totals.logged, spent);
  assert.ok(report.facts.length >= 1 && report.vendors.length >= 3);
});

test('the budget counts repairs and upgrades as well as recurring jobs', async () => {
  await ok('PUT', '/api/budget', { amount: 5000 });
  const budget = await ok('GET', '/api/budget');
  // this year: HVAC 245.50 + faucet 40 + the thermostat was last year
  assert.ok(budget.spent_maintenance >= 285.5, `spent ${budget.spent_maintenance}`);
});

test('settings accept an app address for notification links', async () => {
  const saved = await ok('PUT', '/api/settings', { app_url: 'http://192.168.1.50:8085' });
  assert.equal(saved.app_url, 'http://192.168.1.50:8085');
  assert.equal((await call('PUT', '/api/settings', { app_url: 'javascript:alert(1)' })).status, 400);
  assert.equal((await ok('PUT', '/api/settings', { app_url: '' })).app_url, '');
});

test('assistant is off without an API key and says so', async () => {
  assert.deepEqual(await ok('GET', '/api/assistant'), { enabled: false, model: 'claude-opus-5' });
  const res = await call('POST', '/api/assistant', { messages: [{ role: 'user', text: 'help' }] });
  assert.equal(res.status, 503);
  assert.match(res.data.error, /ANTHROPIC_API_KEY/);
});

test('static files and routing stay locked down', async () => {
  assert.equal((await fetch(`${base}/`)).status, 200);
  assert.equal((await fetch(`${base}/app.js`)).status, 200);
  assert.equal((await fetch(`${base}/views/home.js`)).status, 200);
  assert.equal((await fetch(`${base}/%2e%2e/server/db.js`)).status, 404);
  assert.equal((await fetch(`${base}/api/nope`)).status, 404);
  assert.equal((await fetch(`${base}/`)).headers.get('x-content-type-options'), 'nosniff');
});

test('push digest: overdue, aging equipment, tap-to-open link, snooze respected, sent once', async () => {
  const received = [];
  const fake = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => { received.push({ url: req.url, headers: req.headers, body }); res.writeHead(200); res.end('{}'); });
  });
  await new Promise((resolve) => fake.listen(0, '127.0.0.1', resolve));
  try {
    await ok('POST', '/api/appliances', { name: 'Old furnace', category: 'furnace', purchase_date: `${year - 17}-01-01`, expected_life_years: 18 });
    const hidden = await ok('POST', '/api/maintenance', { name: 'Snoozed chore', interval_months: 12 });
    await ok('POST', `/api/maintenance/${hidden.id}/complete`, { done_on: `${year - 3}-01-01` });
    await ok('PUT', `/api/maintenance/${hidden.id}`, { snoozed_until: `${year + 1}-06-01` });

    await ok('PUT', '/api/settings', {
      notifications_enabled: 'true', ntfy_url: `http://127.0.0.1:${fake.address().port}`, ntfy_topic: 'house-test',
      ntfy_token: 'tk_test', app_url: 'http://nas.local:8085',
    });

    const first = await ok('POST', '/api/notify/run');
    assert.ok(first.sent >= 2, `sent ${first.sent}`);
    assert.equal(received.length, 1, 'one digest, not one message per item');
    const [msg] = received;
    assert.equal(msg.url, '/house-test');
    assert.equal(msg.headers.authorization, 'Bearer tk_test');
    assert.equal(msg.headers.click, 'http://nas.local:8085', 'tapping the notification opens the app');
    assert.equal(msg.headers.priority, '4', 'overdue work is high priority');
    assert.match(msg.headers.title, /reminders?$/);
    assert.match(msg.body, /Long overdue job is overdue/);
    assert.match(msg.body, /Old furnace is nearing the end of its expected life \(17\.\d of 18 years\)/);
    assert.doesNotMatch(msg.body, /Snoozed chore/, 'snoozed items stay quiet');

    const second = await ok('POST', '/api/notify/run');
    assert.equal(second.sent, 0);
    assert.equal(received.length, 1, 'nothing new means no second message');
  } finally {
    await call('PUT', '/api/settings', { notifications_enabled: 'false', app_url: '' });
    fake.close();
  }
});
