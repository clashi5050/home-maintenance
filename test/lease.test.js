import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { WriterLease } from '../server/lease.js';
import { createBlobService } from '../server/storage.js';
import { startAzurite } from './helpers/azurite.js';

let azurite;
let container;
const quiet = { log() {}, error() {} };
const lockBlob = () => container.getBlockBlobClient('locks/writer.lock');

before(async () => {
  azurite = await startAzurite();
  container = (await createBlobService({ connectionString: azurite.connectionString })).getContainerClient('replica');
  await container.createIfNotExists();
});
after(() => azurite?.stop());

const lease = (opts = {}) => new WriterLease(lockBlob(), { log: quiet, ...opts });

test('only one holder at a time: the second copy waits until the first lets go', async () => {
  const first = lease({ leaseSeconds: 15 });
  await first.acquire();

  const second = lease({ leaseSeconds: 15 });
  let secondGotIt = false;
  const waiting = second.acquire({ retryMs: 100 }).then(() => { secondGotIt = true; });

  await new Promise((r) => setTimeout(r, 600));
  assert.equal(secondGotIt, false, 'the second copy must not start while the first holds the lock');

  await first.release();
  await waiting;
  assert.equal(secondGotIt, true);
  assert.equal(second.held, true);
  await second.release();
});

test('a released lock can be taken again straight away', async () => {
  const a = lease({ leaseSeconds: 15 });
  await a.acquire();
  await a.release();
  const b = lease({ leaseSeconds: 15 });
  await b.acquire({ retryMs: 50 });
  assert.equal(b.held, true);
  await b.release();
});

test('a copy that loses the lock notices and stops itself', async () => {
  let lost = null;
  const a = lease({ leaseSeconds: 15, renewEveryMs: 100, onLost: (err) => { lost = err; } });
  await a.acquire();

  // Someone breaks the lock, for example the platform after a network split.
  await lockBlob().getBlobLeaseClient().breakLease(0);
  const intruder = lease({ leaseSeconds: 15 });
  await intruder.acquire({ retryMs: 50 });

  for (let i = 0; i < 40 && !lost; i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok(lost, 'the old holder should have been told it lost the lock');
  assert.equal(a.held, false);
  await intruder.release();
});

test('a copy that cannot renew stops itself before the lock could expire', async () => {
  let lost = null;
  const failing = { // a lock whose renewals keep failing with a network-style error
    renewLease: async () => { throw Object.assign(new Error('network down'), { statusCode: undefined }); },
    releaseLease: async () => {},
    acquireLease: async () => {},
  };
  const blob = { uploadData: async () => {}, getBlobLeaseClient: () => failing };
  const l = new WriterLease(blob, { leaseSeconds: 1, renewEveryMs: 50, onLost: (err) => { lost = err; }, log: quiet });
  await l.acquire();
  for (let i = 0; i < 40 && !lost; i++) await new Promise((r) => setTimeout(r, 50));
  assert.ok(lost, 'repeated failures must trigger the stop, since the lock is about to expire');
});
