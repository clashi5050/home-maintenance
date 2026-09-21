// Runs the REAL Litestream binary against the Azurite Blob emulator to prove the backup and restore path
// that server/bootstrap.js relies on, including the real shutdown and crash sequences.
//
// Skipped unless LITESTREAM_BIN points at a litestream executable (CI installs the version pinned in the
// Dockerfile on Linux, see .github/workflows/litestream-integration.yml). Run it by hand with:
//   LITESTREAM_BIN=/path/to/litestream node --test test/litestream.integration.test.js
// Only Linux is a supported Litestream platform: the unofficial Windows build fails to flush directories
// ("Access is denied"), so its exit codes and timings say nothing about production.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { litestreamConfig } from '../server/bootstrap.js';
import { createBlobService } from '../server/storage.js';
import { EMULATOR_KEY, startAzurite } from './helpers/azurite.js';

const LS = process.env.LITESTREAM_BIN;
const skip = LS ? false : 'set LITESTREAM_BIN to a litestream executable to run this';
const root = path.resolve(import.meta.dirname, '..');
const WRITER = path.join(import.meta.dirname, 'helpers', 'db-writer.mjs');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-ls-'));
const toUnix = (p) => p.replace(/\\/g, '/'); // Litestream splits -exec text like a shell, so avoid backslashes

let azurite;
let container;
before(async () => {
  if (skip) return;
  azurite = await startAzurite();
  container = (await createBlobService({ connectionString: azurite.connectionString })).getContainerClient('replica');
  await container.createIfNotExists();
});
after(() => { azurite?.stop(); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
const ls = (args) => spawnSync(LS, args, { encoding: 'utf8', timeout: 120_000 });
const rowCount = (file) => { const db = new DatabaseSync(file, { readOnly: true }); const { n } = db.prepare('SELECT COUNT(*) AS n FROM t').get(); db.close(); return n; };
const killTree = (child) => {
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F']);
  else process.kill(-child.pid, 'SIGKILL'); // the whole group: Litestream and the app under it
};

function workspace(name, replicaPath) {
  const dir = toUnix(path.join(work, name));
  fs.mkdirSync(dir, { recursive: true });
  const env = { AZURE_STORAGE_ACCOUNT: 'devstoreaccount1', DATA_DIR: dir, LITESTREAM_PATH: replicaPath, LITESTREAM_ABS_ENDPOINT: azurite.endpoint, LITESTREAM_ABS_ACCOUNT_KEY: EMULATOR_KEY };
  const config = `${dir}/litestream.yml`;
  fs.writeFileSync(config, litestreamConfig(env));
  return { dir, config, dbFile: `${dir}/home-maintenance.db`, progress: `${dir}/progress.txt` };
}
const writerCommand = (w, rows, delay) => `node --disable-warning=ExperimentalWarning ${toUnix(WRITER)} ${w.dbFile} ${rows} ${delay} ${w.progress}`;
const restoreTo = (w, target) => ls(['restore', '-if-db-not-exists', '-if-replica-exists', '-config', w.config, '-o', target, w.dbFile]);

test('a first start: restoring when nothing was ever backed up succeeds and makes no database', { skip }, () => {
  const w = workspace('empty', 'db/empty');
  const r = ls(['restore', '-if-db-not-exists', '-if-replica-exists', '-config', w.config, w.dbFile]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.existsSync(w.dbFile), false, 'no database file: this is why bootstrap checks the result of a restore');
  assert.notEqual(ls(['restore', '-config', w.config, w.dbFile]).status, 0, 'without -if-replica-exists the same restore is an error');
});

test('one copy and one restore give back exactly the same rows', { skip }, async () => {
  const w = workspace('basic', 'db/basic');
  const db = new DatabaseSync(w.dbFile);
  db.exec('PRAGMA journal_mode = WAL; CREATE TABLE t (id INTEGER PRIMARY KEY, at INTEGER);');
  for (let i = 0; i < 5; i += 1) db.prepare('INSERT INTO t (at) VALUES (?)').run(i);
  db.close();
  const rep = ls(['replicate', '-once', '-config', w.config]);
  assert.equal(rep.status, 0, `${rep.stdout}${rep.stderr}`);
  let blobs = 0;
  for await (const b of container.listBlobsFlat({ prefix: 'db/basic/' })) blobs += b ? 1 : 0;
  assert.ok(blobs > 0, 'the data reached Blob Storage under the replica path');
  for (const s of ['', '-wal', '-shm']) fs.rmSync(`${w.dbFile}${s}`, { force: true });
  const res = ls(['restore', '-if-db-not-exists', '-if-replica-exists', '-config', w.config, w.dbFile]);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(rowCount(w.dbFile), 5);
});

test('a database that only appears after Litestream has started is replicated, and a normal exit loses nothing', { skip }, (t) => {
  const w = workspace('late', 'db/late');
  const r = ls(['replicate', '-config', w.config, '-exec', writerCommand(w, 20, 100)]);
  t.diagnostic(`replicate -exec exit code with a clean app exit: ${r.status}`);
  const target = `${w.dir}/restored.db`;
  const res = restoreTo(w, target);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(rowCount(target), 20, 'all 20 rows are in the backup after the app exited normally');
});

test('the exit code of a crashing app is passed on (reported, not enforced)', { skip }, (t) => {
  const w = workspace('crash', 'db/crash');
  const r = ls(['replicate', '-config', w.config, '-exec', 'node -e "process.exit(3)"']);
  t.diagnostic(`app exit code 3 came back from litestream as ${r.status}`);
});

test('after a hard kill with no warning the database still restores, and only a few seconds of writes are lost', { skip }, async (t) => {
  const w = workspace('kill', 'db/kill');
  const child = spawn(LS, ['replicate', '-config', w.config, '-exec', writerCommand(w, 100_000, 100)], { stdio: 'ignore', detached: true });
  await sleep(8000);
  killTree(child);
  await sleep(500);
  const written = Number(fs.readFileSync(w.progress, 'utf8'));
  const target = `${w.dir}/restored.db`;
  const res = restoreTo(w, target);
  assert.equal(res.status, 0, res.stderr);
  const restored = rowCount(target);
  const lost = written - restored;
  t.diagnostic(`wrote ${written} rows at 10 per second, restored ${restored}, lost ${lost} = about ${(lost / 10).toFixed(1)} s of writes`);
  assert.ok(lost >= 0 && lost <= 30, `lost ${lost} rows`);
});

// ---- the whole Azure start-up: bootstrap.js + Blob lease + Litestream + the real app ----
function bootstrapEnv(port, dataDir, replicaPath) {
  return {
    ...process.env, LITESTREAM_ENABLED: 'true', LITESTREAM_BIN: LS, PORT: String(port), DATA_DIR: dataDir, SEED: 'false', ANTHROPIC_API_KEY: '',
    AUTH_MODE: '', BASIC_AUTH: '', AZURE_STORAGE_ACCOUNT: 'devstoreaccount1', AZURE_STORAGE_CONNECTION_STRING: azurite.connectionString,
    AZURE_STORAGE_CREATE_CONTAINER: 'true', LITESTREAM_PATH: replicaPath, LITESTREAM_ABS_ENDPOINT: azurite.endpoint, LITESTREAM_ABS_ACCOUNT_KEY: EMULATOR_KEY,
  };
}
const startBootstrap = (port, name, replicaPath) => {
  const dir = path.join(work, name);
  fs.mkdirSync(dir, { recursive: true });
  return spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/bootstrap.js'], {
    cwd: root, env: bootstrapEnv(port, toUnix(dir), replicaPath), stdio: 'ignore', detached: process.platform !== 'win32',
  });
};
const get = async (port, p) => { try { return await fetch(`http://127.0.0.1:${port}${p}`); } catch { return null; } };
async function until(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(300); } return null; }
const serving = (port) => until(async () => { const r = await get(port, '/api/vendors'); return r && r.status === 200 ? r : null; }, 180_000);
const exited = (child, ms) => new Promise((resolve) => { if (child.exitCode !== null) return resolve(child.exitCode); const timer = setTimeout(() => resolve(null), ms); child.once('exit', (code) => { clearTimeout(timer); resolve(code); }); return undefined; });
const saveVendor = (port, name) => fetch(`http://127.0.0.1:${port}/api/vendors`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });

