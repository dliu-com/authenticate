import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { generateKeyPair, SignJWT } from 'jose';
import { createBroker, SESSION_COOKIE, FLOW_COOKIE } from '../lambda/broker.js';
import { exchangeMicrosoftCode } from '../lambda/entra.js';
import { digest, keyFor } from '../lambda/store.js';

export const config = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  clientId: '22222222-2222-4222-8222-222222222222',
  clientSecret: 'test-only-not-a-real-secret',
};
export const oid = '33333333-3333-4333-8333-333333333333';
export const NOW = 1_800_000_000;
export const { publicKey, privateKey } = await generateKeyPair('RS256');
export const verifier = 'v'.repeat(43);
export const state = 's'.repeat(43);
export const authParams = (clientId = 'video') => ({
  client_id: clientId, redirect_uri: `https://${clientId}.dliu.com/auth/callback`,
  state, code_challenge: digest(verifier), code_challenge_method: 'S256',
});

export async function idToken(nonce, overrides = {}, signingKey = privateKey) {
  return new SignJWT({
    iss: `https://login.microsoftonline.com/${config.tenantId}/v2.0`,
    aud: config.clientId, sub: 'microsoft-pairwise-subject',
    exp: NOW + 3600, iat: NOW, nbf: NOW - 1, nonce, tid: config.tenantId, oid,
    ver: '2.0', preferred_username: 'user@dliu.com', name: 'Test User',
    ...overrides,
  }).setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).sign(signingKey);
}

export class MemoryStore {
  items = new Map();
  get(pk, now) {
    const item = this.items.get(pk);
    return Promise.resolve(item?.expiresAt > now ? structuredClone(item) : null);
  }
  async put(item) {
    assert(!this.items.has(item.pk));
    this.items.set(item.pk, structuredClone(item));
  }
  async take(pk, now) {
    const item = this.items.get(pk);
    if (!item || item.expiresAt <= now) return null;
    this.items.delete(pk);
    return structuredClone(item);
  }
  async remove(pk) { this.items.delete(pk); }
  live(pk, now) {
    const item = this.items.get(pk);
    return item?.kind === 'session' && item.expiresAt > now;
  }
  async issueCode(item, now) {
    if (!this.live(item.sessionPk, now)) return false;
    await this.put(item);
    return true;
  }
  async redeemCode(item, now) {
    const current = this.items.get(item.pk);
    if (!this.live(item.sessionPk, now) || !current || current.expiresAt <= now ||
        ['kind', 'clientId', 'redirectUri', 'challenge', 'sessionPk'].some((key) => current[key] !== item[key])) return false;
    this.items.delete(item.pk);
    return true;
  }
}

export function event(path, { method = 'GET', query = {}, cookieJar = {}, data, headers = {} } = {}) {
  const body = data === undefined ? undefined : typeof data === 'string' ? data : JSON.stringify(data);
  return {
    rawPath: path, rawQueryString: new URLSearchParams(query).toString(),
    requestContext: { http: { method, protocol: 'HTTP/1.1' } },
    headers: {
      'x-forwarded-proto': 'https',
      ...(method === 'POST' ? { 'x-amz-content-sha256': createHash('sha256').update(body || '').digest('hex') } : {}),
      ...headers,
    },
    cookies: Object.entries(cookieJar).map(([name, value]) => `${name}=${value}`),
    ...(body === undefined ? {} : { body }),
  };
}

export function fixture({ claims = {}, microsoftExchange, store = new MemoryStore() } = {}) {
  let now = NOW;
  const calls = [];
  const logs = [];
  const handler = createBroker({
    store, loadConfig: async () => config, clock: () => now,
    logger: { warn: (entry) => logs.push(entry), error: (entry) => logs.push(entry) },
    microsoftExchange: microsoftExchange || (async (code, transaction, settings, seconds) =>
      exchangeMicrosoftCode(code, transaction, settings, seconds, async (url, options) => {
        calls.push({ url, options });
        return { ok: true, json: async () => ({ id_token: await idToken(transaction.nonce, claims) }) };
      }, publicKey)),
  });
  const cookieJar = {};
  function applyCookies(result) {
    for (const value of result.cookies || []) {
      const [pair] = value.split(';');
      const index = pair.indexOf('=');
      if (value.includes('Max-Age=0;')) delete cookieJar[pair.slice(0, index)];
      else cookieJar[pair.slice(0, index)] = pair.slice(index + 1);
    }
    return result;
  }
  async function begin(params = authParams()) {
    return applyCookies(await handler(event('/auth/authorize', { query: params, cookieJar })));
  }
  async function finish(start) {
    const msState = new URL(start.headers.location).searchParams.get('state');
    return applyCookies(await handler(event('/auth/callback', {
      query: { state: msState, code: 'microsoft-code' }, cookieJar,
    })));
  }
  async function login(params = authParams()) {
    const start = await begin(params);
    assert.equal(start.statusCode, 303);
    const result = await finish(start);
    assert.equal(result.statusCode, 303, result.body);
    return result;
  }
  function redeem(code, overrides = {}) {
    return handler(event('/auth/exchange', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      data: { code, client_id: 'video', redirect_uri: authParams().redirect_uri, code_verifier: verifier, ...overrides },
    }));
  }
  return {
    handler, store, calls, logs, cookieJar, begin, finish, login, redeem, applyCookies,
    setTime: (value) => { now = value; },
    session: () => store.items.get(keyFor('session', cookieJar[SESSION_COOKIE])),
    flow: () => store.items.get(keyFor('flow', cookieJar[FLOW_COOKIE])),
  };
}
