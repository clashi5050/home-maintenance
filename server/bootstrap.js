// Start command for Azure (the QNAP keeps using server/index.js directly).
//
// SQLite lives on the container's own disk, which disappears with the container, so Litestream copies
// every change to Blob Storage about once a second. On start-up this file:
//   1. answers /healthz right away so Azure sees the new copy as healthy, but serves nothing else yet;
//   2. waits for the single-writer lock (see lease.js), so an old copy finishes first;
//   3. restores the database from Blob Storage;
//   4. hands over to the app under Litestream, which keeps copying changes;
//   5. on shutdown, waits for the app to finish, takes one last copy, then gives the lock back.
// Set LITESTREAM_ENABLED=true to turn this on. Otherwise it simply starts the app.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createBlobService } from './storage.js';
import { WriterLease } from './lease.js';

const NAME = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
const BLOB_PATH = /^[A-Za-z0-9][A-Za-z0-9/_.-]{0,200}$/;
const APP_COMMAND = 'node --disable-warning=ExperimentalWarning server/index.js';

const need = (ok, message) => { if (!ok) throw new Error(message); };

/** The Litestream configuration for the app's database. Every value is checked before it is written. */
export function litestreamConfig(env) {
  const account = env.LITESTREAM_ACCOUNT || env.AZURE_STORAGE_ACCOUNT || '';
  const container = env.LITESTREAM_CONTAINER || 'replica';
  const replicaPath = env.LITESTREAM_PATH || 'db/home-maintenance';
  const dataDir = env.DATA_DIR || '/data';
  const retention = env.LITESTREAM_RETENTION || '168h';
  need(/^\d{1,5}[hm]$/.test(retention), 'LITESTREAM_RETENTION must look like 168h');
  need(/^[a-z0-9]{3,24}$/.test(account), 'LITESTREAM_ACCOUNT (or AZURE_STORAGE_ACCOUNT) must be a storage account name');
  need(NAME.test(container), 'LITESTREAM_CONTAINER must be a valid container name');
  need(BLOB_PATH.test(replicaPath) && !replicaPath.includes('..'), 'LITESTREAM_PATH is not a valid blob path');
  // No quotes, hash signs, line breaks or semicolons: the path is written inside single quotes below.
  need(/^[A-Za-z0-9/_.:\\ -]+$/.test(dataDir), 'DATA_DIR contains unexpected characters');

  const lines = [
    'snapshot:',
    '  interval: 24h',
    `  retention: ${retention}`,
    'dbs:',
    `  - path: '${dataDir}/home-maintenance.db'`,
    '    replica:',
    '      type: abs',
    `      account-name: ${account}`,
    `      bucket: ${container}`,
    `      path: ${replicaPath}`,
    '      sync-interval: 1s',
  ];
  // The emulator needs its address and a well-known test key. A real account never sets these; it uses the managed identity.
  if (env.LITESTREAM_ABS_ENDPOINT) {
    need(/^https?:\/\/[A-Za-z0-9.:/_-]+$/.test(env.LITESTREAM_ABS_ENDPOINT), 'LITESTREAM_ABS_ENDPOINT is not a valid address');
    lines.push(`      endpoint: ${env.LITESTREAM_ABS_ENDPOINT}`);
  }
  if (env.LITESTREAM_ABS_ACCOUNT_KEY) {
    need(/^[A-Za-z0-9+/=]+$/.test(env.LITESTREAM_ABS_ACCOUNT_KEY), 'LITESTREAM_ABS_ACCOUNT_KEY is not valid');
    lines.push(`      account-key: ${env.LITESTREAM_ABS_ACCOUNT_KEY}`);
  }
  return `${lines.join('\n')}\n`;
}

/** A tiny server that only says "I'm alive" until the real app takes over the port. */
export function startStandby(port) {
  const server = http.createServer((req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end('{"ok":true,"state":"starting"}');
    }
    res.writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': '5' });
    return res.end('{"error":"The app is starting. Try again in a few seconds."}');
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => resolve({
      close: () => new Promise((done) => { server.close(() => done()); server.closeAllConnections(); }),
    }));
  });
}

