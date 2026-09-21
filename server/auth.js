// Who is allowed in. Three modes, chosen with AUTH_MODE:
//   none      no login (a private home network)
//   basic     one shared user:password from BASIC_AUTH (the original optional login)
//   easyauth  real sign-in handled by the Azure Container Apps platform in front of this app
//
// In easyauth mode the platform signs people in and passes their identity to us in X-MS-CLIENT-PRINCIPAL*
// headers. The platform removes any copy of those headers a caller sends, so they can be trusted
// only because this container is reachable solely through that platform. Never set AUTH_MODE=easyauth
// on anything that is exposed directly.
import crypto from 'node:crypto';

const MODES = ['none', 'basic', 'easyauth'];
const digest = (s) => crypto.createHash('sha256').update(s).digest();

export function authSettings(env = process.env) {
  const mode = (env.AUTH_MODE || (env.BASIC_AUTH ? 'basic' : 'none')).toLowerCase();
  if (!MODES.includes(mode)) throw new Error(`AUTH_MODE must be one of: ${MODES.join(', ')}`);
  if (mode === 'basic' && !env.BASIC_AUTH) throw new Error('AUTH_MODE=basic needs BASIC_AUTH=user:password');
  if (mode === 'none' && env.BASIC_AUTH) throw new Error('BASIC_AUTH is set but AUTH_MODE=none would ignore it; remove one of them');
  const allowedEmails = new Set(
    (env.ALLOWED_EMAILS || '').split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean),
  );
  // Providers whose email addresses are always verified (Google checks them). For any other provider
  // (a work or school directory, GitHub, Facebook...) the address can be typed in by the account owner or
  // a tenant admin, so it only counts when the token itself says it is verified.
  const trustedProviders = new Set(
    (env.TRUSTED_EMAIL_PROVIDERS || 'google').split(/[\s,;]+/).map((p) => p.trim().toLowerCase()).filter(Boolean),
  );
  return { mode, basicAuth: env.BASIC_AUTH || '', allowedEmails, trustedProviders };
}

const EMAIL_CLAIMS = [
  'email', 'emails', 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress', 'preferred_username', 'upn',
];
const ID_CLAIMS = [
  'sub', 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier',
  'http://schemas.microsoft.com/identity/claims/objectidentifier', 'oid',
];

/** Reads the identity the platform attached to a request. Returns null when there is none. */
export function parsePrincipal(headers) {
  const encoded = headers['x-ms-client-principal'];
  if (typeof encoded !== 'string' || !encoded || encoded.length > 16_384) return null;
  let data;
  try { data = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')); } catch { return null; }
  const claims = Array.isArray(data?.claims) ? data.claims : [];
  const first = (types, accept = () => true) => {
    for (const type of types) {
      const hit = claims.find((c) => c?.typ === type && typeof c.val === 'string' && accept(c.val));
      if (hit) return hit.val;
    }
    return '';
  };
  const id = headers['x-ms-client-principal-id'] || first(ID_CLAIMS);
  if (!id) return null;
  const verified = first(['email_verified']).trim().toLowerCase();
  return {
    id: String(id),
    idp: String(headers['x-ms-client-principal-idp'] || data.auth_typ || '').toLowerCase(),
    email: first(EMAIL_CLAIMS, (v) => v.includes('@')).trim().toLowerCase(),
    name: String(headers['x-ms-client-principal-name'] || ''),
    // true / false when the token says so, null when it says nothing.
    emailVerified: verified === 'true' ? true : verified === '' ? null : false,
  };
}

const page = (title, body) => `<!doctype html><meta charset="utf-8"><title>${title}</title>
<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem"><h1>${title}</h1><p>${body}</p>`;

const denied = (status, title, body) => ({
  ok: false, status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }, body: page(title, body),
});

/** Decides whether a request may continue. { ok: true, user } or { ok: false, status, headers, body }. */
export function authenticate(req, settings) {
  if (settings.mode === 'none') return { ok: true, user: null };

  if (settings.mode === 'basic') {
    const header = req.headers.authorization || '';
    const given = header.startsWith('Basic ') ? Buffer.from(header.slice(6), 'base64').toString('utf8') : null;
    if (given !== null && crypto.timingSafeEqual(digest(given), digest(settings.basicAuth))) return { ok: true, user: null };
    return { ok: false, status: 401, headers: { 'WWW-Authenticate': 'Basic realm="Home Maintenance"' }, body: 'Authentication required' };
  }

  const user = parsePrincipal(req.headers);
  if (!user) return denied(401, 'Please sign in', 'You need to <a href="/.auth/login/google">sign in</a> to use Home Maintenance.');
  if (!user.email) return denied(403, 'No email address', 'Your sign-in did not include an email address, so we cannot tell who you are.');
  // Anything but a plain "true" is refused, except from a provider we trust to verify addresses itself.
  if (user.emailVerified === false || (user.emailVerified === null && !settings.trustedProviders.has(user.idp))) {
    return denied(403, 'Email not verified', 'Please verify your email address with your sign-in provider and try again.');
  }
  // Fail closed: with no list configured nobody gets in.
  if (!settings.allowedEmails.has(user.email)) {
    return denied(403, 'Not on the list', 'This account is not allowed to use this site. <a href="/.auth/logout">Sign out</a>');
  }
  return { ok: true, user };
}

/**
 * Cross-site request forgery guard for anything that changes data. Sign-in is a browser cookie,
 * so a hostile page could otherwise make the browser send a request the user never meant.
 * Browsers always tell us where a request came from; scripts and curl send neither header.
 */
export function isCrossSiteWrite(req) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return false;
  const origin = req.headers.origin;
  if (origin) {
    let originHost;
    try { originHost = new URL(origin).host; } catch { return true; } // includes the literal "null"
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    return originHost !== host;
  }
  const site = req.headers['sec-fetch-site'];
  return Boolean(site) && site !== 'same-origin' && site !== 'none';
}
