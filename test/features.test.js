import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FEATURE_KEYS } from '../server/catalog.js';
import { homeScore, lifespanInfo } from '../server/lifecycle.js';
import { TEMPLATES, suggestions } from '../server/templates.js';

test('lifespan: ok, aging, end and unknown', () => {
  const heater = { purchase_date: '2016-09-20', expected_life_years: 10 };
  assert.equal(lifespanInfo(heater, '2019-09-20').life_status, 'ok');
  assert.equal(lifespanInfo(heater, '2025-01-01').life_status, 'aging'); // ~8.3 of 10 years
  assert.equal(lifespanInfo(heater, '2027-01-01').life_status, 'end');
  assert.equal(lifespanInfo({ purchase_date: '2016-09-20' }, '2026-09-20').life_status, 'none');
  assert.equal(lifespanInfo({ expected_life_years: 10 }, '2026-09-20').life_status, 'none');

  const info = lifespanInfo(heater, '2026-03-20');
  assert.equal(info.replace_by, '2026-09-20');
  assert.equal(info.age_years, 9.5);
  assert.equal(info.life_pct, 95);
});

const healthy = {
  maintenance: [
    { name: 'A', status: 'ok' }, { name: 'B', status: 'upcoming' }, { name: 'C', status: 'due' }, { name: 'D', status: 'ok' },
  ],
  appliances: [
    { id: 1, name: 'Fridge', purchase_date: '2024-01-01', warranty_length: 2, life_status: 'ok' },
    { id: 2, name: 'Oven', purchase_date: '2023-01-01', warranty_length: 1, life_status: 'ok' },
  ],
  documentApplianceIds: new Set([1, 2]),
  completionsLast12m: 6,
};

test('home score rewards an organised, up-to-date home', () => {
  const { score, grade, parts } = homeScore(healthy);
  assert.ok(score >= 95, `expected a high score, got ${score}`);
  assert.equal(grade, 'Excellent');
  assert.equal(parts.length, 5);
  assert.equal(parts.reduce((sum, p) => sum + p.max, 0), 100);
});

test('home score falls with overdue work, old equipment and missing records', () => {
  const neglected = {
    maintenance: [{ name: 'Gutters', status: 'overdue' }, { name: 'HVAC', status: 'overdue' }, { name: 'Filter', status: 'unscheduled' }],
    appliances: [{ id: 1, name: 'Water heater', life_status: 'end' }],
    documentApplianceIds: new Set(),
    completionsLast12m: 0,
  };
  const good = homeScore(healthy).score;
  const bad = homeScore(neglected);
  assert.ok(bad.score < 40, `expected a low score, got ${bad.score}`);
  assert.ok(bad.score < good);
  assert.equal(bad.grade, 'Needs attention');
  assert.match(bad.parts.find((p) => p.key === 'schedule').tip, /Gutters, HVAC/);
  assert.match(bad.parts.find((p) => p.key === 'equipment').tip, /Water heater past expected life/);
});

test('home score of an empty home is neutral and points at the first step', () => {
  const { score, parts } = homeScore({ maintenance: [], appliances: [], documentApplianceIds: new Set(), completionsLast12m: 0 });
  assert.ok(score > 10 && score < 40);
  assert.match(parts.find((p) => p.key === 'planning').tip, /Suggestions/);
});

test('task library is well formed', () => {
  const keys = new Set();
  for (const t of TEMPLATES) {
    assert.ok(!keys.has(t.key), `duplicate key ${t.key}`);
    keys.add(t.key);
    assert.match(t.key, /^[a-z0-9-]+$/, `route-safe key: ${t.key}`);
    assert.ok(t.month >= 1 && t.month <= 12, `month for ${t.key}`);
    assert.ok(t.interval_months >= 1, `interval for ${t.key}`);
    assert.ok(t.why.length > 20, `explanation for ${t.key}`);
    for (const f of t.requires) assert.ok(FEATURE_KEYS.includes(f), `${t.key} requires unknown feature ${f}`);
  }
  assert.ok(TEMPLATES.length >= 40);
});

test('suggestions match the home, mark what is added, and put the seasonal ones first', () => {
  const todayStr = '2026-09-20';
  const plain = suggestions({ features: [], todayStr });
  const byKey = (list, key) => list.find((s) => s.key === key);

  assert.equal(byKey(plain, 'hvac-filter').applicable, true);
  assert.equal(byKey(plain, 'gutter-clean').applicable, false);
  assert.equal(byKey(plain, 'pool-service').applicable, false);

  const withGutters = suggestions({ features: ['gutters', 'sprinklers', 'freeze'], addedKeys: new Set(['hvac-filter']), todayStr });
  assert.equal(byKey(withGutters, 'gutter-clean').applicable, true);
  assert.equal(byKey(withGutters, 'sprinkler-winterize').applicable, true); // needs both features
  assert.equal(byKey(suggestions({ features: ['sprinklers'], todayStr }), 'sprinkler-winterize').applicable, false);
  assert.equal(byKey(withGutters, 'hvac-filter').added, true);

  // Applicable and not yet added come first, soonest typical month first.
  const firstBlock = withGutters.filter((s) => s.applicable && !s.added);
  assert.deepEqual(withGutters.slice(0, firstBlock.length).map((s) => s.key), firstBlock.map((s) => s.key));
  assert.equal(firstBlock[0].months_until, 0); // September: something is in season now
  assert.equal(byKey(withGutters, 'heat-tuneup').in_season, true); // typical month is September
  assert.equal(byKey(withGutters, 'ac-tuneup').season, 'spring');
});
