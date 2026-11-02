import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { API_PERMISSIONS } from '../web/token-console.mjs';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('documentation rewrites only its clean URLs, preserving the OAuth bridge and API paths', async () => {
  const script = await source('lib/static-routes.js');
  const clean = ['/docs', '/docs/', '/docs/api', '/docs/api/'];
  for (const uri of [...clean, '/', '/docs.html', '/docs.js', '/docs.css',
    '/redirect.html', '/redirect.js', '/auth/callback', '/api/me', '/docs/unknown', '/docs//', '/docs/apis']) {
    const request = { uri, headers: {}, querystring: { example: { value: 'unchanged' } } };
    const event = { request };
    const returned = runInNewContext(`${script}\nhandler(event);`, { event });
    assert.equal(returned, request);
    assert.equal(returned.uri, clean.includes(uri) ? '/docs.html' : uri);
    assert.deepEqual(returned.querystring, { example: { value: 'unchanged' } });
  }
});

test('docs use shared styles and local section navigation, with a readable no-JavaScript fallback', async () => {
  const [html, index, built] = await Promise.all([
    source('web/docs.html'), source('web/index.html'),
    source('build/web/docs.html'),
  ]);
  assert.equal(built, html);
  assert.match(index, /href="\/docs"/);
  assert.doesNotMatch(index, /name="permission"|type="checkbox"|Choose API permissions/);
  assert.match(html, /All integrated site API scopes are requested automatically/);
  assert.deepEqual([...html.matchAll(/<article id="([^"]+)" class="dl-docs">/g)].map((match) => match[1]),
    ['architecture', 'cost', 'security', 'api']);
  assert.deepEqual([...html.matchAll(/<a href="#([^"]+)">([^<]+)<\/a>/g)].map((match) => match[2]),
    ['Technical architecture', 'Cost', 'Security', 'API']);
  assert.doesNotMatch(html, /<article[^>]*hidden|<style|style=|\son\w+=|<script(?![^>]*\bsrc=)/);
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    assert.match(match[1], /^(?:\/|#|https:\/\/)/);
  }
  for (const asset of ['docs.js', 'style.css']) {
    assert.match(html, new RegExp(`(?:src|href)="/${asset.replace('.', '\\.')}"`));
    assert((await source(`build/web/${asset}`)).length > 0);
  }
  assert.match(html, /class="dl-tabs"/);
  assert.match(html, /href="https:\/\/files\.dliu\.com\/dliu\.com\/ui\/v1\/dl-docs\.css"/);
});

test('home keeps sign-in and export simple while technical details stay in Docs', async () => {
  const [html, built] = await Promise.all([
    source('web/index.html'), source('build/web/index.html'),
  ]);
  assert.equal(built, html);
  assert.match(html, /Sign in\. Get your token\./);
  assert.match(html, /href="\/docs"/);
  assert.match(html, /Save or copy whenever you need it/);
  assert.match(html, /Keep your token private/);
  assert.match(html, /until cleared, closed or expired/);
  assert.match(html, /~\/\.dliu_token/);
  for (const id of ['sign-in', 'status', 'token-panel', 'token', 'expires', 'save', 'copy-file', 'copy', 'clear']) {
    assert(html.includes(`id="${id}"`), `Missing home control: ${id}`);
  }
  assert.doesNotMatch(html, /Microsoft Entra|configured site API permissions|Returned scopes|Authorization:|local storage|session storage|compromised page|24-hour|granted-scopes|API Gateway/i);
});

test('home and Docs have one accessible icon-and-label Docs button in the site menu', async () => {
  for (const [file, current] of [['index.html', false], ['docs.html', true]]) {
    const html = await source(`web/${file}`);
    const nav = html.match(/<nav class="dl-nav" aria-label="Site">([\s\S]*?)<\/nav>/)[1];
    const buttons = [...nav.matchAll(/<a\b([^>]*href="\/docs"[^>]*)>([\s\S]*?)<\/a>/g)];
    assert.equal(buttons.length, 1, `${file} has exactly one Docs menu item`);
    const [, attributes, label] = buttons[0];
    assert.match(attributes, /class="dl-button auth-docs-button"/);
    assert.match(attributes, /aria-label="Docs"/);
    assert.equal(attributes.includes('aria-current="page"'), current);
    assert.match(label, /<svg[^>]*aria-hidden="true"[^>]*focusable="false"/);
    assert.match(label, /<span>Docs<\/span>/);
    assert.doesNotMatch(attributes, /hidden|hide-narrow/);
  }
  const css = await source('web/style.css');
  assert.match(css, /\.auth-docs-button \{[^}]*display: inline-flex/);
  assert.doesNotMatch(css, /\.auth-docs-button[^}]*display:\s*none/);
});

