import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createBlobStorage, createLocalStorage, storageFromEnv } from '../server/storage.js';
import { startAzurite } from './helpers/azurite.js';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-storage-'));
let azurite;
before(async () => { azurite = await startAzurite(); });
after(() => { azurite?.stop(); fs.rmSync(scratch, { recursive: true, force: true }); });

const source = (text) => {
  const file = path.join(scratch, `src-${Math.random().toString(36).slice(2)}`);
  fs.writeFileSync(file, text);
  return file;
};
const readAll = async ({ stream }) => {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
};

// The same behaviour must hold on both backends, so every case runs against each.
const backends = {
  local: async () => createLocalStorage(path.join(scratch, 'files')),
  'azure-blob': async () => createBlobStorage({ container: 'documents', connectionString: azurite.connectionString, createContainer: true }),
};

for (const [name, make] of Object.entries(backends)) {
  test(`${name}: a stored file can be read back and its size is reported`, async () => {
    const storage = await make();
    const src = source('hello receipt');
    await storage.putFile('a1.pdf', src, { contentType: 'application/pdf' });
    const file = await storage.openRead('a1.pdf');
    assert.equal(file.size, 13);
    assert.equal(await readAll(file), 'hello receipt');
    assert.equal(fs.existsSync(src), false, 'the scratch copy is removed once the file is stored');
  });

  test(`${name}: a missing file reads as null and removing it is harmless`, async () => {
    const storage = await make();
    assert.equal(await storage.openRead('nope.pdf'), null);
    await storage.remove('nope.pdf');
  });

  test(`${name}: removing deletes the file`, async () => {
    const storage = await make();
    await storage.putFile('b2.png', source('x'));
    await storage.remove('b2.png');
    assert.equal(await storage.openRead('b2.png'), null);
  });

  test(`${name}: names that could escape the folder are refused`, async () => {
    const storage = await make();
    for (const bad of ['../evil.pdf', '..', 'a/b.pdf', 'a\\b.pdf', '.hidden', '', 'x'.repeat(200)]) {
      await assert.rejects(() => storage.openRead(bad), /Unsafe file name/, `should refuse ${JSON.stringify(bad)}`);
    }
  });
}

test('azure-blob: prefixes keep two areas apart', async () => {
  const one = await createBlobStorage({ container: 'documents', connectionString: azurite.connectionString, prefix: 'house-one/' });
  const two = await createBlobStorage({ container: 'documents', connectionString: azurite.connectionString, prefix: 'house-two/' });
  await one.putFile('same.pdf', source('one'));
  await two.putFile('same.pdf', source('two'));
  assert.equal(await readAll(await one.openRead('same.pdf')), 'one');
  assert.equal(await readAll(await two.openRead('same.pdf')), 'two');
  await one.remove('same.pdf');
  assert.equal(await one.openRead('same.pdf'), null);
  assert.equal(await readAll(await two.openRead('same.pdf')), 'two', 'removing from one area leaves the other alone');
});

test('azure-blob: a bad prefix or missing settings fail loudly', async () => {
  await assert.rejects(() => createBlobStorage({ container: 'documents', connectionString: azurite.connectionString, prefix: '../x/' }), /Unsafe blob prefix/);
  await assert.rejects(() => createBlobStorage({ container: 'documents' }), /AZURE_STORAGE_ACCOUNT/);
});

test('the backend is chosen from configuration', async () => {
  assert.equal((await storageFromEnv({}, { filesDir: path.join(scratch, 'a') })).backend, 'local');
  const blob = await storageFromEnv({
    STORAGE_BACKEND: 'azure-blob', AZURE_STORAGE_CONNECTION_STRING: azurite.connectionString, AZURE_STORAGE_CREATE_CONTAINER: 'true',
  }, { filesDir: scratch });
  assert.equal(blob.backend, 'azure-blob');
  await assert.rejects(() => storageFromEnv({ STORAGE_BACKEND: 'ftp' }, { filesDir: scratch }), /must be "local" or "azure-blob"/);
});
