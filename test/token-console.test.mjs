import test from 'node:test';
import assert from 'node:assert/strict';
import {
  acquireToken, API_PERMISSIONS, createTokenDisplay,
  microsoftConfiguration, readConfiguration,
  formatTokenFile, TOKEN_FILE_NAME,
} from '../web/token-console.mjs';

const config = {
  configured: true,
  tenantId: '11111111-1111-4111-8111-111111111111',
  clientId: '22222222-2222-4222-8222-222222222222',
  audience: '33333333-3333-4333-8333-333333333333',
};
const result = () => ({
  accessToken: 'synthetic-access-token',
  idToken: 'synthetic-id-token-never-export',
  expiresOn: new Date(Date.now() + 3_600_000),
  scopes: ['video.read', 'video.write'],
});

test('configuration is fixed to a single tenant and registered origin, with no durable token cache', () => {
  const parsed = readConfiguration(config);
  assert.deepEqual(Object.keys(parsed), ['tenantId', 'clientId', 'audience']);
  const options = microsoftConfiguration(parsed, 'https://auth.dliu.com');
  assert.equal(options.auth.authority, `https://login.microsoftonline.com/${config.tenantId}`);
  assert.equal(options.auth.redirectUri, 'https://auth.dliu.com/redirect.html');
  assert.deepEqual(options.cache, { cacheLocation: 'memoryStorage', cacheRetentionDays: 0 });
  assert.equal(options.system.allowPlatformBroker, false);
  assert.equal(options.system.loggerOptions.piiLoggingEnabled, false);
  for (const value of [undefined, {}, { configured: false }, { ...config, clientId: 'invalid' }]) {
    assert.throws(() => readConfiguration(value), /setup is incomplete/);
  }
  for (const origin of ['https://evil.example', 'https://auth.dliu.com.evil.example', 'http://auth.dliu.com', 'https://auth.dliu.com/?x=1']) {
    assert.throws(() => microsoftConfiguration(parsed, origin), /registered HTTPS origin/);
  }
  assert.equal(microsoftConfiguration(parsed, 'http://localhost:4173').auth.redirectUri,
    'http://localhost:4173/redirect.html');
});

test('acquisition requests all explicit site scopes, disables token caching and exports only the access token', async () => {
  const calls = [];
  const client = {
    async acquireTokenPopup(request) { calls.push(request); return result(); },
    async clearCache() { calls.push('clear'); },
  };
  const obtained = await acquireToken(client, config);
  assert.deepEqual(API_PERMISSIONS, [
    'video.read', 'video.write', 'video.delete',
    'files.read', 'files.write', 'files.delete',
    'blog.read', 'blog.write', 'blog.delete',
    'trip.read', 'trip.write', 'trip.delete',
  ]);
  assert.equal(Object.isFrozen(API_PERMISSIONS), true);
  assert.equal(new Set(API_PERMISSIONS).size, API_PERMISSIONS.length);
  assert.deepEqual(calls, [{
    scopes: API_PERMISSIONS.map((scope) => `api://${config.audience}/${scope}`),
    prompt: 'select_account',
    storeInCache: { accessToken: false, idToken: false, refreshToken: false },
  }, 'clear']);
  assert.deepEqual(Object.keys(obtained), ['accessToken', 'expiresOn', 'scopes']);
  assert.deepEqual(obtained.scopes, ['video.read', 'video.write']);
  assert(!JSON.stringify(obtained).includes('synthetic-id-token'));
});

test('failed or unusable Microsoft responses always clear the cache and never return a token', async () => {
  for (const response of [
    { ...result(), accessToken: '' }, { ...result(), accessToken: 123 },
    { ...result(), expiresOn: new Date(0) },
    { ...result(), expiresOn: new Date(NaN) },
    { ...result(), scopes: [] }, null,
  ]) {
    let cleared = false;
    await assert.rejects(acquireToken({
      async acquireTokenPopup() { return response; },
      async clearCache() { cleared = true; },
    }, config));
    assert(cleared);
  }
  const error = new Error('synthetic authentication failure');
  let cleared = false;
  await assert.rejects(acquireToken({
    async acquireTokenPopup() { throw error; },
    async clearCache() { cleared = true; },
  }, config), (value) => value === error);
  assert(cleared);
});

