import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authSettings, authenticate, isCrossSiteWrite, parsePrincipal } from '../server/auth.js';
import { blockPrivateUrls, guardedPost, isBlockedAddress, urlProblem } from '../server/netguard.js';

import { principalHeader } from './helpers/principal.js';

const easy = (emails = 'me@example.com') => authSettings({ AUTH_MODE: 'easyauth', ALLOWED_EMAILS: emails });
const request = (headers = {}, method = 'GET') => ({ method, headers });

test('the mode defaults to none, or basic when BASIC_AUTH is set', () => {
  assert.equal(authSettings({}).mode, 'none');
  assert.equal(authSettings({ BASIC_AUTH: 'a:b' }).mode, 'basic');
  assert.equal(authSettings({ AUTH_MODE: 'easyauth' }).mode, 'easyauth');
});

test('contradictory or unknown settings are refused at start-up', () => {
  assert.throws(() => authSettings({ AUTH_MODE: 'magic' }), /AUTH_MODE must be one of/);
  assert.throws(() => authSettings({ AUTH_MODE: 'basic' }), /needs BASIC_AUTH/);
  assert.throws(() => authSettings({ AUTH_MODE: 'none', BASIC_AUTH: 'a:b' }), /would ignore it/);
});

test('basic mode still checks the shared password', () => {
  const settings = authSettings({ BASIC_AUTH: 'family:secret' });
  const good = `Basic ${Buffer.from('family:secret').toString('base64')}`;
  const bad = `Basic ${Buffer.from('family:wrong').toString('base64')}`;
  assert.equal(authenticate(request({ authorization: good }), settings).ok, true);
  assert.equal(authenticate(request({ authorization: bad }), settings).status, 401);
  assert.equal(authenticate(request({}), settings).status, 401);
});

test('easyauth: a signed-in person on the list gets in, with their identity', () => {
  const result = authenticate(request({ 'x-ms-client-principal': principalHeader({ email: 'Me@Example.com' }) }), easy());
  assert.equal(result.ok, true);
  assert.equal(result.user.email, 'me@example.com');
  assert.equal(result.user.id, 'user-1');
  assert.equal(result.user.idp, 'google');
});

test('easyauth: nobody is let in without a sign-in, or when not on the list, or with no list at all', () => {
  assert.equal(authenticate(request({}), easy()).status, 401);
  assert.equal(authenticate(request({ 'x-ms-client-principal': principalHeader({ email: 'stranger@example.com' }) }), easy()).status, 403);
  assert.equal(authenticate(request({ 'x-ms-client-principal': principalHeader() }), easy('')).status, 403, 'an empty list must let nobody in');
});

test('easyauth: garbage, oversized or email-less identities are rejected', () => {
  assert.equal(authenticate(request({ 'x-ms-client-principal': 'not base64 json' }), easy()).status, 401);
  assert.equal(authenticate(request({ 'x-ms-client-principal': 'A'.repeat(20_000) }), easy()).status, 401);
  assert.equal(authenticate(request({ 'x-ms-client-principal': principalHeader({ email: '' }) }), easy()).status, 403);
  assert.equal(parsePrincipal({ 'x-ms-client-principal': Buffer.from('{"claims":[]}').toString('base64') }), null, 'no id means no identity');
});

test('easyauth: an email the provider says is unverified is rejected', () => {
  const header = principalHeader({ extra: [{ typ: 'email_verified', val: 'false' }] });
  assert.equal(authenticate(request({ 'x-ms-client-principal': header }), easy()).status, 403);
});

test('cross-site writes are caught; same-site writes and scripts are not', () => {
  const host = 'home.example.net';
  assert.equal(isCrossSiteWrite(request({ host, origin: `https://${host}` }, 'POST')), false, 'same origin');
  assert.equal(isCrossSiteWrite(request({ host, origin: 'https://evil.example' }, 'POST')), true, 'another site');
  assert.equal(isCrossSiteWrite(request({ host, origin: 'null' }, 'DELETE')), true, 'sandboxed frames send "null"');
  assert.equal(isCrossSiteWrite(request({ host, 'sec-fetch-site': 'cross-site' }, 'PUT')), true);
  assert.equal(isCrossSiteWrite(request({ host, 'sec-fetch-site': 'same-origin' }, 'PUT')), false);
  assert.equal(isCrossSiteWrite(request({ host }, 'POST')), false, 'curl and scripts send neither header');
  assert.equal(isCrossSiteWrite(request({ host, origin: 'https://evil.example' }, 'GET')), false, 'reads are not writes');
  assert.equal(isCrossSiteWrite(request({ 'x-forwarded-host': host, host: 'internal:8080', origin: `https://${host}` }, 'POST')), false, 'behind the platform proxy');
});

test('internal and metadata addresses are recognised, public ones are not', () => {
  for (const bad of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:169.254.169.254', 'not-an-ip']) {
    assert.equal(isBlockedAddress(bad), true, `${bad} should be blocked`);
  }
  for (const good of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '93.184.216.34', '2606:4700:4700::1111']) {
    assert.equal(isBlockedAddress(good), false, `${good} should be allowed`);
  }
});

test('URLs that point inward or use odd forms are refused before any request is made', () => {
  assert.equal(urlProblem('https://ntfy.sh'), '');
  assert.equal(urlProblem('http://ntfy.example.org:80/x'), '');
  for (const bad of [
    'ftp://ntfy.sh', 'file:///etc/passwd', 'http://127.0.0.1', 'http://169.254.169.254/latest', 'http://[::1]/',
    'https://user:pw@ntfy.sh', 'https://ntfy.sh:9999', 'not a url',
    'http://localhost', 'http://nas.local', 'http://metadata.google.internal', 'http://ntfy', 'http://2130706433/', 'http://0x7f.1/',
  ]) {
    assert.notEqual(urlProblem(bad), '', `${bad} should be refused`);
  }
});

test('the guarded request refuses internal destinations, including a name that resolves to one', async () => {
  await assert.rejects(() => guardedPost('http://127.0.0.1/topic', { body: 'x' }), { code: 'EBLOCKED' });
  await assert.rejects(() => guardedPost('http://localhost/topic', { body: 'x' }), { code: 'EBLOCKED' }); // resolves to loopback
});

test('the guard is on for shared hosting and off for a home network', () => {
  assert.equal(blockPrivateUrls({}), false);
  assert.equal(blockPrivateUrls({ AUTH_MODE: 'easyauth' }), true);
  assert.equal(blockPrivateUrls({ AUTH_MODE: 'easyauth', BLOCK_PRIVATE_URLS: 'false' }), false);
  assert.equal(blockPrivateUrls({ BLOCK_PRIVATE_URLS: 'true' }), true);
});
