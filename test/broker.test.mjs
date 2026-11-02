import test from 'node:test';
import assert from 'node:assert/strict';
import { createBroker, SESSION_COOKIE, FLOW_COOKIE, SESSION_SECONDS } from '../lambda/broker.js';
import { digest, keyFor } from '../lambda/store.js';
import { NOW, config, oid, fixture, event, authParams, verifier } from './helpers.mjs';

const codeFrom = (result) => new URL(result.headers.location).searchParams.get('code');

test('authorize accepts only exact registered clients, redirects, random state and S256', async () => {
  const f = fixture();
  for (const override of [
    { client_id: 'blog' }, { client_id: '__proto__' }, { client_id: 'constructor' },
    { redirect_uri: 'https://video.dliu.com/auth/callback/' },
    { redirect_uri: 'https://video.dliu.com.evil.example/auth/callback' },
    { redirect_uri: 'https://video.dliu.com/auth/callback?next=evil' },
    { redirect_uri: 'http://video.dliu.com/auth/callback' },
    { redirect_uri: 'https://files.dliu.com/auth/callback' },
    { state: 'short' }, { state: 'x'.repeat(129) },
    { code_challenge_method: 'plain' }, { code_challenge: 'bad' },
    { extra: 'unexpected' },
  ]) {
    const result = await f.begin({ ...authParams(), ...override });
    assert.equal(result.statusCode, 400, JSON.stringify(override));
    assert.equal(result.headers.location, undefined);
  }
  assert.equal(f.store.items.size, 0);
  const duplicate = event('/auth/authorize', { query: authParams() });
  duplicate.rawQueryString += '&client_id=files';
  assert.equal((await f.handler(duplicate)).statusCode, 400);
});

test('Microsoft redirect has server-side nonce, state and PKCE without forced prompt', async () => {
  const f = fixture();
  const start = await f.begin();
  const url = new URL(start.headers.location);
  const flow = f.flow();
  assert.equal(url.origin, 'https://login.microsoftonline.com');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://auth.dliu.com/auth/callback');
  assert.equal(url.searchParams.get('nonce'), flow.nonce);
  assert.equal(url.searchParams.get('state'), flow.state);
  assert.equal(url.searchParams.get('code_challenge'), digest(flow.verifier));
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('prompt'), null);
  assert(!start.headers.location.includes(config.clientSecret));
  assert.equal(start.cookies.length, 1);
  assert.match(start.cookies[0], /^__Host-auth_flow=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=600; Secure; HttpOnly; SameSite=Lax$/);
  assert(!flow.pk.includes(f.cookieJar[FLOW_COOKIE]));
});

test('callback verifies browser-bound state before token exchange and atomically consumes flow', async () => {
  const f = fixture();
  const start = await f.begin();
  const state = new URL(start.headers.location).searchParams.get('state');
  for (const options of [
    { query: { state, code: 'code' } },
    { query: { state: 'wrong', code: 'code' }, cookieJar: f.cookieJar },
    { query: { code: 'code' }, cookieJar: f.cookieJar },
  ]) assert.equal((await f.handler(event('/auth/callback', options))).statusCode, 400);
  assert.equal(f.calls.length, 0);
  const callback = event('/auth/callback', { query: { state, code: 'code' }, cookieJar: f.cookieJar });
  const results = await Promise.all([f.handler(callback), f.handler(callback)]);
  assert.deepEqual(results.map((r) => r.statusCode).sort(), [303, 400]);
  assert.equal(f.calls.length, 1);
  const tokenBody = new URLSearchParams(f.calls[0].options.body);
  assert.equal(tokenBody.get('client_secret'), config.clientSecret);
  assert.equal(tokenBody.get('redirect_uri'), 'https://auth.dliu.com/auth/callback');
  assert.match(tokenBody.get('code_verifier'), /^[A-Za-z0-9_-]{43}$/);
});

