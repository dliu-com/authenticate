import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { API_PERMISSIONS } from '../web/token-console.mjs';

const { outputFiles } = await build({
  entryPoints: [new URL('../web/app.js', import.meta.url).pathname],
  bundle: true, write: false, format: 'esm', platform: 'browser',
  plugins: [{
    name: 'synthetic-microsoft-client',
    setup(builder) {
      builder.onResolve({ filter: /^@azure\/msal-browser$/ }, () => ({
        path: 'msal-test', namespace: 'test',
      }));
      builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({
        contents: 'export const PublicClientApplication = globalThis.testMicrosoftClient;',
      }));
    },
  }],
});

class Element {
  listeners = new Map();
  value = '';
  textContent = '';
  disabled = false;
  hidden = true;
  checked = true;
  addEventListener(name, handler) { this.listeners.set(name, handler); }
  async emit(name) { await this.listeners.get(name)?.(); }
  click() {}
  remove() { this.removed = true; }
}

let fixtureIndex = 0;
async function fixture(t, { configured = true, acquire, clipboard, saveFilePicker } = {}) {
  const elements = new Map([
    '#sign-in', '#copy-file', '#save', '#status', '#token-panel',
    '#token', '#expires',
  ].map((selector) => [selector, new Element()]));
  elements.get('#copy-file').disabled = true;
  elements.get('#save').disabled = true;
  const document = new Element();
  document.visibilityState = 'visible';
  document.querySelector = (selector) => elements.get(selector);
  const downloads = [];
  const objectUrls = [];
  const revokedUrls = [];
  document.body = { append(link) { downloads.push(link); } };
  document.createElement = () => new Element();
  const window = new Element();
  window.location = { origin: 'https://auth.dliu.com', pathname: '/' };
  window.history = { replaceState() {} };
  if (saveFilePicker) window.showSaveFilePicker = saveFilePicker;
  const NativeURL = globalThis.URL;
  let cacheClears = 0;
  let request;
  const networkRequests = [];
  const globals = {
    document, window,
    URL: class extends NativeURL {
      static createObjectURL(blob) {
        objectUrls.push(blob);
        return 'blob:synthetic-token-file';
      }
      static revokeObjectURL(url) { revokedUrls.push(url); }
    },
    navigator: { clipboard: { writeText: clipboard || (async () => {}) } },
    fetch: async (input, options) => {
      networkRequests.push({ input, options });
      return {
        ok: true,
        json: async () => ({
          configured,
          tenantId: '11111111-1111-4111-8111-111111111111',
          clientId: '22222222-2222-4222-8222-222222222222',
          audience: '33333333-3333-4333-8333-333333333333',
        }),
      };
    },
    testMicrosoftClient: class {
      async initialize() {}
      async clearCache() { cacheClears++; }
      async acquireTokenPopup(value) {
        request = value;
        if (acquire) return acquire();
        return {
          accessToken: 'synthetic-ui-token',
          expiresOn: new Date(Date.now() + 3_600_000),
          scopes: ['video.read', 'video.write'],
        };
      }
    },
  };
  const descriptors = new Map(Object.keys(globals).map((key) => [
    key, Object.getOwnPropertyDescriptor(globalThis, key),
  ]));
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  t.after(async () => {
    await window.emit('pagehide');
    await new Promise((resolve) => setTimeout(resolve, 0));
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}#${fixtureIndex++}`);
  await new Promise(setImmediate);
  return {
    element: (id) => elements.get(`#${id}`),
    document, window,
    cacheClears: () => cacheClears,
    request: () => request,
    downloads, objectUrls, revokedUrls, networkRequests,
  };
}

test('simple UI retains the browser token for repeat copying and saving while clearing the SDK cache', async (t) => {
  const written = [];
  const expiresOn = new Date(Date.now() + 3_600_000);
  const f = await fixture(t, {
    clipboard: async (value) => { written.push(value); },
    acquire: async () => ({
      accessToken: 'synthetic-ui-token', expiresOn, scopes: ['video.read', 'video.write'],
    }),
  });
  assert.equal(f.element('sign-in').disabled, false);
  assert.equal(f.element('status').textContent, 'Ready to sign in.');
  await f.element('sign-in').emit('click');
  assert.equal(f.cacheClears(), 2);
  assert.equal(f.element('token').value, 'synthetic-ui-token');
  assert.equal(f.element('token-panel').hidden, false);
  assert.equal(f.element('expires').textContent, expiresOn.toLocaleString());
  assert.equal(f.element('granted-scopes'), undefined);
  assert.deepEqual(f.request().scopes, API_PERMISSIONS
    .map((scope) => `api://33333333-3333-4333-8333-333333333333/${scope}`));
  assert.deepEqual(f.request().storeInCache, { accessToken: false, idToken: false, refreshToken: false });
  await f.element('copy-file').emit('click');
  await f.element('copy-file').emit('click');
  const record = `token=synthetic-ui-token\nexpires_at=${expiresOn.toISOString()}\n`;
  assert.deepEqual(written, [record, record]);
  assert.equal(f.element('token').value, 'synthetic-ui-token');
  assert.equal(f.element('token-panel').hidden, false);
  assert.equal(f.element('copy-file').disabled, false);
  assert.equal(f.element('save').disabled, false);
  await f.element('save').emit('click');
  assert.equal(f.element('token').value, 'synthetic-ui-token');
  await f.element('copy-file').emit('click');
  assert.equal(written.length, 3);
  assert.deepEqual(f.networkRequests, [{
    input: '/config.json', options: { cache: 'no-store', credentials: 'omit' },
  }]);
});

test('Copy token file copies token and UTC expiry without extra actions or credential uploads', async (t) => {
  const written = [];
  const expiresOn = new Date(Date.now() + 3_600_000);
  const f = await fixture(t, {
    clipboard: async (text) => { written.push(text); },
    acquire: async () => ({ accessToken: 'synthetic-complete-file', expiresOn, scopes: ['video.read'] }),
  });
  assert.equal(f.element('copy-file').disabled, true);
  await f.element('sign-in').emit('click');
  await f.element('copy-file').emit('click');
  await f.element('copy-file').emit('click');
  const record = `token=synthetic-complete-file\nexpires_at=${expiresOn.toISOString()}\n`;
  assert.deepEqual(written, [record, record]);
  assert.match(f.element('status').textContent, /token and UTC expiry/);
  assert.equal(f.element('copy'), undefined);
  assert.equal(f.element('clear'), undefined);
  assert.equal(f.element('token').value, 'synthetic-complete-file');
  assert.equal(f.element('copy-file').disabled, false);
  assert.equal(f.element('save').disabled, false);
  assert.deepEqual(f.networkRequests, [{
    input: '/config.json', options: { cache: 'no-store', credentials: 'omit' },
  }]);
  await f.window.emit('pagehide');
  assert.equal(f.element('copy-file').disabled, true);
  assert.equal(f.element('token').value, '');
});

test('failed token-file copying keeps the token and reports only a safe retry message', async (t) => {
  let attempts = 0;
  const f = await fixture(t, {
    clipboard: async () => {
      if (++attempts === 1) throw new Error('SENSITIVE-COPY-FILE-DIAGNOSTIC');
    },
  });
  await f.element('sign-in').emit('click');
  await f.element('copy-file').emit('click');
  assert.match(f.element('status').textContent, /token file could not be copied/);
  assert(!f.element('status').textContent.includes('SENSITIVE-COPY-FILE-DIAGNOSTIC'));
  assert.equal(f.element('token').value, 'synthetic-ui-token');
  assert.equal(f.element('copy-file').disabled, false);
  await f.element('copy-file').emit('click');
  assert.equal(attempts, 2);
  assert.match(f.element('status').textContent, /Token file copied/);
});

test('a pending token-file clipboard write cannot replace a newer sign-in status', async (t) => {
  let finish;
  let attempts = 0;
  const f = await fixture(t, {
    clipboard: () => new Promise((resolve) => { finish = resolve; }),
    acquire: async () => ({
      accessToken: `synthetic-copy-file-${++attempts}`,
      expiresOn: new Date(Date.now() + 3_600_000), scopes: ['video.read'],
    }),
  });
  await f.element('sign-in').emit('click');
  const copying = f.element('copy-file').emit('click');
  assert.equal(f.element('copy-file').disabled, true);
  assert.equal(f.element('save').disabled, true);
  await f.element('sign-in').emit('click');
  finish();
  await copying;
  assert.equal(f.element('token').value, 'synthetic-copy-file-2');
  assert.equal(f.element('status').textContent, 'Your token is ready.');
  assert.equal(f.element('copy-file').disabled, false);
});

test('UI retains a displayed token across tab switches', async (t) => {
  const f = await fixture(t);
  await f.element('sign-in').emit('click');
  f.document.visibilityState = 'hidden';
  await f.document.emit('visibilitychange');
  assert.equal(f.element('token').value, 'synthetic-ui-token');
  f.document.visibilityState = 'visible';
  await f.document.emit('visibilitychange');
  assert.equal(f.element('token').value, 'synthetic-ui-token');
  assert.equal(f.element('copy-file').disabled, false);
});

test('UI discards sign-in responses when the page navigated away', async (t) => {
  const f = await fixture(t, {
    acquire: async () => {
      await f.window.emit('pagehide');
      return {
        accessToken: 'synthetic-must-discard',
        expiresOn: new Date(Date.now() + 3_600_000), scopes: ['video.read'],
      };
    },
  });
  await f.element('sign-in').emit('click');
  assert.equal(f.element('token').value, '');
  assert.equal(f.element('token-panel').hidden, true);
});

test('UI reports sign-in and clipboard failures without reflecting raw diagnostics', async (t) => {
  const f = await fixture(t, { clipboard: async () => { throw new Error('SENSITIVE-DIAGNOSTIC'); } });
  await f.element('sign-in').emit('click');
  await f.element('copy-file').emit('click');
  assert.equal(f.element('token').value, 'synthetic-ui-token');
  assert(!f.element('status').textContent.includes('SENSITIVE-DIAGNOSTIC'));
  assert.match(f.element('status').textContent, /could not be copied/);
});

test('unconfigured UI disables sign-in instead of using a fallback client or tenant', async (t) => {
  const f = await fixture(t, { configured: false });
  assert.equal(f.element('sign-in').disabled, true);
  assert.match(f.element('status').textContent, /Sign-in is unavailable/);
  assert.equal(f.element('token').value, '');
});

test('simple UI reports sign-in failure without exposing raw diagnostics', async (t) => {
  const f = await fixture(t, {
    acquire: async () => { throw new Error('SENSITIVE-SIGN-IN-DIAGNOSTIC'); },
  });
  await f.element('sign-in').emit('click');
  assert.equal(f.element('token').value, '');
  assert.equal(f.element('token-panel').hidden, true);
  assert.equal(f.element('sign-in').disabled, false);
  assert.match(f.element('status').textContent, /Sign-in did not finish/);
  assert(!f.element('status').textContent.includes('SENSITIVE-SIGN-IN-DIAGNOSTIC'));
});

test('Save file opens the native prompt synchronously and writes token plus actual expiry', async (t) => {
  const expiresOn = new Date(Date.now() + 3_600_000);
  let content;
  let closed = false;
  let prompted = false;
  let f;
  f = await fixture(t, {
    acquire: async () => ({
      accessToken: 'synthetic-file-token', expiresOn, scopes: ['video.read'],
      idToken: 'synthetic-must-not-save-id-token',
    }),
    saveFilePicker: async (options) => {
      prompted = true;
      assert.deepEqual(options, { suggestedName: '.dliu_token' });
      assert.equal(f.element('token').value, 'synthetic-file-token');
      assert.equal(f.element('save').disabled, true);
      return {
        name: '.dliu_token',
        async createWritable() {
          return {
            async write(value) { content = value; },
            async close() { closed = true; },
            async abort() { assert.fail('successful save must not abort'); },
          };
        },
      };
    },
  });
  assert.equal(f.element('save').textContent, 'Save file');
  assert.equal(f.element('save').disabled, true);
  await f.element('sign-in').emit('click');
  assert.equal(f.element('save').disabled, false);
  const saving = f.element('save').emit('click');
  assert.equal(prompted, true);
  await saving;
  assert.equal(content, `token=synthetic-file-token\nexpires_at=${expiresOn.toISOString()}\n`);
  assert.equal(closed, true);
  assert.equal(f.element('copy-file').disabled, false);
  assert.equal(f.element('save').disabled, false);
  assert.equal(f.element('token').value, 'synthetic-file-token');
  assert.match(f.element('status').textContent, /^Saved\./);
});

test('Chrome stripping the suggested leading dot is surfaced without discarding the complete saved token', async (t) => {
  let written;
  const expiresOn = new Date(Date.now() + 3_600_000);
  const f = await fixture(t, {
    acquire: async () => ({
      accessToken: 'synthetic-dotless-filename', expiresOn, scopes: ['video.read'],
    }),
    saveFilePicker: async (options) => {
      assert.equal(options.suggestedName, '.dliu_token');
      return {
        name: 'dliu_token',
        async createWritable() {
          return {
            async write(text) { written = text; },
            async close() {},
            async abort() { assert.fail('successful save'); },
          };
        },
      };
    },
  });
  await f.element('sign-in').emit('click');
  await f.element('save').emit('click');
  assert.equal(written, `token=synthetic-dotless-filename\nexpires_at=${expiresOn.toISOString()}\n`);
  assert.match(f.element('status').textContent, /Rename the file to \.dliu_token, including the leading dot/);
  assert.equal(f.element('token').value, 'synthetic-dotless-filename');
  assert.equal(f.element('copy-file').disabled, false);
  assert.equal(f.element('save').disabled, false);
});

test('cancelling the native file prompt keeps the token without falling back to a download', async (t) => {
  const f = await fixture(t, {
    saveFilePicker: async () => { throw new DOMException('Cancelled.', 'AbortError'); },
  });
  await f.element('sign-in').emit('click');
  await f.element('save').emit('click');
  assert.equal(f.element('token').value, 'synthetic-ui-token');
  assert.equal(f.element('save').disabled, false);
  assert.equal(f.downloads.length, 0);
  assert.match(f.element('status').textContent, /Save cancelled/);
});

test('file-write failure aborts the stream and never reflects raw diagnostics', async (t) => {
  let aborted = false;
  const f = await fixture(t, {
    saveFilePicker: async () => ({
      async createWritable() {
        return {
          async write() { throw new Error('SENSITIVE-FILE-DIAGNOSTIC'); },
          async close() { assert.fail('failed write must not close'); },
          async abort() { aborted = true; },
        };
      },
    }),
  });
  await f.element('sign-in').emit('click');
  await f.element('save').emit('click');
  assert.equal(aborted, true);
  assert.equal(f.element('token').value, 'synthetic-ui-token');
  assert.match(f.element('status').textContent, /could not be saved/);
  assert(!f.element('status').textContent.includes('SENSITIVE-FILE-DIAGNOSTIC'));
});

test('switching tabs while choosing a file keeps the token and permits the requested save', async (t) => {
  let resolvePicker;
  let opened = false;
  let written;
  const f = await fixture(t, {
    saveFilePicker: () => new Promise((resolve) => { resolvePicker = resolve; }),
  });
  await f.element('sign-in').emit('click');
  const saving = f.element('save').emit('click');
  f.document.visibilityState = 'hidden';
  await f.document.emit('visibilitychange');
  resolvePicker({
    async createWritable() {
      opened = true;
      return {
        async write(value) { written = value; },
        async close() {},
        async abort() { assert.fail('tab switching does not cancel a save'); },
      };
    },
  });
  await saving;
  assert.equal(opened, true);
  assert(written.startsWith('token=synthetic-ui-token\n'));
  assert.equal(f.element('token').value, 'synthetic-ui-token');
  assert.equal(f.element('save').disabled, false);
});

test('unsupported browsers download the same two-field file and revoke the temporary URL', async (t) => {
  const expiresOn = new Date(Date.now() + 3_600_000);
  const f = await fixture(t, {
    acquire: async () => ({ accessToken: 'synthetic-download-token', expiresOn, scopes: ['video.read'] }),
  });
  assert.equal(f.element('save').textContent, 'Download file');
  await f.element('sign-in').emit('click');
  await f.element('save').emit('click');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(f.downloads.length, 1);
  assert.equal(f.downloads[0].download, '.dliu_token');
  assert.equal(f.downloads[0].removed, true);
  assert.equal(await f.objectUrls[0].text(),
    `token=synthetic-download-token\nexpires_at=${expiresOn.toISOString()}\n`);
  assert.deepEqual(f.revokedUrls, ['blob:synthetic-token-file']);
  assert.equal(f.element('token').value, 'synthetic-download-token');
  assert.match(f.element('status').textContent, /home folder as \.dliu_token, including the leading dot/);
});

test('a save still choosing a destination cannot overwrite a newer sign-in state', async (t) => {
  let resolvePicker;
  let attempts = 0;
  let opened = false;
  const f = await fixture(t, {
    acquire: async () => ({
      accessToken: `synthetic-attempt-${++attempts}`, expiresOn: new Date(Date.now() + 3_600_000),
      scopes: ['video.read'],
    }),
    saveFilePicker: () => new Promise((resolve) => { resolvePicker = resolve; }),
  });
  await f.element('sign-in').emit('click');
  const saving = f.element('save').emit('click');
  await f.element('sign-in').emit('click');
  resolvePicker({ async createWritable() { opened = true; } });
  await saving;
  assert.equal(opened, false);
  assert.equal(f.element('token').value, 'synthetic-attempt-2');
  assert.equal(f.element('status').textContent, 'Your token is ready.');
  assert.equal(f.element('save').disabled, false);
});

test('expiry cancels a pending save and prevents further exports without a Clear button', async (t) => {
  let resolvePicker;
  let opened = false;
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const expiresOn = new Date(now + 3_600_000);
  const f = await fixture(t, {
    acquire: async () => ({ accessToken: 'synthetic-expiring-token', expiresOn, scopes: ['video.read'] }),
    saveFilePicker: () => new Promise((resolve) => { resolvePicker = resolve; }),
  });
  await f.element('sign-in').emit('click');
  const saving = f.element('save').emit('click');
  now = expiresOn.getTime();
  await f.document.emit('visibilitychange');
  resolvePicker({ async createWritable() { opened = true; } });
  await saving;
  assert.equal(opened, false);
  assert.equal(f.element('token').value, '');
  assert.equal(f.element('copy-file').disabled, true);
  assert.equal(f.element('save').disabled, true);
  assert.match(f.element('status').textContent, /Token expired/);
});

test('closing or navigating the page clears its token and cancels pending saves', async (t) => {
  let resolvePicker;
  let opened = false;
  const f = await fixture(t, {
    saveFilePicker: () => new Promise((resolve) => { resolvePicker = resolve; }),
  });
  await f.element('sign-in').emit('click');
  const saving = f.element('save').emit('click');
  await f.window.emit('pagehide');
  resolvePicker({ async createWritable() { opened = true; } });
  await saving;
  assert.equal(opened, false);
  assert.equal(f.element('token').value, '');
  assert.equal(f.element('copy-file').disabled, true);
});

test('sign-in can complete in the current hidden tab without creating a durable cache', async (t) => {
  let f;
  f = await fixture(t, {
    acquire: async () => {
      f.document.visibilityState = 'hidden';
      await f.document.emit('visibilitychange');
      return {
        accessToken: 'synthetic-hidden-tab-token',
        expiresOn: new Date(Date.now() + 3_600_000), scopes: ['video.read'],
      };
    },
  });
  await f.element('sign-in').emit('click');
  assert.equal(f.element('token').value, 'synthetic-hidden-tab-token');
  assert.equal(f.cacheClears(), 2);
  f.document.visibilityState = 'visible';
  await f.document.emit('visibilitychange');
  assert.equal(f.element('token').value, 'synthetic-hidden-tab-token');
});
