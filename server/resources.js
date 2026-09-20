import { db, getSettings } from './db.js';
import { today } from './dates.js';
import { APPLIANCE_CATEGORY_KEYS, FEATURE_KEYS, VENDOR_CATEGORIES } from './catalog.js';
import { lifespanInfo } from './lifecycle.js';
import { dueInfo, warrantyInfo } from './schedule.js';
import { TEMPLATE_KEYS } from './templates.js';
import { HttpError, clean } from './validate.js';

const VENDOR_JOIN = 'LEFT JOIN vendors v ON v.id = t.vendor_id';
const VENDOR_COLS = 'v.name AS vendor_name, v.phone AS vendor_phone';
const DOC_COUNT = (col) => `(SELECT COUNT(*) FROM documents d WHERE d.${col} = t.id) AS doc_count`;

const intSetting = (settings, key) => Number.parseInt(settings[key], 10) || 0;

export const resources = {
  vendors: {
    table: 'vendors',
    select: `SELECT t.*,
      (SELECT COUNT(*) FROM maintenance_items WHERE vendor_id = t.id)
      + (SELECT COUNT(*) FROM appliances WHERE vendor_id = t.id)
      + (SELECT COUNT(*) FROM tasks WHERE vendor_id = t.id)
      + (SELECT COUNT(*) FROM completions WHERE vendor_id = t.id) AS used_by,
      (SELECT MAX(done_on) FROM completions WHERE vendor_id = t.id) AS last_used,
      ${DOC_COUNT('vendor_id')}
      FROM vendors t`,
    order: 't.name COLLATE NOCASE',
    fields: {
      name: { type: 'text', required: true, label: 'Name', max: 120 },
      category: { type: 'enum', values: VENDOR_CATEGORIES, label: 'Trade' },
      phone: { type: 'text', label: 'Phone', max: 40 },
      email: { type: 'text', label: 'Email', max: 200 },
      website: { type: 'text', label: 'Website', max: 300 },
      rating: { type: 'int', min: 1, max: 5, label: 'Rating' },
      notes: { type: 'text', label: 'Notes' },
    },
  },

  maintenance: {
    table: 'maintenance_items',
    select: `SELECT t.*, ${VENDOR_COLS}, a.name AS appliance_name,
      (SELECT done_on FROM completions c WHERE c.item_id = t.id ORDER BY done_on DESC, id DESC LIMIT 1) AS last_done,
      (SELECT cost FROM completions c WHERE c.item_id = t.id ORDER BY done_on DESC, id DESC LIMIT 1) AS last_cost,
      ${DOC_COUNT('item_id')}
      FROM maintenance_items t ${VENDOR_JOIN} LEFT JOIN appliances a ON a.id = t.appliance_id`,
    order: 't.name COLLATE NOCASE',
    fields: {
      name: { type: 'text', required: true, label: 'Name', max: 120 },
      category: { type: 'text', label: 'Category', max: 60 },
      service_month: { type: 'int', min: 1, max: 12, label: 'Service month' },
      interval_months: { type: 'int', min: 1, max: 240, default: 12, label: 'Repeat interval' },
      vendor_id: { type: 'fk', label: 'Vendor' },
      appliance_id: { type: 'fk', label: 'Appliance' },
      estimated_cost: { type: 'real', label: 'Estimated cost' },
      snoozed_until: { type: 'date', label: 'Snoozed until' },
      template_key: { type: 'enum', values: [...TEMPLATE_KEYS], label: 'Template' },
      notes: { type: 'text', label: 'Notes' },
    },
    enrich(row, ctx) {
      const info = dueInfo(row, row.last_done, ctx.today, ctx.leadDays);
      const snoozed = row.snoozed_until && ctx.today <= row.snoozed_until && ['overdue', 'due', 'upcoming'].includes(info.status);
      // base_status keeps the real state so the Home Score can't be gamed by snoozing.
      return { ...row, ...info, status: snoozed ? 'snoozed' : info.status, base_status: info.status };
    },
  },

  appliances: {
    table: 'appliances',
    select: `SELECT t.*, ${VENDOR_COLS}, ${DOC_COUNT('appliance_id')} FROM appliances t ${VENDOR_JOIN}`,
    order: 't.name COLLATE NOCASE',
    fields: {
      name: { type: 'text', required: true, label: 'Name', max: 120 },
      category: { type: 'enum', values: APPLIANCE_CATEGORY_KEYS, label: 'Type' },
      brand: { type: 'text', label: 'Brand', max: 120 },
      model: { type: 'text', label: 'Model', max: 120 },
      serial: { type: 'text', label: 'Serial number', max: 120 },
      location: { type: 'text', label: 'Location', max: 120 },
      purchase_date: { type: 'date', label: 'Purchase date' },
      warranty_length: { type: 'int', min: 1, max: 100000, label: 'Warranty length' },
      warranty_unit: { type: 'enum', values: ['days', 'months', 'years'], default: 'years', label: 'Warranty unit' },
      expected_life_years: { type: 'int', min: 1, max: 100, label: 'Expected life (years)' },
      purchase_price: { type: 'real', label: 'Purchase price' },
      vendor_id: { type: 'fk', label: 'Vendor' },
      notes: { type: 'text', label: 'Notes' },
    },
    enrich(row, ctx) {
      return { ...row, ...warrantyInfo(row, ctx.today, ctx.warrantyLeadDays), ...lifespanInfo(row, ctx.today) };
    },
  },

  tasks: {
    table: 'tasks',
    select: `SELECT t.*, ${VENDOR_COLS},
      (SELECT COUNT(*) FROM quotes q WHERE q.task_id = t.id) AS quote_count,
      (SELECT MIN(amount) FROM quotes q WHERE q.task_id = t.id AND q.status != 'declined') AS lowest_quote,
      ${DOC_COUNT('task_id')}
      FROM tasks t ${VENDOR_JOIN}`,
    order: 't.created_at DESC, t.id DESC',
    fields: {
      kind: { type: 'enum', values: ['need', 'project'], required: true, label: 'Type' },
      title: { type: 'text', required: true, label: 'Title', max: 200 },
      priority: { type: 'enum', values: ['low', 'medium', 'high'], default: 'medium', label: 'Priority' },
      status: { type: 'enum', values: ['idea', 'planned', 'in_progress', 'done'], default: 'idea', label: 'Status' },
      estimated_cost: { type: 'real', label: 'Estimated cost' },
      actual_cost: { type: 'real', label: 'Actual cost' },
      completed_on: { type: 'date', label: 'Completed on' },
      vendor_id: { type: 'fk', label: 'Vendor' },
      notes: { type: 'text', label: 'Notes' },
    },
    // Finishing a task stamps today's date; reopening it clears the date.
    beforeSave(values, existing, body) {
      if (!('status' in values)) return;
      if (values.status === 'done') {
        if (!values.completed_on && !existing?.completed_on) values.completed_on = today();
      } else if (!('completed_on' in body)) {
        values.completed_on = null;
      }
    },
  },

  quotes: {
    table: 'quotes',
    select: `SELECT t.*, ${VENDOR_COLS} FROM quotes t ${VENDOR_JOIN}`,
    order: 't.amount',
    fields: {
      task_id: { type: 'fk', required: true, label: 'Project' },
      vendor_id: { type: 'fk', label: 'Vendor' },
      amount: { type: 'real', required: true, label: 'Amount' },
      quote_date: { type: 'date', label: 'Quote date' },
      status: { type: 'enum', values: ['pending', 'accepted', 'declined'], default: 'pending', label: 'Status' },
      notes: { type: 'text', label: 'Notes' },
    },
  },

  facts: {
    table: 'home_facts',
    select: 'SELECT t.* FROM home_facts t',
    order: 't.group_name COLLATE NOCASE, t.label COLLATE NOCASE',
    fields: {
      label: { type: 'text', required: true, label: 'Label', max: 120 },
      value: { type: 'text', required: true, label: 'Value', max: 1000 },
      group_name: { type: 'text', label: 'Group', max: 60 },
    },
  },
};