test('expired login transactions and Microsoft denial cannot establish sessions', async () => {
  const f = fixture();
  let start = await f.begin();
  f.setTime(NOW + 600);
  assert.equal((await f.finish(start)).statusCode, 400);
  assert.equal(f.calls.length, 0);
  f.setTime(NOW);
  start = await f.begin();
  const result = await f.handler(event('/auth/callback', {
    query: { state: new URL(start.headers.location).searchParams.get('state'), error: 'access_denied', error_description: '<script>evil</script>' },
    cookieJar: f.cookieJar,
  }));
  assert.equal(result.statusCode, 401);
  assert(!result.body.includes('<script>evil'));
  assert.equal(f.calls.length, 0);
  assert(![...f.store.items.values()].some((item) => item.kind === 'session'));
});

test('validated callback issues host-only opaque session and minimal backchannel identity', async () => {
  const f = fixture();
  const result = await f.login();
  const url = new URL(result.headers.location);
  assert.equal(url.origin + url.pathname, authParams().redirect_uri);
  assert.equal(url.searchParams.get('state'), authParams().state);
  assert.deepEqual([...url.searchParams.keys()].sort(), ['code', 'state']);
  assert.match(result.cookies[1], /^__Host-auth_session=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=43200; Secure; HttpOnly; SameSite=Lax$/);
  assert(!result.cookies.some((c) => c.includes('Domain=')));
  assert.equal(f.cookieJar[FLOW_COOKIE], undefined);
  const exchange = await f.redeem(codeFrom(result));
  assert.equal(exchange.statusCode, 200);
  assert.deepEqual(JSON.parse(exchange.body), {
    user: {
      sub: `${config.tenantId}:${oid}`, tenant_id: config.tenantId, oid,
      email: 'user@dliu.com', name: 'Test User',
    },
    session_expires_at: NOW + SESSION_SECONDS,
  });
  assert.deepEqual(exchange.cookies, []);
  assert.equal(exchange.headers['access-control-allow-origin'], undefined);
  assert.equal(exchange.headers['cache-control'], 'no-store');
  assert(!exchange.body.includes(config.clientSecret));
  assert(!exchange.body.includes(f.cookieJar[SESSION_COOKIE]));
});

test('wrong verifier/client/redirect never redeems code; successful code is single-use under concurrency', async () => {
  const f = fixture();
  const code = codeFrom(await f.login());
  for (const overrides of [
    { code_verifier: 'x'.repeat(43) },
    { code_verifier: 'short' },
    { client_id: 'files', redirect_uri: authParams('files').redirect_uri },
    { redirect_uri: authParams('files').redirect_uri },
  ]) assert.equal((await f.redeem(code, overrides)).statusCode, 400);
  const results = await Promise.all([f.redeem(code), f.redeem(code), f.redeem(code)]);
  assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 400, 400]);
  assert.equal((await f.redeem(code)).statusCode, 400);
});

test('explicit expiry applies even while TTL records remain, and handoffs require a live central session', async () => {
  const f = fixture();
  let code = codeFrom(await f.login());
  f.setTime(NOW + 60);
  assert(f.store.items.has(keyFor('code', code)));
  assert.equal((await f.redeem(code)).statusCode, 400);
  f.setTime(NOW + 100);
  code = codeFrom(await f.begin());
  await f.store.remove(f.session().pk);
  assert.equal((await f.redeem(code)).statusCode, 400);
  assert(f.store.items.has(keyFor('code', code)));
});

