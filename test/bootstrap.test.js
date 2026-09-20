import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { litestreamConfig, main, makeLease, startStandby } from '../server/bootstrap.js';
import { EMULATOR_KEY, startAzurite } from './helpers/azurite.js';

const root = path.resolve(import.meta.dirname, '..');
const quiet = { log() {}, error() {} };
let azurite;
let env;

const freePort = () => new Promise((resolve) => {
  const s = net.createServer().listen(0, () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

before(async () => {
  azurite = await startAzurite();
  env = {
    LITESTREAM_ENABLED: 'true', LITESTREAM_ACCOUNT: 'devstoreaccount1', LITESTREAM_CONTAINER: 'replica', DATA_DIR: '/data',
    AZURE_STORAGE_CONNECTION_STRING: azurite.connectionString, AZURE_STORAGE_CREATE_CONTAINER: 'true', PORT: '0',
  };
});
after(() => azurite?.stop());

/** A stand-in for the Litestream program that records what it was asked to do. */
function fakeRun(events, { restoreExit = 0, replicate = async () => 0 } = {}) {
  return async (args) => {
    const step = args[0] + (args.includes('-once') ? '-once' : '');
    events.push(step);
    if (step === 'restore') return restoreExit;
    if (step === 'replicate') return replicate();
    return 0;
  };
}
const fakeStandby = (events) => async () => {
  events.push('standby-up');
  return { close: async () => { events.push('standby-down'); } };
};
const spyLease = (events) => async (e, opts) => {
  const lease = await makeLease(e, opts);
  const { acquire, release } = lease;
  lease.acquire = async (...a) => { await acquire.apply(lease, a); events.push('lease-acquired'); };
  lease.release = async (...a) => { events.push('lease-released'); return release.apply(lease, a); };
  return lease;
};

test('the configuration names the replica and never includes a key unless the emulator needs one', () => {
  const text = litestreamConfig({ AZURE_STORAGE_ACCOUNT: 'homedata', DATA_DIR: '/data' });
  assert.match(text, /path: \/data\/home-maintenance\.db/);
  assert.match(text, /type: abs\n\s+account-name: homedata\n\s+bucket: replica\n\s+path: db\/home-maintenance/);
  assert.match(text, /sync-interval: 1s/);
  assert.match(text, /retention: 168h/);
  assert.doesNotMatch(text, /account-key|endpoint/, 'a real account uses the managed identity');

  const emulator = litestreamConfig({ AZURE_STORAGE_ACCOUNT: 'devstoreaccount1', LITESTREAM_ABS_ENDPOINT: 'http://127.0.0.1:10000/devstoreaccount1', LITESTREAM_ABS_ACCOUNT_KEY: EMULATOR_KEY });
  assert.match(emulator, /endpoint: http:\/\/127\.0\.0\.1:10000\/devstoreaccount1/);
  assert.match(emulator, /account-key: /);
});

test('configuration values are checked so nothing odd can be written into the file', () => {
  const ok = { AZURE_STORAGE_ACCOUNT: 'homedata' };
  assert.throws(() => litestreamConfig({}), /storage account name/);
  assert.throws(() => litestreamConfig({ AZURE_STORAGE_ACCOUNT: 'Bad_Name' }), /storage account name/);
  assert.throws(() => litestreamConfig({ ...ok, LITESTREAM_CONTAINER: 'x\n  evil: true' }), /container name/);
  assert.throws(() => litestreamConfig({ ...ok, LITESTREAM_PATH: '../up' }), /blob path/);
  assert.throws(() => litestreamConfig({ ...ok, DATA_DIR: '/data; rm -rf /' }), /unexpected characters/);
  assert.throws(() => litestreamConfig({ ...ok, LITESTREAM_ABS_ENDPOINT: 'http://x\nkey: y' }), /not a valid address/);
});

test('start-up order: wait for the lock, restore, start the app, take a last copy, give the lock back', async () => {
  const events = [];
  const exits = [];
  await main({ env, log: quiet, exit: (c) => exits.push(c), run: fakeRun(events), standby: fakeStandby(events), lease: spyLease(events), signals: new EventEmitter() });
  assert.deepEqual(events, ['standby-up', 'lease-acquired', 'restore', 'standby-down', 'replicate', 'replicate-once', 'lease-released']);
  assert.deepEqual(exits, [0]);
});

test('the app exit code is passed on so the platform can see a crash', async () => {
  const exits = [];
  await main({ env, log: quiet, exit: (c) => exits.push(c), run: fakeRun([], { replicate: async () => 3 }), standby: fakeStandby([]), lease: makeLease, signals: new EventEmitter() });
  assert.deepEqual(exits, [3]);
});

test('a failed restore stops everything: no app, no empty database over the backup, lock released', async () => {
  const events = [];
  const exits = [];
  await main({ env, log: quiet, exit: (c) => exits.push(c), run: fakeRun(events, { restoreExit: 1 }), standby: fakeStandby(events), lease: spyLease(events), signals: new EventEmitter() });
  assert.deepEqual(events, ['standby-up', 'lease-acquired', 'restore', 'standby-down', 'lease-released']);
  assert.deepEqual(exits, [1]);
});

test('a second copy does not restore or start until the first one has finished and let go', async () => {
  const eventsA = [];
  const eventsB = [];
  let finishA;
  const appA = new Promise((resolve) => { finishA = () => resolve(0); });

  const a = main({ env, log: quiet, exit: () => {}, run: fakeRun(eventsA, { replicate: () => appA }), standby: fakeStandby(eventsA), lease: spyLease(eventsA), signals: new EventEmitter() });
  for (let i = 0; i < 100 && !eventsA.includes('replicate'); i++) await new Promise((r) => setTimeout(r, 50));
  assert.ok(eventsA.includes('replicate'), 'the first copy is running the app');

  const b = main({ env, log: quiet, exit: () => {}, run: fakeRun(eventsB), standby: fakeStandby(eventsB), lease: spyLease(eventsB), signals: new EventEmitter() });
  await new Promise((r) => setTimeout(r, 800));
  assert.deepEqual(eventsB, ['standby-up'], 'the new copy answers health checks but does nothing else while the old one runs');

  finishA();
  await a;
  await b;
  assert.deepEqual(eventsA.slice(-2), ['replicate-once', 'lease-released']);
  assert.deepEqual(eventsB, ['standby-up', 'lease-acquired', 'restore', 'standby-down', 'replicate', 'replicate-once', 'lease-released']);
});

test('a shutdown request while still waiting for the lock leaves cleanly', async () => {
  let finishA;
  const eventsA = [];
  const a = main({ env, log: quiet, exit: () => {}, run: fakeRun(eventsA, { replicate: () => new Promise((r) => { finishA = () => r(0); }) }), standby: fakeStandby(eventsA), lease: spyLease(eventsA), signals: new EventEmitter() });
  for (let i = 0; i < 100 && !eventsA.includes('replicate'); i++) await new Promise((r) => setTimeout(r, 50));

  const events = [];
  const exits = [];
  const signals = new EventEmitter();
  main({ env, log: quiet, exit: (c) => exits.push(c), run: fakeRun(events), standby: fakeStandby(events), lease: spyLease(events), signals });
  await new Promise((r) => setTimeout(r, 400));
  signals.emit('SIGTERM');
  for (let i = 0; i < 40 && !exits.length; i++) await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(exits, [0]);
  assert.ok(!events.includes('restore'), 'it must not have started restoring');
  finishA();
  await a;
});

test('the waiting server says it is healthy but refuses real requests, and frees the port when closed', async () => {
  const port = await freePort();
  const standby = await startStandby(port);
  const health = await fetch(`http://127.0.0.1:${port}/healthz`);
  assert.equal(health.status, 200);
  const other = await fetch(`http://127.0.0.1:${port}/api/vendors`);
  assert.equal(other.status, 503);
  assert.equal(other.headers.get('retry-after'), '5');
  await standby.close();
  const again = await startStandby(port); // would fail if the port were still taken
  await again.close();
});

test('without LITESTREAM_ENABLED the entry point just starts the app', async () => {
  const port = await freePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-boot-'));
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/bootstrap.js'], {
    cwd: root, env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, SEED: 'false', LITESTREAM_ENABLED: '', ANTHROPIC_API_KEY: '' }, stdio: 'ignore',
  });
  try {
    let up = false;
    for (let i = 0; i < 100 && !up; i++) {
      try { up = (await fetch(`http://127.0.0.1:${port}/healthz`)).ok; } catch { await new Promise((r) => setTimeout(r, 100)); }
    }
    assert.ok(up, 'the app should be serving');
  } finally { child.kill(); }
});
