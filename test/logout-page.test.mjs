import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import vm from 'node:vm';
import { logoutScript } from '../lambda/logout-page.js';
import { fixture, event } from './helpers.mjs';

test('logout UI explicitly submits hashed POST then navigates; it never triggers logout on load', async () => {
  let listener;
  const buttons = [{ disabled: true }, { disabled: true }];
  const error = { textContent: '' };
  const form = {
    querySelectorAll: () => buttons,
    addEventListener: (name, callback) => { assert.equal(name, 'submit'); listener = callback; },
  };
  const requests = [];
  const navigations = [];
  const context = {
    document: { querySelector: () => form, getElementById: () => error },
    FormData: class { *[Symbol.iterator]() { yield ['csrf', 'test-csrf']; yield ['client_id', 'files']; } },
    URLSearchParams, TextEncoder, Uint8Array, crypto: webcrypto,
    window: { location: { assign: (target) => navigations.push(target) } },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, json: async () => ({ redirect_to: 'https://files.dliu.com/' }) };
    },
  };
  vm.runInNewContext(logoutScript, context);
  assert.equal(requests.length, 0);
  assert(buttons.every((b) => !b.disabled));
  let prevented = false;
  await listener({ preventDefault: () => { prevented = true; }, submitter: { value: 'central' } });
  assert(prevented);
  assert.equal(requests.length, 1);
  const { url, options } = requests[0];
  assert.equal(url, '/auth/logout');
  assert.equal(options.method, 'POST');
  assert.equal(options.body, 'csrf=test-csrf&client_id=files&mode=central');
  assert.equal(options.headers['x-amz-content-sha256'], createHash('sha256').update(options.body).digest('hex'));
  assert.deepEqual(navigations, ['https://files.dliu.com/']);
  assert(buttons.every((b) => b.disabled));
});

test('logout script is same-origin CSP-compatible and confirmation works without inline execution', async () => {
  const f = fixture();
  await f.login();
  const page = await f.handler(event('/auth/logout', { cookieJar: f.cookieJar }));
  assert(page.body.includes('<script src="/logout.js" defer></script>'));
  assert(page.body.includes('JavaScript is required'));
  assert(!page.body.includes('onclick='));
  const script = await f.handler(event('/logout.js'));
  assert.equal(script.statusCode, 200);
  assert.equal(script.body, logoutScript);
});
