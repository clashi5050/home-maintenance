// The whole server running the way it runs in Azure: people sign in through the platform (identity
// headers), documents live in Blob Storage (an emulator here), and changes are recorded per person.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createBlobService } from '../server/storage.js';
import { startAzurite } from './helpers/azurite.js';
import { principalHeader } from './helpers/principal.js';

const root = path.resolve(import.meta.dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-azure-'));
let child;
let azurite;
let base;
let host;

const freePort = () => new Promise((resolve) => {
  const s = net.createServer().listen(0, () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

before(async () => {
  azurite = await startAzurite();
  const port = await freePort();
  host = `127.0.0.1:${port}`;
  base = `http://${host}`;
  child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], {
    cwd: root,
    env: {
      ...process.env, PORT: String(port), DATA_DIR: dataDir, SEED: 'false', TZ: 'America/New_York', ANTHROPIC_API_KEY: '',
      AUTH_MODE: 'easyauth', ALLOWED_EMAILS: 'me@example.com, spouse@example.com',
      STORAGE_BACKEND: 'azure-blob', AZURE_STORAGE_CONNECTION_STRING: azurite.connectionString, AZURE_STORAGE_CONTAINER: 'documents',
      AZURE_STORAGE_CREATE_CONTAINER: 'true',
    },
    stdio: 'ignore',
  });
  for (let i = 0; i < 300; i++) {
    try { if ((await fetch(`${base}/healthz`)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
});
after(() => { child?.kill(); azurite?.stop(); });

const as = (email, extra = {}) => ({ 'x-ms-client-principal': principalHeader({ email, id: `id-${email}` }), ...extra });
const call = (method, url, { headers = {}, body } = {}) => fetch(base + url, {
  method,
  headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

test('the health check is open, and every answer carries the security headers', async () => {
  const res = await call('GET', '/healthz');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('strict-transport-security'), /max-age=31536000/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('cross-origin-opener-policy'), 'same-origin');
  assert.match(res.headers.get('permissions-policy'), /camera=\(\)/);
  assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'none'/);
});

test('nothing else is served without a sign-in, or to someone who is not on the list', async () => {
  for (const url of ['/', '/api/summary', '/api/vendors', '/api/documents', '/api/export', '/app.js']) {
    assert.equal((await call('GET', url)).status, 401, `${url} without sign-in`);
    assert.equal((await call('GET', url, { headers: as('stranger@example.com') })).status, 403, `${url} for a stranger`);
  }
  assert.equal((await call('GET', '/api/summary', { headers: as('me@example.com') })).status, 200);
  assert.equal((await call('GET', '/api/summary', { headers: as('SPOUSE@example.com') })).status, 200, 'the list ignores capitals');
});

test('a forged identity header from a caller does not matter without one that is well formed', async () => {
  const res = await call('GET', '/api/summary', { headers: { 'x-ms-client-principal-name': 'me@example.com' } });
  assert.equal(res.status, 401, 'the plain name header alone proves nothing');
});

test('a request from another website cannot change anything, and a normal one can', async () => {
  const evil = await call('POST', '/api/vendors', { headers: as('me@example.com', { origin: 'https://evil.example', host }), body: { name: 'Forged Ltd' } });
  assert.equal(evil.status, 403);
  const own = await call('POST', '/api/vendors', { headers: as('me@example.com', { origin: base }), body: { name: 'Real Plumbing' } });
  assert.equal(own.status, 201);
  const names = (await (await call('GET', '/api/vendors', { headers: as('me@example.com') })).json()).map((v) => v.name);
  assert.deepEqual(names, ['Real Plumbing']);
});

test('changes are recorded against the person who made them', async () => {
  await call('POST', '/api/vendors', { headers: as('spouse@example.com'), body: { name: 'Second Vendor' } });
  await call('GET', '/api/vendors', { headers: as('me@example.com') });
  const db = new DatabaseSync(path.join(dataDir, 'home-maintenance.db'), { readOnly: true });
  const rows = db.prepare('SELECT actor, method, path, status FROM audit_log ORDER BY id').all();
  db.close();
  assert.deepEqual(rows.map((r) => [r.actor, r.method, r.path, r.status]), [
    ['me@example.com', 'POST', '/api/vendors', 201],
    ['spouse@example.com', 'POST', '/api/vendors', 201],
  ], 'reads are not recorded, and forged or refused requests leave no entry');
});

test('documents are stored in Blob Storage, served back, and removed from it on delete', async () => {
  const headers = as('me@example.com', { 'X-Filename': encodeURIComponent('receipt.png') });
  const upload = await fetch(`${base}/api/documents?title=Receipt`, { method: 'POST', headers, body: PNG });
  assert.equal(upload.status, 201);
  const doc = await upload.json();

  const blobs = (await createBlobService({ connectionString: azurite.connectionString })).getContainerClient('documents');
  const names = async () => { const out = []; for await (const b of blobs.listBlobsFlat()) out.push(b.name); return out; };
  assert.equal((await names()).length, 1, 'the file is in the blob container');
  assert.equal(fs.existsSync(path.join(dataDir, 'files')), false, 'nothing is written to a local files folder');
  assert.deepEqual(fs.readdirSync(path.join(dataDir, 'tmp')), [], 'and the scratch copy is gone');

  const file = await call('GET', `/api/documents/${doc.id}/file`, { headers: as('me@example.com') });
  assert.equal(file.status, 200);
  assert.equal(file.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), PNG);

  assert.equal((await call('DELETE', `/api/documents/${doc.id}`, { headers: as('me@example.com') })).status, 204);
  assert.deepEqual(await names(), [], 'deleting the record deletes the blob');
  assert.equal((await call('GET', `/api/documents/${doc.id}/file`, { headers: as('me@example.com') })).status, 404);
});

test('a file whose contents do not match its type is refused before it is stored', async () => {
  const headers = as('me@example.com', { 'X-Filename': encodeURIComponent('fake.png') });
  const res = await fetch(`${base}/api/documents`, { method: 'POST', headers, body: Buffer.from('this is not a png') });
  assert.equal(res.status, 415);
  const blobs = (await createBlobService({ connectionString: azurite.connectionString })).getContainerClient('documents');
  let count = 0;
  for await (const b of blobs.listBlobsFlat()) count += b ? 1 : 0;
  assert.equal(count, 0);
});

test('a notification server address cannot point at internal networks', async () => {
  for (const bad of ['http://127.0.0.1:8080', 'http://169.254.169.254/metadata', 'http://192.168.1.10', 'http://localhost']) {
    const res = await call('PUT', '/api/settings', { headers: as('me@example.com'), body: { ntfy_url: bad } });
    assert.equal(res.status, 400, `${bad} should be refused`);
  }
  const ok = await call('PUT', '/api/settings', { headers: as('me@example.com'), body: { ntfy_url: 'https://ntfy.sh' } });
  assert.equal(ok.status, 200);
});
