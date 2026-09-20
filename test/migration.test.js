import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Build a database exactly as the first release created it (schema version 1), with data in it.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-migration-'));
const source = fs.readFileSync(new URL('../server/db.js', import.meta.url), 'utf8');
const v1Schema = source.match(/export const MIGRATIONS = \[\s*`([\s\S]*?)`,/)[1];

const old = new DatabaseSync(path.join(dir, 'home-maintenance.db'));
old.exec(v1Schema);
old.exec('PRAGMA user_version = 1');
old.exec(`
  INSERT INTO vendors (name, phone) VALUES ('Acme HVAC', '555-0100');
  INSERT INTO maintenance_items (name, service_month, vendor_id, estimated_cost) VALUES ('HVAC maintenance', 4, 1, 230);
  INSERT INTO completions (item_id, done_on, cost, vendor_id, notes) VALUES (1, '2026-04-12', 245.5, 1, 'filter swap');
  INSERT INTO appliances (name, purchase_date, warranty_length, warranty_unit) VALUES ('Dishwasher', '2025-01-15', 2, 'years');
  INSERT INTO tasks (kind, title) VALUES ('project', 'Fence');
  INSERT INTO settings (key, value) VALUES ('seeded', '1');
`);
old.close();

process.env.DATA_DIR = dir;
const { db } = await import('../server/db.js');
const store = await import('../server/resources.js');

test('upgrading a v1 database moves it to the current schema version', () => {
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 3);
});

test('existing data survives the upgrade', () => {
  assert.equal(store.get('vendors', 1).name, 'Acme HVAC');
  assert.equal(store.get('maintenance', 1).name, 'HVAC maintenance');
  assert.equal(store.get('appliances', 1).name, 'Dishwasher');
  assert.equal(store.get('tasks', 1).title, 'Fence');

  const [entry] = store.listCompletions();
  assert.equal(entry.item_id, 1);
  assert.equal(entry.done_on, '2026-04-12');
  assert.equal(entry.cost, 245.5);
  assert.equal(entry.notes, 'filter swap');
  assert.equal(entry.kind, 'maintenance');
  assert.equal(entry.diy, 0);
  assert.equal(entry.name, 'HVAC maintenance');
});

test('new tables and columns exist with sensible defaults', () => {
  assert.equal(store.getProfile().id, 1);
  assert.deepEqual(store.getProfile().features, []);
  for (const table of ['home_facts', 'documents', 'quotes']) {
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0);
  }
  const maintenance = store.get('maintenance', 1);
  assert.equal(maintenance.snoozed_until, null);
  assert.equal(maintenance.template_key, null);
});

test('one-off repairs can be logged without a recurring item', () => {
  const entry = store.addLogEntry({ kind: 'repair', title: 'Fixed leaking faucet', done_on: '2026-05-01', cost: 85, diy: true });
  assert.equal(entry.name, 'Fixed leaking faucet');
  assert.equal(entry.item_id, null);
  assert.equal(entry.diy, 1);
  assert.throws(() => store.addLogEntry({ done_on: '2026-05-01' }), /Title is required/);
});

test('deleting a maintenance item removes its history but keeps one-off repairs', () => {
  store.remove('maintenance', 1);
  const names = store.listCompletions().map((e) => e.name);
  assert.deepEqual(names, ['Fixed leaking faucet']);
});
