import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { API_PERMISSIONS } from '../web/token-console.mjs';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('documentation rewrites only its clean URLs, preserving the OAuth bridge and API paths', async () => {
  const script = await source('lib/static-routes.js');
  const clean = ['/docs', '/docs/'];
  const redirects = new Map([
    ['/docs/health', '/docs#health'], ['/docs/health/', '/docs#health'],
    ['/docs/api', '/docs#api'], ['/docs/api/', '/docs#api'],
  ]);
  const markdown = new Map([['/docs/health.md', '/health.md'], ['/docs/api.md', '/api.md']]);
  for (const uri of [...clean, ...redirects.keys(), ...markdown.keys(), '/', '/docs.html', '/docs.js', '/docs.css',
    '/redirect.html', '/redirect.js', '/auth/callback', '/api/me', '/docs/unknown', '/docs//', '/docs/apis',
    '/health', '/health/', '/docs/health.md/', '/docs/health//', '/docs/api.md/', '/docs/api//']) {
    const request = {
      uri,
      get headers() { assert.fail('Static routes must not read headers or credentials.'); },
      get querystring() { assert.fail('Static routes must not read query strings.'); },
    };
    const event = { request };
    const returned = runInNewContext(`${script}\nhandler(event);`, { event });
    if (redirects.has(uri)) {
      assert.equal(returned.statusCode, 301);
      assert.equal(returned.headers.location.value, redirects.get(uri));
      assert.equal(returned.headers['cache-control'].value, 'no-store, max-age=0');
    } else {
      assert.equal(returned, request);
      assert.equal(returned.uri, clean.includes(uri) ? '/docs.html' : markdown.get(uri) ?? uri);
    }
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
    ['architecture', 'cost', 'security', 'api', 'health']);
  assert.deepEqual([...html.matchAll(/<a href="#([^"]+)">([^<]+)<\/a>/g)].map((match) => match[2]),
    ['Architecture', 'Cost', 'Security', 'API', 'Health']);
  assert.doesNotMatch(html, /Technical architecture/);
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
  assert.doesNotMatch(html, /Kept on this page until cleared, closed or expired\./);
  assert.match(html, /~\/\.dliu_token/);
  for (const id of ['sign-in', 'status', 'token-panel', 'token', 'expires', 'save', 'copy-file']) {
    assert(html.includes(`id="${id}"`), `Missing home control: ${id}`);
  }
  const actions = html.match(/<div class="token-actions">([\s\S]*?)<\/div>/)[1];
  assert.deepEqual([...actions.matchAll(/<button id="([^"]+)"[^>]*>([^<]+)<\/button>/g)]
    .map(([, id, label]) => ({ id, label })), [
    { id: 'save', label: 'Save file' }, { id: 'copy-file', label: 'Copy token file' },
  ]);
  assert.doesNotMatch(html, /id="(?:copy|clear)"/);
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
  const markdown = await source('web/api.md');
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
  assert.match(markdown, /native Save As dialog/);
  assert.match(html, /Supports HTTP\/2 and HTTP\/3/);
  assert.match(html, /CloudFront uses Price Class All/);
  assert.match(html, /does not guarantee a zero-cost bill/);
  assert.match(markdown, /expires_at=/);
  assert.match(markdown, /Chrome on macOS sanitizes suggested filenames/);
  assert.match(html, /Copy token file/);
  assert.match(markdown, /complete two-field record/);
  assert.match(markdown, /The file is plaintext/);
  assert.match(markdown, /chmod 600 ~\/\.dliu_token/);
  assert.match(html, /current page's JavaScript memory/);
  assert.match(html, /without\s+an application-level user-token cache/);
  assert.match(html, /Warm Lambda runtimes/);
  assert.doesNotMatch(html, /\/Users\/d\//);
});

test('Auth API docs own credential lookup and transport without duplicating app endpoints', async () => {
  const html = await source('web/docs.html');
  const api = html.match(/<article id="api" class="dl-docs">([\s\S]*?)<\/article>/)[1];
  const markdown = await source('web/api.md');
  assert.equal(await source('build/web/api.md'), markdown);
  for (const text of ['Shared API authentication', '~/.dliu_token', 'expires_at=',
    'Default credentials for clients and agents', 'Sending the token', 'VIDEO_API_ACCESS_TOKEN',
    'VIDEO_API_TOKEN_FILE', '--config', 'Raw-token-only files', 'remote', 'HTTPS']) {
    const required = text === 'Shared API authentication' ? 'Shared dliu.com API authentication' : text;
    assert(markdown.includes(required), `Missing shared-auth instruction: ${text}`);
  }
  assert.match(markdown, /Authorization: Bearer/);
  assert.match(markdown, /text\/markdown; charset=utf-8/);
  assert.match(markdown, /301 with `Location: \/docs#api`/);
  assert.doesNotMatch(markdown, /<details|\/Users\/|(?:\d{12})|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}/i);
  for (const component of ['dg-stats', 'dg-stat', 'dg-link', 'dg-tier-label', 'dg-tier-nodes', 'dg-node', 'dg-arrow', 'dg-good', 'dg-warn', 'dg-bad']) {
    assert(api.includes(`class="${component}"`), `Missing human API component ${component}`);
  }
  assert.match(api, /<figure class="dg dg-tiers">/);
  assert.match(api, /^\s*<h2>[^<]+<\/h2>\s*<p>Machine-readable version: <a href="\/docs\/api\.md">\/docs\/api\.md<\/a><\/p>/);
  assert.equal([...api.matchAll(/<a href="\/docs\/api\.md"/g)].length, 2);
  assert.doesNotMatch(api, /<(?:code|pre|details|script)\b|Authorization:|Cache-Control|Content-Type|expires_at=|\bJSON\b|\bGET\b|\bHEAD\b|\b[1-5]\d{2}\b|application\/json|text\/(?:html|javascript|markdown)|api\.access/);
  assert.match(api, /<p><a href="\/docs\/api\.md">Technical version for machines \(Markdown\)<\/a><\/p>\s*$/);
  assert.match(api, /not live API usage/);
  assert.match(api, /https:\/\/video\.dliu\.com\/docs\/api/);
  assert.doesNotMatch(api, /Video route permissions|POST \/api\/|GET \/api\/me|GET \/api\/videos/);
});

test('security docs separate bounded live evidence, operational risks and untested identity boundaries', async () => {
  const text = (await source('web/docs.html')).replace(/\s+/g, ' ');
  for (const required of [
    'Assets, actors and trust boundaries',
    'STRIDE by component',
    'denial of wallet',
    'Bounded production penetration checks: 2026-11-03',
    '42 unauthenticated GET/HEAD/OPTIONS requests',
    '500 ms apart',
    'Expected</th><th>Actual (2026-11-03 UTC)',
    '12 hidden/source paths',
    'Unsigned direct S3',
    'not server-only proof',
    'Not tested live:',
    'No Entra settings were changed',
    'not assume public static hosting has a hard spending cap',
    'Code, history and dependency review: 2026-11-03',
    'all 43 tracked files',
    'Gitleaks was unavailable',
    '135 additional in-memory',
    'two moderate affected-package records for the same',
    'not fixes silently applied by this review',
  ]) assert(text.includes(required), `Missing comprehensive security boundary: ${required}`);
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
  const markdown = await source('web/api.md');
  const text = markdown.replace(/\s+/g, ' ');
  for (const scope of API_PERMISSIONS) {
    assert(markdown.includes(`\`${scope}\``), `Missing delegated scope: ${scope}`);
  }
  assert.match(api, /<strong>dliu API user<\/strong>/);
  assert(markdown.includes('`api.access`'));
  assert.doesNotMatch(markdown, /`(?:video|files|blog|trip)\.access`/);
  for (const host of ['video', 'files', 'blog', 'plan']) {
    assert(api.includes(`href="https://${host}.dliu.com/docs/api"`),
      `Missing application authentication reference: ${host}`);
  }
  for (const prefix of ['VIDEO', 'FILES', 'BLOG', 'TRIP']) {
    assert(markdown.includes(`\`${prefix}_API_ACCESS_TOKEN\``),
      `Missing requester override: ${prefix}`);
  }
  for (const required of ['Assignment permits API access across the integrated sites',
    'role never bypasses scope checks', 'standard webpages without this role',
    'not to every organisation member', 'API access does not replace website sign-in',
    'already-exported token does not acquire new claims', 'Only configured and deployed APIs are usable',
    'not a Microsoft directory-administrator role', 'EARLIER expiry', 'empty/invalid explicit',
    'MUST fail', 'not cryptographic token verification', 'Do not forward bearer credentials',
    'not authorisation to perform tasks']) {
    assert(text.includes(required), `Missing machine authentication boundary: ${required}`);
  }
  const chart = [...api.matchAll(/<tr data-api-site="([^"]+)">[\s\S]*?<meter min="0" max="(\d+)" value="(\d+)"/g)];
  assert.deepEqual(chart.map(([, site]) => site), ['video', 'files', 'blog', 'trip']);
  for (const [, site, total, count] of chart) {
    assert.equal(Number(total), API_PERMISSIONS.length);
    assert.equal(Number(count), API_PERMISSIONS.filter((scope) => scope.startsWith(`${site}.`)).length);
  }
  assert.match(api, /<strong>4 apps<\/strong>/);
  assert.match(api, /<strong>1 shared role<\/strong>/);
  assert.match(api, /<strong>2 export actions<\/strong>/);
  assert(api.includes(`<strong>${API_PERMISSIONS.length} permissions</strong>`));
});

test('human diagram cards and statistics have icons, reusing Architecture icons for the same services', async () => {
  const html = await source('web/docs.html');
  const section = (id) => html.match(new RegExp(`<article id="${id}" class="dl-docs">([\\s\\S]*?)<\\/article>`))[1];
  const cards = (text) => new Map([...text.matchAll(/<div class="dg-node"><span class="dg-icon" data-dg-tier="([^"]+)" aria-hidden="true">(<svg[\s\S]*?<\/svg>)<\/span><div class="dg-text"><strong>([^<]+)<\/strong>/g)]
    .map(([, tier, svg, title]) => [title, { tier, svg }]));
  const architecture = cards(section('architecture'));
  const api = cards(section('api'));
  const health = cards(section('health'));
  for (const name of ['Token page', 'Microsoft Entra ID', 'Trusted API client', 'API Gateway', 'Application Lambda']) {
    assert.deepEqual(api.get(name), architecture.get(name), `Service icon/palette drift: ${name}`);
    assert(api.has(name));
  }
  assert.deepEqual(health.get('Site bucket'), architecture.get('Site bucket'));
  assert.deepEqual(health.get('Pages and controls'), architecture.get('Global edge delivery'));
  for (const id of ['api', 'health']) {
    const text = section(id);
    const nodes = [...text.matchAll(/<div class="dg-node">/g)];
    assert.equal(cards(text).size, nodes.length, `Every ${id} component needs a coloured service icon`);
    const stats = text.match(/<div class="dg-stats">([\s\S]*?)<\/div>\s*<figure/)[1];
    assert.equal([...stats.matchAll(/data-dg-tier=/g)].length, 4);
    assert.equal([...stats.matchAll(/<svg /g)].length, 4);
  }
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
    readyState: 'interactive',
    querySelectorAll: (selector) => selector === '.dl-tabs a' ? links : icons,
    querySelector: (selector) => ({ backgroundColor: palette.get(selector.split(' ')[1].slice(1)) }),
    getElementById: (id) => sections.get(id),
    title: '',
  };
  const palette = new Map([
    ['dg-untrusted', 'rgb(1, 2, 3)'], ['dg-edge', 'rgb(4, 5, 6)'],
    ['dg-app', 'rgb(7, 8, 9)'], ['dg-private', 'rgb(10, 11, 12)'],
  ]);
  const icons = [...html.matchAll(/class="dg-icon" data-dg-tier="([^"]+)"/g)].map(([, tier]) => ({
    tier, properties: new Map(),
    getAttribute(name) { assert.equal(name, 'data-dg-tier'); return this.tier; },
    get style() { return { setProperty: (name, value) => this.properties.set(name, value) }; },
  }));
  runInNewContext(await source('web/docs.js'), { document, window, getComputedStyle: (badge) => badge });
  assert(icons.length > 0);
  for (const icon of icons) assert.equal(icon.properties.size, 0, 'Do not sample badge colours before shared CSS loads');
  handlers.get('load')();
  for (const icon of icons) assert.equal(icon.properties.get('--dg'), palette.get(icon.tier));
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
  window.location.hash = '#health';
  handlers.get('hashchange')();
  check('health', 'Health');
  window.location.hash = '#<script>untrusted</script>';
  handlers.get('hashchange')();
  check('architecture', 'Architecture');
  window.location.hash = '#architecture';
  handlers.get('hashchange')();
  check('architecture', 'Architecture');
  window.location.hash = '#security';
  handlers.get('hashchange')();
  check('security', 'Security');
  window.location.pathname = '/docs';
  window.location.hash = '#health';
  handlers.get('hashchange')();
  check('health', 'Health');
  for (const icon of icons) icon.properties.clear();
  document.readyState = 'complete';
  runInNewContext(await source('web/docs.js'), { document, window, getComputedStyle: (badge) => badge });
  for (const icon of icons) assert.equal(icon.properties.get('--dg'), palette.get(icon.tier));
});
