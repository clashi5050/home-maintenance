import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authSettings, authenticate, isCrossSiteWrite } from './auth.js';
import { DATA_DIR, SETTING_DEFAULTS, db, getSettings, recordAudit, saveSetting } from './db.js';
import { blockPrivateUrls, urlProblem } from './netguard.js';
import { today } from './dates.js';
import * as store from './resources.js';
import { budgetFor, setBudget, summary } from './summary.js';
import { runCheck, sendTest, startScheduler } from './notify.js';
import { ask, assistantStatus } from './assistant.js';
import { APPLIANCE_CATEGORIES, DOC_CATEGORIES, HOME_FEATURES, VENDOR_CATEGORIES } from './catalog.js';
import * as docs from './documents.js';
import { buildReport, currentScore, historyCsv, search } from './home.js';
import { buildIcs, buildPlanner } from './planner.js';
import { TEMPLATES, suggestions } from './templates.js';
import { HttpError, clean } from './validate.js';

const PORT = Number(process.env.PORT) || 8080;
const PUBLIC_DIR = fileURLToPath(new URL('../public', import.meta.url));
const AUTH = authSettings(); // AUTH_MODE: none, basic (BASIC_AUTH=user:password) or easyauth (Azure sign-in)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const SETTINGS_FIELDS = {
  notifications_enabled: { type: 'enum', values: ['true', 'false'], label: 'Notifications' },
  ntfy_url: { type: 'text', max: 300, label: 'ntfy server' },
  ntfy_topic: { type: 'text', max: 100, label: 'ntfy topic' },
  ntfy_token: { type: 'text', max: 300, label: 'ntfy token' },
  notify_time: { type: 'text', max: 5, label: 'Notify time' },
  lead_days: { type: 'int', min: 0, max: 365, label: 'Maintenance lead days' },
  warranty_lead_days: { type: 'int', min: 0, max: 730, label: 'Warranty lead days' },
  app_url: { type: 'text', max: 300, label: 'App address' },
};

const publicSettings = () => {
  const { ntfy_token: token, last_notify_run: lastRun, seeded, ...rest } = getSettings();
  return { ...rest, ntfy_token_set: token !== '', last_notify_run: lastRun, timezone: process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone };
};

function updateSettings(body) {
  const values = clean(SETTINGS_FIELDS, body, { partial: true });
  if (values.notify_time != null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(values.notify_time)) throw new HttpError(400, 'Notify time must look like 08:00');
  if (values.ntfy_url != null && !/^https?:\/\/[^\s]+$/.test(values.ntfy_url)) throw new HttpError(400, 'ntfy server must start with http:// or https://');
  if (values.ntfy_url && blockPrivateUrls()) {
    const problem = urlProblem(values.ntfy_url);
    if (problem) throw new HttpError(400, `ntfy server: ${problem}`);
  }
  if (values.app_url != null && !/^https?:\/\/[^\s]+$/.test(values.app_url)) throw new HttpError(400, 'App address must start with http:// or https://');
  for (const [key, value] of Object.entries(values)) {
    // Empty values fall back to defaults, except the token, which can be cleared.
    saveSetting(key, value ?? (key === 'ntfy_token' ? '' : SETTING_DEFAULTS[key]));
  }
  return publicSettings();
}

// ---- Routes ------------------------------------------------------------------

const routes = [];
// Options: raw (handler reads the request stream itself), maxBody (JSON body size limit in bytes).
const route = (method, pattern, handler, opts = {}) => routes.push({ method, regex: new RegExp(`^${pattern}$`), handler, ...opts });
const HANDLED = Symbol('handled'); // the handler already wrote the response
const idOf = (ctx) => Number(ctx.params[0]);

function crudRoutes(prefix, name) {
  route('GET', `/api/${prefix}`, () => store.list(name));
  route('POST', `/api/${prefix}`, (ctx) => { ctx.status = 201; return store.create(name, ctx.body); });
  route('GET', `/api/${prefix}/(\\d+)`, (ctx) => store.get(name, idOf(ctx)));
  route('PUT', `/api/${prefix}/(\\d+)`, (ctx) => store.update(name, idOf(ctx), ctx.body));
  route('DELETE', `/api/${prefix}/(\\d+)`, (ctx) => { store.remove(name, idOf(ctx)); ctx.status = 204; });
}

crudRoutes('vendors', 'vendors');
crudRoutes('appliances', 'appliances');

// Maintenance: list is sorted by urgency, and items can be marked done.
route('GET', '/api/maintenance', () => store.listMaintenance());
route('POST', '/api/maintenance', (ctx) => { ctx.status = 201; return store.create('maintenance', ctx.body); });
route('GET', '/api/maintenance/(\\d+)', (ctx) => store.get('maintenance', idOf(ctx)));
route('PUT', '/api/maintenance/(\\d+)', (ctx) => store.update('maintenance', idOf(ctx), ctx.body));
route('DELETE', '/api/maintenance/(\\d+)', (ctx) => { store.remove('maintenance', idOf(ctx)); ctx.status = 204; });
route('POST', '/api/maintenance/(\\d+)/complete', (ctx) => { ctx.status = 201; return store.addCompletion(idOf(ctx), ctx.body); });