function context() {
  const settings = getSettings();
  return {
    today: today(),
    leadDays: intSetting(settings, 'lead_days'),
    warrantyLeadDays: intSetting(settings, 'warranty_lead_days'),
  };
}

const enrichRow = (r, row, ctx) => (r.enrich ? r.enrich(row, ctx) : row);

export function list(name, where = '', params = []) {
  const r = resources[name];
  const ctx = context();
  return db.prepare(`${r.select} ${where} ORDER BY ${r.order}`).all(...params).map((row) => enrichRow(r, row, ctx));
}

export function get(name, id) {
  const r = resources[name];
  const row = db.prepare(`${r.select} WHERE t.id = ?`).get(id);
  if (!row) throw new HttpError(404, 'Not found');
  return enrichRow(r, row, context());
}

export function create(name, body) {
  const r = resources[name];
  const values = clean(r.fields, body);
  r.beforeSave?.(values, null, body);
  const cols = Object.keys(values);
  const res = db
    .prepare(`INSERT INTO ${r.table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .run(...Object.values(values));
  return get(name, Number(res.lastInsertRowid));
}

export function update(name, id, body) {
  const r = resources[name];
  const existing = get(name, id);
  const values = clean(r.fields, body, { partial: true });
  r.beforeSave?.(values, existing, body);
  const cols = Object.keys(values);
  if (cols.length) {
    db.prepare(`UPDATE ${r.table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...Object.values(values), id);
  }
  return get(name, id);
}

