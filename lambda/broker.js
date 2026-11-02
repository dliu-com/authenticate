import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { CLIENTS, SITE_URL } from './config.js';
import { authority, exchangeMicrosoftCode, IdentityRejected } from './entra.js';
import { digest, keyFor } from './store.js';
import { logoutScript } from './logout-page.js';

export const SESSION_COOKIE = '__Host-auth_session';
export const FLOW_COOKIE = '__Host-auth_flow';
export const SESSION_SECONDS = 12 * 60 * 60;
export const FLOW_SECONDS = 10 * 60;
export const CODE_SECONDS = 60;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const STATE = /^[A-Za-z0-9_-]{43,128}$/;
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
const random = () => randomBytes(32).toString('base64url');
const same = (left, right) => typeof left === 'string' && typeof right === 'string' &&
  Buffer.byteLength(left) === Buffer.byteLength(right) &&
  timingSafeEqual(Buffer.from(left), Buffer.from(right));
const escape = (value) => String(value).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const cookie = (name, value, age) =>
  `${name}=${value}; Path=/; Max-Age=${age}; Secure; HttpOnly; SameSite=Lax`;
const clearFlow = () => cookie(FLOW_COOKIE, '', 0);

class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}
const fail = (status, code) => { throw new HttpError(status, code); };