test('session reuse serves both apps with no Microsoft round trip or sliding lifetime', async () => {
  const f = fixture();
  await f.login();
  const firstExpiry = f.session().expiresAt;
  const sessionCookie = f.cookieJar[SESSION_COOKIE];
  f.setTime(NOW + 100);
  const files = await f.begin(authParams('files'));
  assert.equal(new URL(files.headers.location).origin, 'https://files.dliu.com');
  const result = await f.redeem(codeFrom(files), {
    client_id: 'files', redirect_uri: authParams('files').redirect_uri,
  });
  assert.equal(result.statusCode, 200);
  assert.equal(JSON.parse(result.body).session_expires_at, firstExpiry);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(files.cookies, []);
  assert.equal(f.cookieJar[SESSION_COOKIE], sessionCookie);
  f.setTime(firstExpiry - 1);
  const nearExpiry = await f.begin();
  const code = codeFrom(nearExpiry);
  assert.equal(f.store.items.get(keyFor('code', code)).expiresAt, firstExpiry);
  f.setTime(firstExpiry);
  assert.equal((await f.redeem(code)).statusCode, 400);
  const expired = await f.begin();
  assert.equal(new URL(expired.headers.location).origin, 'https://login.microsoftonline.com');
});

test('GET logout only confirms; POST requires exact origin, csrf and an active session', async () => {
  const f = fixture();
  const code = codeFrom(await f.login());
  const pk = f.session().pk;
  const page = await f.handler(event('/auth/logout', { query: { client_id: 'video' }, cookieJar: f.cookieJar }));
  assert.equal(page.statusCode, 200);
  assert(page.body.includes(f.session().csrf));
  assert(f.store.items.has(pk));
  const data = new URLSearchParams({ csrf: f.session().csrf, client_id: 'video', mode: 'central' }).toString();
  for (const origin of [undefined, 'https://video.dliu.com', 'https://auth.dliu.com.evil.example', 'null']) {
    const bad = await f.handler(event('/auth/logout', {
      method: 'POST', cookieJar: f.cookieJar, data,
      headers: { 'content-type': 'application/x-www-form-urlencoded', ...(origin ? { origin } : {}) },
    }));
    assert.equal(bad.statusCode, 403);
  }
  const badCsrf = await f.handler(event('/auth/logout', {
    method: 'POST', cookieJar: f.cookieJar, data: 'csrf=wrong',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://auth.dliu.com' },
  }));
  assert.equal(badCsrf.statusCode, 403);
  const request = event('/auth/logout', {
    method: 'POST', cookieJar: f.cookieJar, data,
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://auth.dliu.com' },
  });
  const good = await f.handler(request);
  assert.equal(good.statusCode, 200);
  assert.equal(JSON.parse(good.body).redirect_to, 'https://video.dliu.com/');
  assert(good.cookies.every((c) => c.includes('Max-Age=0;')));
  assert(!f.store.items.has(pk));
  assert.equal((await f.redeem(code)).statusCode, 400);
  assert.equal((await f.handler(request)).statusCode, 403);
  const next = await f.begin();
  assert.equal(new URL(next.headers.location).origin, 'https://login.microsoftonline.com');
});

test('Microsoft sign-out is explicit, clears broker session first, with fixed post-logout URI', async () => {
  const f = fixture();
  await f.login();
  const result = await f.handler(event('/auth/logout', {
    method: 'POST', cookieJar: f.cookieJar,
    data: new URLSearchParams({ csrf: f.session().csrf, mode: 'microsoft' }).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://auth.dliu.com' },
  }));
  assert.equal(result.statusCode, 200);
  const target = new URL(JSON.parse(result.body).redirect_to);
  assert.equal(target.origin, 'https://login.microsoftonline.com');
  assert.equal(target.pathname, `/${config.tenantId}/oauth2/v2.0/logout`);
  assert.equal(target.searchParams.get('post_logout_redirect_uri'), 'https://auth.dliu.com/');
  assert.equal(f.session(), undefined);
});

test('account pages escape identity and name fallback is nonnullable', async () => {
  const f = fixture({ claims: { name: '<img src=x onerror=alert(1)>' } });
  await f.login();
  const home = await f.handler(event('/', { cookieJar: f.cookieJar }));
  assert(home.body.includes('&lt;img'));
  assert(!home.body.includes('<img'));
  assert(home.headers['content-security-policy'].includes("frame-ancestors 'none'"));
  const fallback = fixture({ claims: { name: '   ', preferred_username: 'USER@DLIU.COM' } });
  const result = await fallback.redeem(codeFrom(await fallback.login()));
  assert.equal(JSON.parse(result.body).user.name, 'USER@DLIU.COM');
  assert.equal(JSON.parse(result.body).user.email, 'user@dliu.com');
});