// Home log: recurring-item completions plus one-off repairs, upgrades and inspections
route('GET', '/api/history', (ctx) => ({
  years: store.completionYears(),
  entries: store.listCompletions({
    itemId: Number(ctx.query.get('item')) || null,
    applianceId: Number(ctx.query.get('appliance')) || null,
    year: Number(ctx.query.get('year')) || null,
    kind: ctx.query.get('kind') || null,
  }),
}));
route('POST', '/api/history', (ctx) => { ctx.status = 201; return store.addLogEntry(ctx.body); });
route('GET', '/api/history.csv', (ctx) => {
  ctx.headers['Content-Type'] = 'text/csv; charset=utf-8';
  ctx.headers['Content-Disposition'] = `attachment; filename="home-log-${today()}.csv"`;
  return { __raw: historyCsv({ year: Number(ctx.query.get('year')) || null }) };
});
route('PUT', '/api/history/(\\d+)', (ctx) => store.updateCompletion(idOf(ctx), ctx.body));
route('DELETE', '/api/history/(\\d+)', (ctx) => { store.removeCompletion(idOf(ctx)); ctx.status = 204; });

// Needs & projects
route('GET', '/api/tasks', (ctx) => {
  const kind = ctx.query.get('kind');
  return kind ? store.list('tasks', 'WHERE t.kind = ?', [kind]) : store.list('tasks');
});
route('POST', '/api/tasks', (ctx) => { ctx.status = 201; return store.create('tasks', ctx.body); });
route('PUT', '/api/tasks/(\\d+)', (ctx) => store.update('tasks', idOf(ctx), ctx.body));
route('DELETE', '/api/tasks/(\\d+)', (ctx) => { store.remove('tasks', idOf(ctx)); ctx.status = 204; });

route('GET', '/api/quotes', (ctx) => store.list('quotes', 'WHERE t.task_id = ?', [Number(ctx.query.get('task_id')) || 0]));
route('POST', '/api/quotes', (ctx) => { ctx.status = 201; return store.create('quotes', ctx.body); });
route('PUT', '/api/quotes/(\\d+)', (ctx) => store.update('quotes', idOf(ctx), ctx.body));
route('DELETE', '/api/quotes/(\\d+)', (ctx) => { store.remove('quotes', idOf(ctx)); ctx.status = 204; });
route('POST', '/api/quotes/(\\d+)/accept', (ctx) => store.acceptQuote(idOf(ctx)));

// Home profile, facts, reference data
route('GET', '/api/meta', () => ({
  appliance_categories: APPLIANCE_CATEGORIES,
  vendor_categories: VENDOR_CATEGORIES,
  doc_categories: DOC_CATEGORIES,
  home_features: HOME_FEATURES,
  upload_extensions: docs.ALLOWED_EXTENSIONS,
  max_upload_mb: docs.MAX_UPLOAD_BYTES / 1024 / 1024,
}));
route('GET', '/api/profile', () => store.getProfile());
route('PUT', '/api/profile', (ctx) => store.updateProfile(ctx.body));
crudRoutes('facts', 'facts');

// Documents: metadata as JSON, file bytes as the raw request body
route('GET', '/api/documents', (ctx) => docs.listDocuments({
  q: ctx.query.get('q') || '',
  category: ctx.query.get('category') || null,
  applianceId: Number(ctx.query.get('appliance_id')) || null,
  itemId: Number(ctx.query.get('item_id')) || null,
  completionId: Number(ctx.query.get('completion_id')) || null,
  vendorId: Number(ctx.query.get('vendor_id')) || null,
  taskId: Number(ctx.query.get('task_id')) || null,
}));
route('POST', '/api/documents', async (ctx) => { const doc = await docs.saveUpload(ctx.req, ctx.query); ctx.status = 201; return doc; }, { raw: true });
route('PUT', '/api/documents/(\\d+)', (ctx) => docs.updateDocument(idOf(ctx), ctx.body));
route('DELETE', '/api/documents/(\\d+)', async (ctx) => { await docs.deleteDocument(idOf(ctx)); ctx.status = 204; });
route('GET', '/api/documents/(\\d+)/file', async (ctx) => {
  await docs.sendDocument(ctx.res, idOf(ctx), { download: ctx.query.get('download') === '1' });
  return HANDLED;
});