const headers = {
  'cache-control': 'no-store',
  'pragma': 'no-cache',
  'content-security-policy': "default-src 'none'; style-src 'self'; script-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'strict-transport-security': 'max-age=31536000',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};
const response = (statusCode, body, extraHeaders = {}, cookies = []) =>
  ({ statusCode, headers: { ...headers, ...extraHeaders }, body, cookies });
const json = (status, body) => response(status, JSON.stringify(body), { 'content-type': 'application/json' });
const redirect = (location, cookies = []) => response(303, '', { location }, cookies);
const page = (title, body, status = 200) => response(status,
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)} | dliu.com</title><link rel="stylesheet" href="/style.css"></head><body><main><h1>${escape(title)}</h1>${body}</main></body></html>`,
  { 'content-type': 'text/html; charset=utf-8' });

function cookies(event) {
  const result = Object.create(null);
  const parts = event.cookies || (event.headers?.cookie || '').split(';');
  for (const part of parts) {
    const index = part.indexOf('=');
    if (index < 1) continue;
    const name = part.slice(0, index).trim();
    if (Object.hasOwn(result, name)) fail(400, 'duplicate_cookie');
    result[name] = part.slice(index + 1).trim();
  }
  return result;
}

function uniqueParams(raw) {
  const params = new URLSearchParams(raw);
  const result = {};
  for (const [name, value] of params) {
    if (Object.hasOwn(result, name)) fail(400, 'duplicate_parameter');
    Object.defineProperty(result, name, { value, enumerable: true });
  }
  return result;
}

function onlyKeys(object, names) {
  if (!object || typeof object !== 'object' || Array.isArray(object) ||
      Object.keys(object).some((key) => !names.includes(key))) fail(400, 'invalid_parameters');
}

function validateClient(clientId, redirectUri) {
  if (typeof clientId !== 'string' || !Object.hasOwn(CLIENTS, clientId) ||
      redirectUri !== CLIENTS[clientId]) fail(400, 'invalid_client');
}

function authorizeParams(params) {
  onlyKeys(params, ['client_id', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method']);
  validateClient(params.client_id, params.redirect_uri);
  if (!STATE.test(params.state || '') || !TOKEN.test(params.code_challenge || '') ||
      params.code_challenge_method !== 'S256') fail(400, 'invalid_authorization_request');
  return {
    clientId: params.client_id, redirectUri: params.redirect_uri,
    state: params.state, challenge: params.code_challenge,
  };
}

function body(event, type) {
  const contentType = (event.headers?.['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (contentType !== type) fail(415, 'unsupported_media_type');
  if (!event.body || event.body.length > 12_000) fail(400, 'invalid_body');
  const text = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  if (Buffer.byteLength(text) > 8192) fail(413, 'body_too_large');
  if (type === 'application/x-www-form-urlencoded') return uniqueParams(text);
  try {
    const result = JSON.parse(text);
    if (!result || typeof result !== 'object' || Array.isArray(result)) fail(400, 'invalid_body');
    return result;
  } catch (error) {
    if (error instanceof SyntaxError) fail(400, 'invalid_json');
    throw error;
  }
}

function verifyPayloadHash(event) {
  const payload = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64') : Buffer.from(event.body || '', 'utf8');
  if (payload.length > 8192) fail(413, 'body_too_large');
  const given = event.headers?.['x-amz-content-sha256'];
  const expected = createHash('sha256').update(payload).digest('hex');
  if (typeof given !== 'string' || !same(given, expected)) fail(400, 'invalid_payload_hash');
}

export function createBroker({
  store, loadConfig, clock = () => Math.floor(Date.now() / 1000),
  microsoftExchange = exchangeMicrosoftCode,
  logger = console,
}) {
  async function session(event, now) {
    const token = cookies(event)[SESSION_COOKIE];
    if (!TOKEN.test(token || '')) return null;
    const item = await store.get(keyFor('session', token), now);
    return item?.kind === 'session' ? item : null;
  }

  async function handoff(continuation, central, now, newCookies = []) {
    const code = random();
    const issued = await store.issueCode({
      pk: keyFor('code', code), kind: 'code', ...continuation,
      sessionPk: central.pk, expiresAt: Math.min(now + CODE_SECONDS, central.expiresAt),
    }, now);
    if (!issued) fail(401, 'session_expired');
    const target = new URL(continuation.redirectUri);
    target.searchParams.set('code', code);
    target.searchParams.set('state', continuation.state);
    return redirect(target.href, newCookies);
  }

  async function start(continuation, now) {
    const config = await loadConfig();
    const flow = random();
    const transaction = {
      pk: keyFor('flow', flow), kind: 'flow', state: random(), nonce: random(),
      verifier: random(), continuation, expiresAt: now + FLOW_SECONDS,
    };
    await store.put(transaction);
    const query = new URLSearchParams({
      client_id: config.clientId, response_type: 'code', response_mode: 'query',
      redirect_uri: `${SITE_URL}/auth/callback`, scope: 'openid profile email',
      state: transaction.state, nonce: transaction.nonce,
      code_challenge: digest(transaction.verifier), code_challenge_method: 'S256',
    });
    return redirect(`${authority(config)}/oauth2/v2.0/authorize?${query}`, [
      cookie(FLOW_COOKIE, flow, FLOW_SECONDS),
    ]);
  }

  async function callback(event, params, now) {
    const token = cookies(event)[FLOW_COOKIE];
    const transaction = TOKEN.test(token || '') ? await store.get(keyFor('flow', token), now) : null;
    if (!transaction || transaction.kind !== 'flow' || !same(params.state, transaction.state)) {
      fail(400, 'invalid_login_state');
    }
    if (!await store.take(transaction.pk, now)) fail(400, 'invalid_login_state');
    if (params.error || typeof params.code !== 'string' || !params.code || params.code.length > 4096) {
      const result = page('Sign-in was not completed', '<p>Return to your application and try signing in again.</p>', 401);
      result.cookies = [clearFlow()];
      return result;
    }
    let user;
    const config = await loadConfig();
    try {
      user = await microsoftExchange(params.code, transaction, config, now);
    } catch (error) {
      if (!(error instanceof IdentityRejected)) throw error;
      logger.warn({ message: 'Microsoft sign-in validation failed' });
      const result = page('Sign-in rejected', '<p>Microsoft sign-in could not be verified, or this account is not permitted. Use an account in the configured tenant with a dliu.com sign-in address.</p>', 401);
      result.cookies = [clearFlow()];
      return result;
    }
    const sessionToken = random();
    const central = {
      pk: keyFor('session', sessionToken), kind: 'session', user,
      csrf: random(), expiresAt: now + SESSION_SECONDS,
    };
    await store.put(central);
    const previous = await session(event, now);
    if (previous) await store.remove(previous.pk);
    const newCookies = [clearFlow(), cookie(SESSION_COOKIE, sessionToken, SESSION_SECONDS)];
    return transaction.continuation ?
      handoff(transaction.continuation, central, now, newCookies) : redirect('/', newCookies);
  }

  async function exchange(event, now) {
    // This is a backchannel, not a browser API. PKCE authenticates possession of the handoff.
    if (event.headers?.origin || event.headers?.['sec-fetch-site']) fail(403, 'backchannel_required');
    const request = body(event, 'application/json');
    onlyKeys(request, ['code', 'client_id', 'redirect_uri', 'code_verifier']);
    validateClient(request.client_id, request.redirect_uri);
    if (typeof request.code !== 'string' || !TOKEN.test(request.code) ||
        typeof request.code_verifier !== 'string' || !VERIFIER.test(request.code_verifier)) fail(400, 'invalid_grant');
    const item = await store.get(keyFor('code', request.code), now);
    if (!item || item.kind !== 'code' || item.clientId !== request.client_id ||
        item.redirectUri !== request.redirect_uri ||
        !same(item.challenge, digest(request.code_verifier))) fail(400, 'invalid_grant');
    const central = await store.get(item.sessionPk, now);
    if (!central || central.kind !== 'session' || !await store.redeemCode(item, now)) fail(400, 'invalid_grant');
    return json(200, { user: central.user, session_expires_at: central.expiresAt });
  }

  function logoutClient(params) {
    const clientId = params.client_id;
    if (clientId !== undefined && !Object.hasOwn(CLIENTS, clientId)) fail(400, 'invalid_client');
    return clientId;
  }

  async function logoutPage(event, params, now) {
    onlyKeys(params, ['client_id']);
    const clientId = logoutClient(params);
    const central = await session(event, now);
    if (!central) return page('Signed out of central sign-in',
      '<p>No central session is active. Other application sessions and Microsoft sign-in are unchanged.</p><a href="/">Account home</a>');
    return page('Sign out of central sign-in', `<p>This ends central session reuse. Existing application sessions are not revoked; sign out in each application too.</p>
      <form method="post" action="/auth/logout">
      <input type="hidden" name="csrf" value="${escape(central.csrf)}">
      ${clientId ? `<input type="hidden" name="client_id" value="${escape(clientId)}">` : ''}
      <button name="mode" value="central" disabled>Sign out of central sign-in</button>
      <button name="mode" value="microsoft" disabled>Also sign out of Microsoft in this browser</button>
      </form><p id="logout-error" role="alert"></p><noscript>JavaScript is required to securely submit sign-out through CloudFront.</noscript>
      <p><a href="/">Cancel</a></p><script src="/logout.js" defer></script>`);
  }

  async function logout(event, now) {
    if (event.headers?.origin !== SITE_URL) fail(403, 'invalid_origin');
    const params = body(event, 'application/x-www-form-urlencoded');
    onlyKeys(params, ['csrf', 'client_id', 'mode']);
    const clientId = logoutClient(params);
    const central = await session(event, now);
    if (!central || !same(params.csrf, central.csrf)) fail(403, 'invalid_csrf');
    const mode = params.mode || 'central';
    if (!['central', 'microsoft'].includes(mode)) fail(400, 'invalid_logout_mode');
    // Load configuration before mutation, so an unavailable configuration cannot leave a partial logout.
    const config = mode === 'microsoft' ? await loadConfig() : null;
    await store.remove(central.pk);
    const flowToken = cookies(event)[FLOW_COOKIE];
    if (TOKEN.test(flowToken || '')) await store.remove(keyFor('flow', flowToken));
    const target = config ?
      `${authority(config)}/oauth2/v2.0/logout?${new URLSearchParams({ post_logout_redirect_uri: `${SITE_URL}/` })}` :
      (clientId ? new URL(CLIENTS[clientId]).origin + '/' : '/');
    const result = json(200, { redirect_to: target });
    result.cookies = [cookie(SESSION_COOKIE, '', 0), clearFlow()];
    return result;
  }

  return async function handler(event) {
    try {
      const now = clock();
      const method = event.requestContext?.http?.method;
      const path = event.rawPath;
      if (event.headers?.['x-forwarded-proto'] && event.headers['x-forwarded-proto'] !== 'https') fail(400, 'https_required');
      if ((event.rawQueryString || '').length > 8192) fail(414, 'query_too_large');
      const params = uniqueParams(event.rawQueryString || '');
      if (method === 'POST' && ['/auth/exchange', '/auth/logout'].includes(path)) verifyPayloadHash(event);
      if (method === 'POST' && path === '/auth/exchange') return await exchange(event, now);
      if (method === 'POST' && path === '/auth/logout') return await logout(event, now);
      if (method !== 'GET') return response(405, '', { allow: 'GET, POST' });
      if (path === '/auth/authorize') {
        const continuation = authorizeParams(params);
        const central = await session(event, now);
        return central ? await handoff(continuation, central, now) : await start(continuation, now);
      }
      if (path === '/auth/callback') return await callback(event, params, now);
      if (path === '/auth/logout') return await logoutPage(event, params, now);
      if (path === '/auth/login') {
        onlyKeys(params, []);
        return await session(event, now) ? redirect('/') : await start(null, now);
      }
      if (path === '/style.css') return response(200,
        'body{font:18px/1.6 system-ui,sans-serif;max-width:42rem;margin:10vh auto;padding:0 1.5rem;color:#17233b;background:#f7f8fb}main{padding:2rem;background:white;border-radius:1rem}a{color:#1745a2}button{display:block;margin:1rem 0;padding:.6rem 1rem;font:inherit;cursor:pointer}h1{line-height:1.2}',
        { 'content-type': 'text/css; charset=utf-8' });
      if (path === '/logout.js') return response(200, logoutScript, { 'content-type': 'text/javascript; charset=utf-8' });
      if (path === '/') {
        const central = await session(event, now);
        return page('dliu.com sign-in', central ?
          `<p>Signed in as <strong>${escape(central.user.name)}</strong> (${escape(central.user.email)}).</p>
          <p>Central sign-in expires at ${escape(new Date(central.expiresAt * 1000).toISOString())}.</p>
          <p><a href="https://video.dliu.com/">Video</a> | <a href="https://files.dliu.com/">Files</a></p>
          <p><a href="/auth/logout">Sign out</a></p>` :
          '<p>Use your dliu.com Microsoft account. Microsoft manages your password and multifactor authentication.</p><p><a href="/auth/login">Sign in with Microsoft</a></p>');
      }
      return page('Not found', '<a href="/">Account home</a>', 404);
    } catch (error) {
      if (error instanceof HttpError) return json(error.status, { error: error.code });
      // Do not log request URLs, bodies, tokens, identity claims, or upstream error objects.
      logger.error({ message: 'Authentication service request failed' });
      return json(503, { error: 'service_unavailable' });
    }
  };
}
