// A single-writer lock kept in Blob Storage, so two copies of the app never write the database at once.
//
// SQLite allows exactly one writer. When a new version is deployed, Azure starts the new copy before it
// stops the old one, so for a short while two copies exist. The new copy therefore waits here until the
// old one lets go of the lock (which it does on shutdown), and a copy that loses the lock stops itself.
// The lock is a Blob lease: the storage service itself guarantees only one holder at a time.
import { setTimeout as sleep } from 'node:timers/promises';

const IGNORABLE_ON_UPLOAD = new Set([409, 412]); // the lock blob already exists

export class WriterLease {
  /**
   * blob: an Azure BlockBlobClient for the lock blob.
   * leaseSeconds: how long the lock survives if we vanish (15 to 60).
   * renewEveryMs: how often we refresh it.
   * onLost: called if we can no longer prove we hold the lock. Must stop all writing.
   */
  constructor(blob, { leaseSeconds = 60, renewEveryMs = 20_000, renewTimeoutMs = 10_000, onLost, log = console } = {}) {
    this.blob = blob;
    this.leaseSeconds = leaseSeconds;
    this.renewEveryMs = renewEveryMs;
    this.renewTimeoutMs = renewTimeoutMs;
    this.onLost = onLost ?? (() => process.exit(1));
    this.log = log;
    this.lease = null;
    this.timer = null;
    this.lastRenewed = 0;
    this.renewing = false;
  }

  get held() { return this.lease !== null; }

  /** Waits until the lock is ours. Retries forever, because the old copy is expected to release soon. */
  async acquire({ retryMs = 3000, signal } = {}) {
    try {
      await this.blob.uploadData(Buffer.alloc(0), { conditions: { ifNoneMatch: '*' } });
    } catch (err) {
      if (!IGNORABLE_ON_UPLOAD.has(err.statusCode)) throw err;
    }
    const lease = this.blob.getBlobLeaseClient();
    for (let waited = false; ;) {
      try {
        await lease.acquireLease(this.leaseSeconds);
        break;
      } catch (err) {
        if (err.statusCode !== 409) throw err; // 409: another copy holds the lock
        if (!waited) this.log.log('[lease] another copy is still writing; waiting for it to finish');
        waited = true;
        await sleep(retryMs, undefined, { signal });
      }
    }
    this.lease = lease;
    this.lastRenewed = Date.now();
    this.timer = setInterval(() => this.#tick(), this.renewEveryMs);
    this.timer.unref();
    this.log.log('[lease] acquired the writer lock');
  }

  #tick() {
    if (!this.lease) return;
    // The deadline is checked on every tick, whatever the last renewal is doing: a call that hangs
    // (a stuck network path) never fails, and must not keep us writing after the lock could have expired
    // and been taken by the next copy.
    if (Date.now() - this.lastRenewed > this.leaseSeconds * 750) {
      this.#lose(new Error('could not renew the lock in time'));
      return;
    }
    if (this.renewing) return; // one renewal at a time
    this.renewing = true;
    this.lease.renewLease({ abortSignal: AbortSignal.timeout(this.renewTimeoutMs) })
      .then(() => { this.lastRenewed = Date.now(); })
      .catch((err) => {
        if ([404, 409, 412].includes(err.statusCode)) { // someone else holds it, or it expired
          this.#lose(err);
          return;
        }
        this.log.error(`[lease] could not renew (will retry): ${err.message}`);
      })
      .finally(() => { this.renewing = false; });
  }

  #lose(err) {
    this.stopRenewing();
    this.lease = null;
    this.log.error(`[lease] lost the writer lock (${err.message}); stopping`);
    this.onLost(err);
  }

  stopRenewing() {
    clearInterval(this.timer);
    this.timer = null;
  }

  /** Gives the lock up so the next copy can start straight away. Call it only after writing has stopped. */
  async release() {
    this.stopRenewing();
    if (!this.lease) return;
    const lease = this.lease;
    this.lease = null;
    try {
      await lease.releaseLease();
      this.log.log('[lease] released the writer lock');
    } catch (err) {
      if (![404, 409, 412].includes(err.statusCode)) throw err; // already expired or taken: nothing left to release
    }
  }
}