// Suggestions library, planner and calendar feed
const addedTemplateKeys = () => new Set(
  db.prepare('SELECT template_key FROM maintenance_items WHERE template_key IS NOT NULL').all().map((r) => r.template_key),
);
route('GET', '/api/suggestions', () => {
  const profile = store.getProfile();
  return { features: profile.features, items: suggestions({ features: profile.features, addedKeys: addedTemplateKeys() }) };
});
route('POST', '/api/suggestions/([a-z0-9-]+)/add', (ctx) => {
  const template = TEMPLATES.find((t) => t.key === ctx.params[0]);
  if (!template) throw new HttpError(404, 'Unknown suggestion');
  if (addedTemplateKeys().has(template.key)) throw new HttpError(409, 'That item is already on your list');
  const item = store.create('maintenance', {
    name: template.name, category: template.category, interval_months: template.interval_months,
    service_month: template.month, notes: template.why, template_key: template.key,
    ...ctx.body,
  });
  ctx.status = 201;
  return item;
});
route('GET', '/api/planner', (ctx) => buildPlanner({ months: Math.min(24, Math.max(1, Number(ctx.query.get('months')) || 12)) }));
route('GET', '/api/calendar.ics', (ctx) => {
  ctx.headers['Content-Type'] = 'text/calendar; charset=utf-8';
  ctx.headers['Content-Disposition'] = 'inline; filename="home-maintenance.ics"';
  return { __raw: buildIcs() };
});

// Score, search, printable report
route('GET', '/api/score', () => currentScore());
route('GET', '/api/search', (ctx) => search(ctx.query.get('q')));
route('GET', '/api/report', () => buildReport());

// Assistant (optional, needs ANTHROPIC_API_KEY)
route('GET', '/api/assistant', () => assistantStatus());
route('POST', '/api/assistant', (ctx) => ask(ctx.body.messages), { maxBody: 16_000_000 });

// Budget, dashboard, settings, notifications, backup
route('GET', '/api/summary', () => summary());
route('GET', '/api/budget', (ctx) => budgetFor(Number(ctx.query.get('year')) || Number(today().slice(0, 4))));
route('PUT', '/api/budget', (ctx) => setBudget(Number(ctx.body.year) || Number(today().slice(0, 4)), ctx.body.amount));
route('GET', '/api/settings', () => publicSettings());
route('PUT', '/api/settings', (ctx) => updateSettings(ctx.body));
route('POST', '/api/notify/test', async () => { await sendTest(); return { ok: true }; });
route('POST', '/api/notify/run', () => runCheck());
route('GET', '/api/export', (ctx) => {
  const dump = { exported_at: new Date().toISOString(), data_dir: DATA_DIR };
  for (const table of ['vendors', 'maintenance_items', 'completions', 'appliances', 'tasks', 'budgets']) {
    dump[table] = db.prepare(`SELECT * FROM ${table}`).all();
  }
  ctx.headers['Content-Disposition'] = `attachment; filename="home-maintenance-${today()}.json"`;
  return dump;
});

// ---- HTTP plumbing -----------------------------------------------------------

function readBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, 'Request too large'));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new HttpError(400, 'Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, data, headers = {}) {
  if (status === 204) {
    res.writeHead(204, headers);
    return res.end();
  }
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(data));
}

async function handleApi(req, res, url) {
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const match = r.regex.exec(url.pathname);
    if (!match) continue;
    const ctx = { params: match.slice(1), query: url.searchParams, body: {}, status: 200, headers: {}, req, res };
    if (!r.raw && (req.method === 'POST' || req.method === 'PUT')) ctx.body = await readBody(req, r.maxBody);
    const result = await r.handler(ctx);
    // Who changed what, when people sign in with their own accounts.
    if (req.user && req.method !== 'GET') recordAudit(req.user.email || req.user.id, req.method, url.pathname, ctx.status);
    if (result === HANDLED) return undefined;
    if (result && '__raw' in result) {
      res.writeHead(200, { 'Cache-Control': 'no-store', ...ctx.headers });
      return res.end(result.__raw);
    }
    return sendJson(res, ctx.status, result, ctx.headers);
  }
  throw new HttpError(404, 'Unknown API route');
}

function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
  const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const file = path.resolve(PUBLIC_DIR, rel);
  if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + path.sep)) throw new HttpError(403, 'Forbidden');
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new HttpError(404, 'Not found');

  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
  });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'");
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  // Tell browsers to use HTTPS only, when we are actually being served over it.
  if (AUTH.mode === 'easyauth' || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/healthz') return sendJson(res, 200, { ok: true });
    const who = authenticate(req, AUTH);
    if (!who.ok) {
      res.writeHead(who.status, who.headers);
      return res.end(who.body);
    }
    req.user = who.user; // null unless people sign in with their own accounts
    if (AUTH.mode !== 'none' && isCrossSiteWrite(req)) throw new HttpError(403, 'Cross-site request blocked');
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    return serveStatic(req, res, url);
  } catch (err) {
    const constraint = /constraint/i.test(err.message ?? '');
    const status = err instanceof HttpError ? err.status : constraint ? 400 : 500;
    if (status === 500) console.error(err);
    const message = err instanceof HttpError ? err.message : constraint ? 'That value conflicts with existing data' : 'Server error';
    if (res.headersSent) return res.end();
    if (req.url?.startsWith('/api/')) return sendJson(res, status, { error: message });
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(message);
  }
});

server.listen(PORT, () => {
  console.log(`Home Maintenance listening on :${PORT} (data: ${DATA_DIR}, today: ${today()})`);
  startScheduler();
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