test('a normal shutdown (SIGTERM): the app stops, a last copy is taken, the lock is released, and the next copy starts at once', { skip: skip || (process.platform === 'win32' && 'Windows cannot deliver SIGTERM') }, async (t) => {
  const port = await freePort();
  const first = startBootstrap(port, 'graceful-a', 'db/graceful');
  assert.ok(await serving(port), 'the first copy starts the real app under Litestream');
  assert.equal((await saveVendor(port, 'Saved Just Before Shutdown Plumbing')).status, 201);

  first.kill('SIGTERM'); // what Azure sends when it replaces a revision
  const code = await exited(first, 60_000);
  assert.equal(code, 0, 'bootstrap exits cleanly after the final copy');
  const lock = container.getBlockBlobClient('locks/writer.lock');
  assert.equal((await lock.getProperties()).leaseState, 'available', 'the lock was released, not left to expire');

  const t0 = Date.now();
  const second = startBootstrap(port, 'graceful-b', 'db/graceful'); // a new, empty disk
  const up = await serving(port);
  t.diagnostic(`the second copy was serving ${Math.round((Date.now() - t0) / 1000)} s after it was started`);
  assert.ok(up, 'the second copy takes over');
  assert.ok(Date.now() - t0 < 45_000, 'quickly, because the lock was released');
  assert.ok((await up.json()).some((v) => v.name === 'Saved Just Before Shutdown Plumbing'), 'with the data restored from Blob Storage');
  killTree(second);
});

test('a crash with no warning: the next copy waits for the dead copy\'s lock to expire, then restores everything saved', { skip }, async (t) => {
  const port = await freePort();
  const first = startBootstrap(port, 'crash-a', 'db/crash-boot');
  assert.ok(await serving(port));
  assert.equal((await saveVendor(port, 'Survives The Crash Plumbing')).status, 201);
  await sleep(4000); // longer than the 1 s copy interval
  killTree(first);
  await until(async () => ((await get(port, '/healthz')) ? null : true), 20_000);

  const t0 = Date.now();
  const second = startBootstrap(port, 'crash-b', 'db/crash-boot');
  await sleep(3000);
  const health = await get(port, '/healthz');
  const api = await get(port, '/api/vendors');
  assert.equal(health?.status, 200, 'the waiting copy answers health checks');
  assert.equal(api?.status, 503, 'but refuses real requests while it waits for the lock');

  const up = await serving(port);
  t.diagnostic(`the second copy was serving ${Math.round((Date.now() - t0) / 1000)} s after the crash (the lock lasts 60 s)`);
  assert.ok(up, 'it takes over once the lock expires');
  assert.ok((await up.json()).some((v) => v.name === 'Survives The Crash Plumbing'), 'and the vendor saved before the crash is back');
  killTree(second);
});
