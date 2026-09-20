import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addMonths, today } from '../server/dates.js';
import { dueInfo, nextDue, warrantyInfo } from '../server/schedule.js';

const april = { service_month: 4, interval_months: 12 };

test('addMonths clamps to the end of shorter months', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2024-01-31', 1), '2024-02-29');
  assert.equal(addMonths('2026-11-15', 3), '2027-02-15');
});

test('today() uses local calendar fields', () => {
  assert.equal(today(new Date(2026, 8, 20, 23, 59)), '2026-09-20');
});

test('never-done item is scheduled for the next occurrence of its month', () => {
  assert.deepEqual(nextDue(april, null, '2026-01-10'), { start: '2026-04-01', anchored: true });
  assert.deepEqual(nextDue(april, null, '2026-09-20'), { start: '2027-04-01', anchored: true });
});

test('the whole service month counts as due, not overdue', () => {
  const info = dueInfo(april, null, '2026-04-28', 14);
  assert.equal(info.status, 'due');
  assert.equal(info.due_label, 'April 2026');
});

test('completing early or late keeps an annual item on its month', () => {
  assert.equal(nextDue(april, '2026-03-20', '2026-03-21').start, '2027-04-01');
  assert.equal(nextDue(april, '2026-04-15', '2026-04-15').start, '2027-04-01');
  assert.equal(nextDue(april, '2026-06-02', '2026-06-03').start, '2027-04-01');
});

test('status moves from ok to upcoming to due to overdue', () => {
  const at = (day, last = '2025-04-10') => dueInfo(april, last, day, 14).status;
  assert.equal(at('2026-01-01'), 'ok');
  assert.equal(at('2026-03-25'), 'upcoming');
  assert.equal(at('2026-04-10'), 'due');
  assert.equal(at('2026-05-01'), 'overdue');
});

test('items without a month and no history are unscheduled', () => {
  const info = dueInfo({ interval_months: 12 }, null, '2026-09-20', 14);
  assert.equal(info.status, 'unscheduled');
  assert.equal(info.next_due, null);
});

test('items without a month use last done plus the interval', () => {
  const info = dueInfo({ interval_months: 3 }, '2026-06-30', '2026-09-20', 14);
  assert.equal(info.next_due, '2026-09-30');
  assert.equal(info.anchored, false);
  assert.equal(info.status, 'upcoming');
  assert.equal(info.days_until, 10);
});

test('warranty countdown supports days, months and years', () => {
  const base = { purchase_date: '2026-01-01' };
  assert.equal(warrantyInfo({ ...base, warranty_length: 90, warranty_unit: 'days' }, '2026-01-01', 60).warranty_end, '2026-04-01');
  assert.equal(warrantyInfo({ ...base, warranty_length: 18, warranty_unit: 'months' }, '2026-01-01', 60).warranty_end, '2027-07-01');
  const years = warrantyInfo({ ...base, warranty_length: 2, warranty_unit: 'years' }, '2026-09-20', 60);
  assert.equal(years.warranty_end, '2028-01-01');
  assert.equal(years.days_left, 468);
  assert.equal(years.warranty_status, 'active');
});

test('warranty status flags expiring and expired', () => {
  const a = { purchase_date: '2025-10-01', warranty_length: 1, warranty_unit: 'years' };
  assert.equal(warrantyInfo(a, '2026-09-01', 60).warranty_status, 'expiring');
  assert.equal(warrantyInfo(a, '2026-10-02', 60).warranty_status, 'expired');
  assert.equal(warrantyInfo({ name: 'No warranty info' }, '2026-09-01', 60).warranty_status, 'none');
});
