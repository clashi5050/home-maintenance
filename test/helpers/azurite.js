// Starts the Azurite Blob emulator on a free port for tests. Its account name and key are the
// published emulator defaults; they protect nothing and are not credentials for anything real.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
export const EMULATOR_ACCOUNT = 'devstoreaccount1';
export const EMULATOR_KEY = 'Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==';

const freePort = () => new Promise((resolve) => {
  const s = net.createServer().listen(0, () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

export async function startAzurite() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'azurite-'));
  const port = await freePort();
  const child = spawn(process.execPath, [
    path.join(root, 'node_modules/azurite/dist/src/blob/main.js'),
    '--blobHost', '127.0.0.1', '--blobPort', String(port), '--location', dir, '--silent', '--skipApiVersionCheck', '--loose',
  ], { stdio: 'ignore' });

  const endpoint = `http://127.0.0.1:${port}/${EMULATOR_ACCOUNT}`;
  // Patient on purpose: several test files start their own emulator at once, and on a busy or
  // slow-disk machine one can take well over ten seconds to come up.
  for (let i = 0; i < 600; i++) {
    try { await fetch(`${endpoint}?comp=list`); break; } catch { /* not listening yet */ }
    await new Promise((r) => setTimeout(r, 100));
    if (i === 599) { child.kill(); throw new Error('Azurite did not start within 60 seconds'); }
  }
  return {
    endpoint,
    port,
    connectionString: `DefaultEndpointsProtocol=http;AccountName=${EMULATOR_ACCOUNT};AccountKey=${EMULATOR_KEY};BlobEndpoint=${endpoint};`,
    stop: () => { child.kill(); fs.rmSync(dir, { recursive: true, force: true }); },
  };
}