test('cleanup failure fails closed', async () => {
  await assert.rejects(acquireToken({
    async acquireTokenPopup() { return result(); },
    async clearCache() { throw new Error('cleanup failed'); },
  }, config), /cleanup failed/);
});

test('the existing resource registration can also be the browser client without self .default requests', async () => {
  const combined = { ...config, clientId: config.audience };
  assert.equal(readConfiguration(combined).clientId, config.audience);
  const options = microsoftConfiguration(combined, 'https://auth.dliu.com');
  assert.equal(options.auth.clientId, config.audience);
  await acquireToken({
    async acquireTokenPopup(request) {
      assert.deepEqual(request.scopes, API_PERMISSIONS
        .map((scope) => `api://${config.audience}/${scope}`));
      return result();
    },
    async clearCache() {},
  }, combined);
});

function displayFixture() {
  let now = Date.now();
  let view;
  let reason;
  let callback;
  let delay;
  const display = createTokenDisplay({
    now: () => now,
    render(value, nextReason) { view = value; reason = nextReason; },
    schedule(fn, milliseconds) { callback = fn; delay = milliseconds; return 1; },
    cancel() { callback = undefined; },
  });
  return {
    display, view: () => view, reason: () => reason,
    delay: () => delay, expire: () => { now += delay; callback(); },
    advance(milliseconds) { now += milliseconds; },
  };
}

test('complete token-file copying can be repeated and retains the token, including failed writes', async () => {
  for (const failure of [false, true]) {
    const f = displayFixture();
    const original = result();
    f.display.show(original);
    const copying = f.display.copyFile(async (value) => {
      assert.equal(value, formatTokenFile(original));
      assert.equal(f.view().accessToken, 'synthetic-access-token');
      if (failure) throw new Error('clipboard denied');
    });
    if (failure) await assert.rejects(copying, /clipboard denied/);
    else await copying;
    let copied;
    await f.display.copyFile(async (value) => { copied = value; });
    assert.equal(copied, formatTokenFile(original));
    assert.equal(f.view().accessToken, original.accessToken);
  }
});

test('copying the token file repeats the same complete format as saving', async () => {
  const f = displayFixture();
  const original = result();
  const expected = `token=${original.accessToken}\nexpires_at=${original.expiresOn.toISOString()}\n`;
  f.display.show(original);
  const copied = [];
  await f.display.copyFile(async (text) => { copied.push(text); });
  await f.display.copyFile(async (text) => { copied.push(text); });
  assert.deepEqual(copied, [expected, expected]);
  let saved;
  await f.display.save(async (value) => { saved = formatTokenFile(value); });
  assert.equal(saved, expected);
  assert.equal(f.view().accessToken, original.accessToken);
  await assert.rejects(f.display.copyFile(async () => {
    throw new Error('clipboard unavailable');
  }), /clipboard unavailable/);
  assert.equal(f.display.refresh(), true);
  f.expire();
  await assert.rejects(f.display.copyFile(() => assert.fail('expired file copy')), /no longer available/);
});

test('the browser token remains beyond one minute and clears at Microsoft expiry', async () => {
  const f = displayFixture();
  const token = result();
  f.display.show(token);
  assert(f.delay() >= 3_599_000);
  assert.equal(f.view().expiresOn, token.expiresOn);
  f.advance(60_001);
  assert.equal(f.display.refresh(), true);
  f.advance(f.delay() - 60_001);
  f.display.refresh();
  assert.equal(f.view(), null);
  assert.equal(f.reason(), 'expired');
  await assert.rejects(f.display.copyFile(() => assert.fail('expired display')), /no longer available/);
});