test('central-only login returns account home; later login reuses session', async () => {
  const f = fixture();
  const start = f.applyCookies(await f.handler(event('/auth/login')));
  const result = await f.finish(start);
  assert.equal(result.headers.location, '/');
  const again = await f.handler(event('/auth/login', { cookieJar: f.cookieJar }));
  assert.equal(again.headers.location, '/');
  assert.equal(f.calls.length, 1);
});

test('exchange rejects browser, HTTP, malformed and oversized requests without CORS', async () => {
  const f = fixture();
  const code = codeFrom(await f.login());
  const good = { code, client_id: 'video', redirect_uri: authParams().redirect_uri, code_verifier: verifier };
  for (const [headers, data, status] of [
    [{ origin: 'https://video.dliu.com', 'content-type': 'application/json' }, good, 403],
    [{ 'sec-fetch-site': 'same-site', 'content-type': 'application/json' }, good, 403],
    [{ 'content-type': 'text/plain' }, good, 415],
    [{ 'content-type': 'application/json' }, '{invalid', 400],
    [{ 'content-type': 'application/json' }, '[]', 400],
    [{ 'content-type': 'application/json' }, 'x'.repeat(9000), 413],
    [{ 'content-type': 'application/json' }, { ...good, unexpected: true }, 400],
    [{ 'content-type': 'application/json' }, { ...good, code_verifier: [verifier] }, 400],
    [{ 'content-type': 'application/json', 'x-amz-content-sha256': undefined }, good, 400],
    [{ 'content-type': 'application/json', 'x-amz-content-sha256': '0'.repeat(64) }, good, 400],
    [{ 'content-type': 'application/json', 'x-forwarded-proto': 'http' }, good, 400],
  ]) {
    const result = await f.handler(event('/auth/exchange', { method: 'POST', headers, data }));
    assert.equal(result.statusCode, status);
    assert.equal(result.headers['access-control-allow-origin'], undefined);
  }
  const preflight = await f.handler(event('/auth/exchange', { method: 'OPTIONS' }));
  assert.equal(preflight.statusCode, 405);
  assert.equal((await f.redeem(code)).statusCode, 200);
});

test('storage/config failures fail closed with sanitized logs and service unavailable', async () => {
  const logs = [];
  const broker = createBroker({
    store: { get: async () => { throw new Error('sensitive database failure'); } },
    loadConfig: async () => { throw new Error(config.clientSecret); },
    logger: { error: (message) => logs.push(message) },
  });
  const result = await broker(event('/auth/authorize', { query: authParams() }));
  assert.equal(result.statusCode, 503);
  assert.equal(result.body, '{"error":"service_unavailable"}');
  assert.equal(JSON.stringify(logs), '[{"message":"Authentication service request failed"}]');
});

test('callback distinguishes rejected identity from an upstream outage and never creates a session on either', async () => {
  for (const claims of [
    { nonce: 'wrong' },
    { preferred_username: 'user@other.example' },
    { aud: 'wrong' },
  ]) {
    const f = fixture({ claims });
    const result = await f.finish(await f.begin());
    assert.equal(result.statusCode, 401);
    assert.equal(f.logs[0].message, 'Microsoft sign-in validation failed');
    assert(![...f.store.items.values()].some((item) => item.kind === 'session'));
  }
  const unavailable = fixture({ microsoftExchange: async () => { throw new Error('upstream confidential error'); } });
  const result = await unavailable.finish(await unavailable.begin());
  assert.equal(result.statusCode, 503);
  assert(!result.body.includes('confidential'));
  assert(![...unavailable.store.items.values()].some((item) => item.kind === 'session'));
});