export function remove(name, id) {
  get(name, id);
  db.prepare(`DELETE FROM ${resources[name].table} WHERE id = ?`).run(id);
}

/** Maintenance items ordered by urgency: soonest due first, unscheduled last. */
export function listMaintenance() {
  return list('maintenance').sort((a, b) => {
    if (!a.next_due && !b.next_due) return a.name.localeCompare(b.name);
    if (!a.next_due) return 1;
    if (!b.next_due) return -1;
    return a.next_due.localeCompare(b.next_due) || a.name.localeCompare(b.name);
  });
}

export function listAppliances() {
  return list('appliances').sort((a, b) => {
    if (a.days_left == null && b.days_left == null) return a.name.localeCompare(b.name);
    if (a.days_left == null) return 1;
    if (b.days_left == null) return -1;
    return a.days_left - b.days_left;
  });
}

/** Accepting a quote makes it the plan: sets the project's vendor and estimate. */
export function acceptQuote(id) {
  const quote = get('quotes', id);
  db.exec('BEGIN');
  try {
    db.prepare("UPDATE quotes SET status = 'accepted' WHERE id = ?").run(id);
    db.prepare("UPDATE quotes SET status = 'declined' WHERE task_id = ? AND id != ? AND status = 'pending'").run(quote.task_id, id);
    db.prepare("UPDATE tasks SET estimated_cost = ?, vendor_id = COALESCE(?, vendor_id), status = CASE WHEN status = 'idea' THEN 'planned' ELSE status END WHERE id = ?")
      .run(quote.amount, quote.vendor_id, quote.task_id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return get('quotes', id);
}

// ---- Home profile --------------------------------------------------------------

const PROFILE_FIELDS = {
  name: { type: 'text', label: 'Home name', max: 120 },
  address: { type: 'text', label: 'Address', max: 300 },
  year_built: { type: 'int', min: 1600, max: 2200, label: 'Year built' },
  sq_ft: { type: 'int', min: 1, max: 1000000, label: 'Square feet' },
  bedrooms: { type: 'real', label: 'Bedrooms' },
  bathrooms: { type: 'real', label: 'Bathrooms' },
  purchase_date: { type: 'date', label: 'Purchase date' },
  purchase_price: { type: 'real', label: 'Purchase price' },
  insurance_provider: { type: 'text', label: 'Insurance provider', max: 120 },
  insurance_policy: { type: 'text', label: 'Policy number', max: 120 },
  notes: { type: 'text', label: 'Notes' },
};

export function getProfile() {
  const row = db.prepare('SELECT * FROM home_profile WHERE id = 1').get();
  return { ...row, features: JSON.parse(row.features || '[]') };
}

export function updateProfile(body) {
  const values = clean(PROFILE_FIELDS, body, { partial: true });
  if ('features' in body) {
    if (!Array.isArray(body.features) || body.features.some((f) => !FEATURE_KEYS.includes(f))) {
      throw new HttpError(400, 'Features must be a list of known feature keys');
    }
    values.features = JSON.stringify([...new Set(body.features)]);
  }
  const cols = Object.keys(values);
  if (cols.length) {
    db.prepare(`UPDATE home_profile SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = 1`).run(...Object.values(values));
  }
  return getProfile();
}

// ---- Service history and home log -----------------------------------------------

const KINDS = ['maintenance', 'repair', 'upgrade', 'inspection'];

const COMPLETION_FIELDS = {
  kind: { type: 'enum', values: KINDS, default: 'maintenance', label: 'Type' },
  title: { type: 'text', max: 200, label: 'Title' },
  item_id: { type: 'fk', label: 'Maintenance item' },
  appliance_id: { type: 'fk', label: 'Appliance' },
  done_on: { type: 'date', required: true, label: 'Date done' },
  cost: { type: 'real', label: 'Cost' },
  vendor_id: { type: 'fk', label: 'Vendor' },
  diy: { type: 'int', min: 0, max: 1, default: 0, label: 'Did it myself' },
  notes: { type: 'text', label: 'Notes' },
};

const COMPLETION_SELECT = `SELECT c.*, COALESCE(c.title, m.name) AS name, m.name AS item_name,
    v.name AS vendor_name, a.name AS appliance_name,
    (SELECT COUNT(*) FROM documents d WHERE d.completion_id = c.id) AS doc_count
  FROM completions c
  LEFT JOIN maintenance_items m ON m.id = c.item_id
  LEFT JOIN vendors v ON v.id = c.vendor_id
  LEFT JOIN appliances a ON a.id = c.appliance_id`;

export function listCompletions({ itemId, applianceId, year, kind } = {}) {
  const where = [];
  const params = [];
  if (itemId) { where.push('c.item_id = ?'); params.push(itemId); }
  if (applianceId) { where.push('c.appliance_id = ?'); params.push(applianceId); }
  if (year) { where.push('substr(c.done_on, 1, 4) = ?'); params.push(String(year)); }
  if (kind) { where.push('c.kind = ?'); params.push(kind); }
  const sql = `${COMPLETION_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY c.done_on DESC, c.id DESC`;
  return db.prepare(sql).all(...params);
}

export function getCompletion(id) {
  const row = db.prepare(`${COMPLETION_SELECT} WHERE c.id = ?`).get(id);
  if (!row) throw new HttpError(404, 'Not found');
  return row;
}

export function completionYears() {
  const years = db.prepare('SELECT DISTINCT substr(done_on, 1, 4) AS y FROM completions ORDER BY y DESC').all().map((r) => Number(r.y));
  const current = Number(today().slice(0, 4));
  return years.includes(current) ? years : [current, ...years];
}

function insertCompletion(values) {
  const cols = Object.keys(values);
  const res = db
    .prepare(`INSERT INTO completions (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .run(...Object.values(values));
  return Number(res.lastInsertRowid);
}

/** Marks a recurring item done. Defaults (vendor, cost, appliance) come from the item. */
export function addCompletion(itemId, body) {
  const item = get('maintenance', itemId);
  const values = clean(COMPLETION_FIELDS, {
    vendor_id: item.vendor_id, cost: item.estimated_cost, appliance_id: item.appliance_id,
    ...body, kind: 'maintenance', item_id: itemId, title: null,
  });
  const id = insertCompletion(values);
  db.prepare('UPDATE maintenance_items SET snoozed_until = NULL WHERE id = ?').run(itemId);
  return { completion_id: id, item: get('maintenance', itemId) };
}

/** Logs a one-off repair, upgrade, inspection or other job that isn't a recurring item. */
export function addLogEntry(body) {
  const values = clean(COMPLETION_FIELDS, body);
  if (!values.title && !values.item_id) throw new HttpError(400, 'Title is required');
  return getCompletion(insertCompletion(values));
}

export function updateCompletion(id, body) {
  getCompletion(id);
  const values = clean(COMPLETION_FIELDS, body, { partial: true });
  const cols = Object.keys(values);
  if (cols.length) {
    db.prepare(`UPDATE completions SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...Object.values(values), id);
  }
  return getCompletion(id);
}

export function removeCompletion(id) {
  getCompletion(id);
  db.prepare('DELETE FROM completions WHERE id = ?').run(id);
}