test('actual Microsoft expiry limits display and copy even when the timer has not run', async () => {
  const f = displayFixture();
  f.display.show({ ...result(), expiresOn: new Date(Date.now() + 500) });
  assert(f.delay() <= 500);
  f.advance(501);
  await assert.rejects(f.display.copyFile(() => assert.fail('expired token')), /no longer available/);
  assert.equal(f.view(), null);
  assert.throws(() => f.display.show({ ...result(), expiresOn: new Date(NaN) }), /invalid/);
  assert.equal(f.view(), null);
});

test('explicit clear/navigation removes the token and prevents later copying', async () => {
  const f = displayFixture();
  f.display.show(result());
  f.display.clear();
  assert.equal(f.view(), null);
  assert.equal(f.reason(), 'cleared');
  await assert.rejects(f.display.copyFile(() => assert.fail('hidden token')), /no longer available/);
});

test('token file contains only the access token and actual UTC expiry', () => {
  const value = { ...result(), expiresOn: new Date('2030-01-02T03:04:05Z') };
  assert.equal(TOKEN_FILE_NAME, '.dliu_token');
  assert.equal(formatTokenFile(value),
    'token=synthetic-access-token\nexpires_at=2030-01-02T03:04:05.000Z\n');
  assert(!formatTokenFile(value).includes('synthetic-id-token'));
  for (const invalid of [
    { ...value, accessToken: '' }, { ...value, accessToken: 'token\nanother=value' },
    { ...value, expiresOn: new Date(NaN) },
  ]) assert.throws(() => formatTokenFile(invalid), /invalid/);
});

test('saving can be repeated and retains the token, including cancellation or failure', async () => {
  for (const failure of [false, true]) {
    const f = displayFixture();
    const original = result();
    let snapshot;
    f.display.show(original);
    const saving = f.display.save(async (value, signal) => {
      snapshot = value;
      assert.equal(f.view().accessToken, original.accessToken);
      assert.equal(value.accessToken, original.accessToken);
      assert.equal(value.expiresOn.getTime(), original.expiresOn.getTime());
      assert.equal(signal.aborted, false);
      if (failure) throw new Error('file denied');
      return 'saved';
    });
    if (failure) await assert.rejects(saving, /file denied/);
    else assert.equal(await saving, 'saved');
    assert.equal(snapshot.accessToken, '');
    let saved;
    await f.display.save(async (value) => { saved = formatTokenFile(value); });
    assert.equal(saved, formatTokenFile(original));
    let copied;
    await f.display.copyFile(async (value) => { copied = value; });
    assert.equal(copied, formatTokenFile(original));
    assert.equal(f.view().accessToken, original.accessToken);
  }
});

test('a copied token can be saved, but an expired token cannot', async () => {
  const copied = displayFixture();
  copied.display.show(result());
  await copied.display.copyFile(async () => {});
  await copied.display.save(async (value) => {
    assert.equal(value.accessToken, 'synthetic-access-token');
  });
  const expired = displayFixture();
  expired.display.show(result());
  expired.advance(expired.delay());
  await assert.rejects(expired.display.save(() => assert.fail('expired display')), /no longer available/);
});

test('clear/navigation cancels a pending export and removes its temporary token snapshot', async () => {
  const f = displayFixture();
  let resume;
  let snapshot;
  let signal;
  f.display.show(result());
  const saving = f.display.save(async (value, abortSignal) => {
    snapshot = value;
    signal = abortSignal;
    await new Promise((resolve) => { resume = resolve; });
    if (signal.aborted) throw new DOMException('Cancelled.', 'AbortError');
    assert.fail('a cancelled save must not write');
  });
  f.display.clear();
  assert.equal(signal.aborted, true);
  assert.equal(snapshot.accessToken, '');
  resume();
  await assert.rejects(saving, { name: 'AbortError' });
});
