import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export const DATA_DIR = process.env.DATA_DIR || path.resolve('data');
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'home-maintenance.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

export const MIGRATIONS = [
  `
  CREATE TABLE vendors (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    notes TEXT
  );
  CREATE TABLE maintenance_items (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    service_month INTEGER CHECK (service_month BETWEEN 1 AND 12),
    interval_months INTEGER NOT NULL DEFAULT 12 CHECK (interval_months >= 1),
    vendor_id INTEGER REFERENCES vendors(id) ON DELETE SET NULL,
    estimated_cost REAL,
    notes TEXT
  );
  CREATE TABLE completions (
    id INTEGER PRIMARY KEY,
    item_id INTEGER NOT NULL REFERENCES maintenance_items(id) ON DELETE CASCADE,
    done_on TEXT NOT NULL,
    cost REAL,
    vendor_id INTEGER REFERENCES vendors(id) ON DELETE SET NULL,
    notes TEXT
  );
  CREATE INDEX completions_item ON completions(item_id, done_on);
  CREATE TABLE appliances (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    brand TEXT,
    model TEXT,
    serial TEXT,
    location TEXT,
    purchase_date TEXT,
    warranty_length INTEGER,
    warranty_unit TEXT NOT NULL DEFAULT 'years' CHECK (warranty_unit IN ('days', 'months', 'years')),
    purchase_price REAL,
    vendor_id INTEGER REFERENCES vendors(id) ON DELETE SET NULL,
    notes TEXT
  );
  CREATE TABLE tasks (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('need', 'project')),
    title TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
    status TEXT NOT NULL DEFAULT 'idea' CHECK (status IN ('idea', 'planned', 'in_progress', 'done')),
    estimated_cost REAL,
    actual_cost REAL,
    completed_on TEXT,
    vendor_id INTEGER REFERENCES vendors(id) ON DELETE SET NULL,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (date('now'))
  );
  CREATE TABLE budgets (year INTEGER PRIMARY KEY, amount REAL NOT NULL);
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE notification_log (key TEXT PRIMARY KEY, sent_at TEXT NOT NULL);
  `,

  // v2: home profile, documents, repair/upgrade log, quotes, lifespans, snooze.
  `
  CREATE TABLE home_profile (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    name TEXT,
    address TEXT,
    year_built INTEGER,
    sq_ft INTEGER,
    bedrooms REAL,
    bathrooms REAL,
    purchase_date TEXT,
    purchase_price REAL,
    insurance_provider TEXT,
    insurance_policy TEXT,
    notes TEXT,
    features TEXT NOT NULL DEFAULT '[]'
  );
  INSERT INTO home_profile (id) VALUES (1);

  CREATE TABLE home_facts (
    id INTEGER PRIMARY KEY,
    label TEXT NOT NULL,
    value TEXT NOT NULL,
    group_name TEXT
  );

  ALTER TABLE vendors ADD COLUMN category TEXT;
  ALTER TABLE vendors ADD COLUMN rating INTEGER CHECK (rating BETWEEN 1 AND 5);
  ALTER TABLE vendors ADD COLUMN website TEXT;

  ALTER TABLE appliances ADD COLUMN category TEXT;
  ALTER TABLE appliances ADD COLUMN expected_life_years INTEGER;

  ALTER TABLE maintenance_items ADD COLUMN category TEXT;
  ALTER TABLE maintenance_items ADD COLUMN template_key TEXT;
  ALTER TABLE maintenance_items ADD COLUMN snoozed_until TEXT;
  ALTER TABLE maintenance_items ADD COLUMN appliance_id INTEGER REFERENCES appliances(id) ON DELETE SET NULL;

  -- History can now hold repairs and upgrades that aren't tied to a recurring item.
  CREATE TABLE completions_v2 (
    id INTEGER PRIMARY KEY,
    item_id INTEGER REFERENCES maintenance_items(id) ON DELETE CASCADE,
    appliance_id INTEGER REFERENCES appliances(id) ON DELETE SET NULL,
    kind TEXT NOT NULL DEFAULT 'maintenance' CHECK (kind IN ('maintenance', 'repair', 'upgrade', 'inspection')),
    title TEXT,
    done_on TEXT NOT NULL,
    cost REAL,
    vendor_id INTEGER REFERENCES vendors(id) ON DELETE SET NULL,
    diy INTEGER NOT NULL DEFAULT 0 CHECK (diy IN (0, 1)),
    notes TEXT,
    CHECK (item_id IS NOT NULL OR title IS NOT NULL)
  );
  INSERT INTO completions_v2 (id, item_id, done_on, cost, vendor_id, notes)
    SELECT id, item_id, done_on, cost, vendor_id, notes FROM completions;
  DROP TABLE completions;
  ALTER TABLE completions_v2 RENAME TO completions;
  CREATE INDEX completions_item ON completions(item_id, done_on);

  CREATE TABLE documents (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'other'
      CHECK (category IN ('warranty', 'receipt', 'manual', 'insurance', 'permit', 'inspection', 'photo', 'contract', 'other')),
    filename TEXT NOT NULL,
    stored_name TEXT NOT NULL UNIQUE,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    appliance_id INTEGER REFERENCES appliances(id) ON DELETE SET NULL,
    item_id INTEGER REFERENCES maintenance_items(id) ON DELETE SET NULL,
    completion_id INTEGER REFERENCES completions(id) ON DELETE SET NULL,
    vendor_id INTEGER REFERENCES vendors(id) ON DELETE SET NULL,
    task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
    notes TEXT,
    uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE quotes (
    id INTEGER PRIMARY KEY,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    vendor_id INTEGER REFERENCES vendors(id) ON DELETE SET NULL,
    amount REAL NOT NULL,
    quote_date TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
    notes TEXT
  );
  `,

  // v3: who changed what. Only filled in when people sign in with their own accounts.
  `
  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY,
    at TEXT NOT NULL DEFAULT (datetime('now')),
    actor TEXT NOT NULL,
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    status INTEGER NOT NULL
  );
  CREATE INDEX audit_log_at ON audit_log(at);
  `,
];