function runLitestream(args, { onChild } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.LITESTREAM_BIN || 'litestream', args, { stdio: 'inherit' });
    onChild?.(child);
    child.on('error', reject);
    child.on('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

export async function makeLease(env, { onLost }) {
  const service = await createBlobService({ account: env.AZURE_STORAGE_ACCOUNT || env.LITESTREAM_ACCOUNT, connectionString: env.AZURE_STORAGE_CONNECTION_STRING });
  const container = service.getContainerClient(env.LITESTREAM_CONTAINER || 'replica');
  if (env.AZURE_STORAGE_CREATE_CONTAINER === 'true') await container.createIfNotExists(); // emulator only
  return new WriterLease(container.getBlockBlobClient('locks/writer.lock'), { onLost });
}

/** True when the replica already holds any data for this database. */
export async function replicaHasData(env) {
  const service = await createBlobService({ account: env.AZURE_STORAGE_ACCOUNT || env.LITESTREAM_ACCOUNT, connectionString: env.AZURE_STORAGE_CONNECTION_STRING });
  const container = service.getContainerClient(env.LITESTREAM_CONTAINER || 'replica');
  try {
    for await (const blob of container.listBlobsFlat({ prefix: `${env.LITESTREAM_PATH || 'db/home-maintenance'}/` })) return Boolean(blob);
  } catch (err) {
    if (err.statusCode !== 404) throw err; // no container yet: nothing has ever been replicated
  }
  return false;
}

export async function main({
  env = process.env, log = console, exit = process.exit, run = runLitestream, standby = startStandby,
  lease: leaseFactory = makeLease, hasReplica = replicaHasData, signals = process,
} = {}) {
  if (env.LITESTREAM_ENABLED !== 'true') {
    await import('./index.js'); // plain start: the QNAP and local development
    return undefined;
  }

  const port = Number(env.PORT) || 8080;
  const dataDir = env.DATA_DIR || '/data';
  const dbFile = path.join(dataDir, 'home-maintenance.db');
  const configFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'litestream-')), 'litestream.yml');
  fs.writeFileSync(configFile, litestreamConfig(env), { mode: 0o600 });

  let running = null; // the Litestream process that supervises the app
  let phase = 'starting'; // starting -> running -> finishing
  let stopping = false;
  let waiting = null;
  let lease = null;
  const cancelWait = new AbortController(); // ends the wait for the lock if we are asked to stop meanwhile

  // A shutdown request. While the app runs, pass it on. While still starting, stop waiting, tidy up and leave.
  // While the final backup pass is running, ignore it: cutting that pass short could lose the last writes.
  const onSignal = async (signal) => {
    if (phase === 'finishing') return undefined;
    if (running) return running.kill(signal);
    stopping = true;
    cancelWait.abort();
    await waiting?.close().catch(() => {});
    await lease?.release().catch(() => {});
    return exit(0);
  };
  signals.on('SIGTERM', () => onSignal('SIGTERM'));
  signals.on('SIGINT', () => onSignal('SIGINT'));

  try {
    waiting = await standby(port);
    lease = await leaseFactory(env, {
      // Losing the lock means another copy may be writing. Stop everything at once.
      onLost: () => { running?.kill('SIGKILL'); exit(1); },
    });
    await lease.acquire({ signal: cancelWait.signal });

    // A leftover local database would make the restore skip itself, so start from a clean slate.
    // (We hold the lock, so nobody else is writing; the replica is the source of truth.)
    const hadBackup = await hasReplica(env);
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${dbFile}${suffix}`, { force: true });

    const restored = await run(['restore', '-if-db-not-exists', '-if-replica-exists', '-config', configFile, dbFile]);
    // Never start on a failed restore: an empty database would then be copied over the good backup.
    if (restored !== 0) throw new Error(`Restoring the database failed (exit ${restored}); refusing to start with an empty one`);
    // "No backup found" also exits 0, so check the result: if a backup exists, there must be a database now.
    if (hadBackup && !fs.existsSync(dbFile)) {
      throw new Error('A backup exists in Blob Storage but the restore produced no database; refusing to start with an empty one');
    }
    await waiting.close();
    waiting = null;

    phase = 'running';
    const code = await run(['replicate', '-config', configFile, '-exec', APP_COMMAND], { onChild: (child) => { running = child; } });
    running = null;

    // One last copy so nothing written in the final second is lost, then let the next copy start.
    phase = 'finishing';
    const final = await run(['replicate', '-once', '-config', configFile]).catch(() => 1);
    if (final !== 0) log.error(`[bootstrap] the final backup pass exited with ${final}`);
    await lease.release();
    return exit(code);
  } catch (err) {
    if (stopping) return undefined; // we were asked to stop while waiting; onSignal already tidied up and left
    log.error(`[bootstrap] ${err.message}`);
    await waiting?.close().catch(() => {});
    await lease?.release().catch(() => {});
    return exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