test('public threat model separates source knowledge, public clients, bearer theft and deployment compromise', async () => {
  const text = (await source('web/docs.html')).replace(/\s+/g, ' ');
  for (const required of [
    'Threat model: an attacker knows the source code',
    "does not let the attacker forge Microsoft's token signature",
    'not hidden source code',
    'A public client has no secret',
    'azp',
    'not proof that the caller is the official webpage',
    'already-stolen bearer token',
    'including destructive operations',
    'Controls deployed page code, dependencies or the deployment account',
    'Controls the browser, an extension or the local device',
    'not proof that every attack is impossible',
    'state and nonce rejection',
    'not a live penetration test',
    'reviewed publishable source snapshot',
    'GHSA-g3hv-75wg-m249',
    'local deployment tooling, not the browser token console',
    'no automatic fix',
    'Ignore rules do not remove data already tracked or committed',
    'revoke or rotate it',
  ]) assert(text.includes(required), `Missing public-source threat boundary: ${required}`);
});

test('docs distinguish Microsoft issuance, gateway verification, application authorization and token exposure', async () => {
  const html = await source('web/docs.html');
  for (const text of [
    "Microsoft's cached public keys", 'approved client', 'assigned-user',
    '23:59:59', '60-90 minutes', 'Clearing is not revocation',
    'clipboard history', 'temporary', 'OAuth transaction metadata',
    'Files, Blog and Trip planner', 'live API verification',
  ]) assert(html.includes(text), `Missing documentation: ${text}`);
  assert.match(html, /no permission picker/i);
  assert.match(html, /token lifetime policy has been assigned/);
  assert.match(html, /not an organisation-wide default/);
  assert.match(html, /Actual issued-token lifetime remains unverified/);
  assert.match(html, /href="https:\/\/video\.dliu\.com\/docs\/api"/);
  assert.match(html, /native Save As dialog/);
  assert.match(html, /Supports HTTP\/2 and HTTP\/3/);
  assert.match(html, /CloudFront uses Price Class All/);
  assert.match(html, /does not guarantee a zero-cost bill/);
  assert.match(html, /expires_at=/);
  assert.match(html, /Chrome on macOS sanitizes suggested filenames/);
  assert.match(html, /Copy token file/);
  assert.match(html, /complete two-field record/);
  assert.match(html, /The file is plaintext/);
  assert.match(html, /chmod 600 ~\/\.dliu_token/);
  assert.match(html, /current page's JavaScript memory/);
  assert.match(html, /without\s+an application-level user-token cache/);
  assert.match(html, /Warm Lambda runtimes/);
  assert.doesNotMatch(html, /\/Users\/d\//);
});

test('Auth API docs own credential lookup and transport without duplicating app endpoints', async () => {
  const html = await source('web/docs.html');
  const api = html.match(/<article id="api" class="dl-docs">([\s\S]*?)<\/article>/)[1];
  for (const text of ['Shared API authentication', '~/.dliu_token', 'expires_at=',
    'Default credentials for clients and agents', 'Sending the token', 'VIDEO_API_ACCESS_TOKEN',
    'VIDEO_API_TOKEN_FILE', '--config', 'Raw-token-only files', 'remote', 'HTTPS']) {
    assert(api.includes(text), `Missing shared-auth instruction: ${text}`);
  }
  assert.match(api, /Authorization: Bearer/);
  assert.match(api, /https:\/\/video\.dliu\.com\/docs\/api/);
  assert.doesNotMatch(api, /Video route permissions|POST \/api\/|GET \/api\/me|GET \/api\/videos/);
});

test('docs explain why Auth needs neither periodic cache clearing nor S3 cache cleanup', async () => {
  for (const path of ['README.md', 'web/docs.html']) {
    const text = (await source(path)).replace(/\s+/g, ' ');
    for (const required of [
      'Automatic cache-clearing decision',
      'Auth is excluded from the one-day automatic cache-clearing policy.',
      'CACHING_DISABLED',
      'no-store, max-age=0',
      'error-cache TTLs are zero',
      'no scheduled cache-clearing job',
      'Normal deployments still invalidate',
      'one-day S3 object-expiration rule',
      'current-page token memory, explicit user exports',
    ]) assert(text.includes(required), `Missing cache decision in ${path}: ${required}`);
  }
});

test('shared docs match every site scope and restrict API access to the common assigned-user role', async () => {
  const html = await source('web/docs.html');
  const api = html.match(/<article id="api" class="dl-docs">([\s\S]*?)<\/article>/)[1];
  for (const scope of API_PERMISSIONS) {
    assert(api.includes(`<code>${scope}</code>`), `Missing delegated scope: ${scope}`);
  }
  assert.match(api, /<strong>dliu API user<\/strong>/);
  assert.match(api, /<code>api\.access<\/code>/);
  assert.doesNotMatch(api, /<code>(?:video|files|blog|trip)\.access<\/code>/);
  for (const host of ['video', 'files', 'blog', 'plan']) {
    assert(api.includes(`href="https://${host}.dliu.com/docs/api"`),
      `Missing application authentication reference: ${host}`);
  }
  for (const prefix of ['VIDEO', 'FILES', 'BLOG', 'TRIP']) {
    assert(api.includes(`<code>${prefix}_API_ACCESS_TOKEN</code>`),
      `Missing requester override: ${prefix}`);
  }
  assert.match(api, /this role permits API access across all four sites/);
  assert.match(api, /role never bypasses scope checks/);
  assert.match(api, /standard webpages without this role/);
  assert.match(api, /not to every organisation member/);
  assert.match(api, /API access does not replace website sign-in/);
  assert.match(api, /already-exported token does not acquire new claims/);
  assert.match(api, /Only configured and\s+deployed APIs are usable/);
  assert.match(api, /not\s+a Microsoft directory-administrator role/);
});

test('section links support direct hashes, switching, history changes and safe unknown-hash fallback', async () => {
  const html = await source('web/docs.html');
  const links = [...html.matchAll(/<a href="#([^"]+)">([^<]+)<\/a>/g)].map((match) => ({
    hash: `#${match[1]}`, textContent: match[2], attributes: new Map(),
    setAttribute(name, value) { this.attributes.set(name, value); },
    removeAttribute(name) { this.attributes.delete(name); },
  }));
  const sections = new Map(links.map((link) => [link.hash.slice(1), { hidden: false }]));
  const handlers = new Map();
  const window = {
    location: { hash: '#security' },
    addEventListener(name, handler) { handlers.set(name, handler); },
  };
  const document = {
    querySelectorAll: () => links,
    getElementById: (id) => sections.get(id),
    title: '',
  };
  runInNewContext(await source('web/docs.js'), { document, window });
  const check = (selected, title) => {
    for (const [id, section] of sections) assert.equal(section.hidden, id !== selected);
    for (const link of links) assert.equal(link.attributes.get('aria-current'),
      link.hash === `#${selected}` ? 'page' : undefined);
    assert.equal(document.title, `${title} | Docs | DL auth`);
  };
  check('security', 'Security');
  window.location.hash = '#api';
  handlers.get('hashchange')();
  check('api', 'API');
  window.location.hash = '#cost';
  handlers.get('hashchange')();
  check('cost', 'Cost');
  window.location.hash = '#<script>untrusted</script>';
  handlers.get('hashchange')();
  check('architecture', 'Technical architecture');
  for (const pathname of ['/docs/api', '/docs/api/']) {
    window.location.pathname = pathname;
    window.location.hash = '';
    handlers.get('hashchange')();
    check('api', 'API');
  }
  window.location.hash = '#security';
  handlers.get('hashchange')();
  check('security', 'Security');
});
