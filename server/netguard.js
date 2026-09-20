// Keeps the server from being aimed at internal addresses (server-side request forgery).
// Anyone who can sign in can type in their own ntfy server address, and the server then calls it.
// In a shared deployment that address must never reach loopback, a private network, or the cloud's
// link-local metadata and managed-identity endpoints. On a home NAS, a private ntfy server is
// normal, so the guard is off there (see blockPrivateUrls).
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

const blocked = new net.BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) blocked.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]]) {
  blocked.addSubnet(address, prefix, 'ipv6');
}

/** True when an IP address is not a normal public internet address. */
export function isBlockedAddress(address) {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address); // IPv4 written as IPv6
  const ip = mapped ? mapped[1] : address;
  const family = net.isIP(ip);
  return family === 0 || blocked.check(ip, family === 4 ? 'ipv4' : 'ipv6');
}

export const blockPrivateUrls = (env = process.env) => (
  env.BLOCK_PRIVATE_URLS ? env.BLOCK_PRIVATE_URLS === 'true' : env.AUTH_MODE === 'easyauth'
);

/** Cheap check on the text of a URL. Returns a problem description, or '' when it looks fine. */
export function urlProblem(text) {
  let url;
  try { url = new URL(text); } catch { return 'That is not a valid address'; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'The address must start with http:// or https://';
  if (url.username || url.password) return 'The address must not contain a user name or password';
  const port = url.port || (url.protocol === 'https:' ? '443' : '80');
  if (port !== '80' && port !== '443') return 'Only the standard web ports (80 and 443) are allowed';
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) && isBlockedAddress(host)) return 'That address points at a private or internal network';
  // Names that only make sense inside a network. The connection-time check still decides for everything else.
  if (!net.isIP(host) && (!host.includes('.') || /\.(localhost|local|internal|lan|home\.arpa|corp)$/.test(host))) {
    return 'That address points at a private or internal network';
  }
  return '';
}

// Runs when the socket is about to connect, so a name that resolves to an internal address
// (including one that changes its answer between checks) is refused at the last moment.
function guardedLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const allowed = addresses.filter((a) => !isBlockedAddress(a.address));
    if (!allowed.length) {
      const refused = new Error(`${hostname} resolves to a private or internal address`);
      refused.code = 'EBLOCKED';
      return callback(refused);
    }
    if (options.all) return callback(null, allowed);
    return callback(null, allowed[0].address, allowed[0].family);
  });
}

/**
 * POSTs text to a URL, refusing internal destinations. Redirects are not followed, because a
 * public address could otherwise bounce the request to an internal one.
 * Resolves to { status, statusText }.
 */
export function guardedPost(text, { headers = {}, body = '', timeoutMs = 10_000 } = {}) {
  const problem = urlProblem(text);
  if (problem) return Promise.reject(Object.assign(new Error(problem), { code: 'EBLOCKED' }));
  const url = new URL(text);
  const client = url.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const req = client.request(url, {
      method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
      lookup: guardedLookup,
      timeout: timeoutMs,
    }, (res) => {
      res.resume(); // the answer body is not needed
      res.on('end', () => resolve({ status: res.statusCode, statusText: res.statusMessage ?? '' }));
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
    req.end(body);
  });
}