function migrate() {
  let version = db.prepare('PRAGMA user_version').get().user_version;
  for (; version < MIGRATIONS.length; version++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[version]);
      db.exec(`PRAGMA user_version = ${version + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}
migrate();

db.prepare("DELETE FROM audit_log WHERE at < datetime('now', '-400 days')").run();

/** Records that someone changed something. Keeps the request path and outcome, never the content. */
export function recordAudit(actor, method, path, status) {
  db.prepare('INSERT INTO audit_log (actor, method, path, status) VALUES (?, ?, ?, ?)').run(actor, method, path, status);
}

export const SETTING_DEFAULTS = {
  notifications_enabled: 'false',
  ntfy_url: 'https://ntfy.sh',
  ntfy_topic: '',
  ntfy_token: '',
  notify_time: '08:00',
  lead_days: '14',
  warranty_lead_days: '60',
  app_url: '',
  last_notify_run: '',
};

export function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  return { ...SETTING_DEFAULTS, ...Object.fromEntries(rows.map((r) => [r.key, r.value])) };
}

export function saveSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value));
}

/** Loads seed.json (the starter checklist) once, on a brand-new database. */
function seedOnce() {
  if (db.prepare("SELECT 1 FROM settings WHERE key = 'seeded'").get()) return;
  saveSetting('seeded', '1');
  if (process.env.SEED === 'false') return;

  const file = new URL('../seed.json', import.meta.url);
  if (!fs.existsSync(file)) return;
  const seed = JSON.parse(fs.readFileSync(file, 'utf8'));

  db.exec('BEGIN');
  try {
    const vendorIds = {};
    for (const v of seed.vendors ?? []) {
      const r = db.prepare('INSERT INTO vendors (name, phone, email, notes) VALUES (?, ?, ?, ?)')
        .run(v.name, v.phone ?? null, v.email ?? null, v.notes ?? null);
      vendorIds[v.key] = Number(r.lastInsertRowid);
    }
    for (const m of seed.maintenance ?? []) {
      db.prepare('INSERT INTO maintenance_items (name, service_month, interval_months, vendor_id, estimated_cost, notes) VALUES (?, ?, ?, ?, ?, ?)')
        .run(m.name, m.service_month ?? null, m.interval_months ?? 12, vendorIds[m.vendor] ?? null, m.estimated_cost ?? null, m.notes ?? null);
    }
    for (const t of seed.tasks ?? []) {
      db.prepare('INSERT INTO tasks (kind, title, priority, status, estimated_cost, notes) VALUES (?, ?, ?, ?, ?, ?)')
        .run(t.kind, t.title, t.priority ?? 'medium', t.status ?? 'idea', t.estimated_cost ?? null, t.notes ?? null);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
seedOnce();
