import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');
const markdownRows = (section) => section.split('\n')
  .filter((line) => line.startsWith('|') && !/^\|(?:\s*---\s*\|)+$/.test(line))
  .slice(1).map((line) => line.slice(1, -1).split('|').map((cell) => cell.trim()));
const htmlRows = (html, id) => {
  const table = html.match(new RegExp(`<table id="${id}">([\\s\\S]*?)<\\/table>`))[1];
  const body = table.match(/<tbody>([\s\S]*?)<\/tbody>/)[1];
  return [...body.matchAll(/<tr>([\s\S]*?)<\/tr>/g)]
    .map(([, row]) => [...row.matchAll(/<td>([\s\S]*?)<\/td>/g)].map(([, cell]) => cell));
};

test('human guest-check diagrams and closed technical details match the full Markdown contract', async () => {
  const [docs, markdown] = await Promise.all([source('web/docs.html'), source('web/health.md')]);
  const html = docs.match(/<article id="health" class="dl-docs">([\s\S]*?)<\/article>/)[1];
  assert.equal(await source('build/web/docs.html'), docs);
  assert.equal(await source('build/web/health.md'), markdown);
  await assert.rejects(() => source('web/health.html'), { code: 'ENOENT' });
  await assert.rejects(() => source('build/web/health.html'), { code: 'ENOENT' });
  assert.match(docs, /<a href="#health">Testing<\/a>/);
  for (const component of ['dg-flow', 'dg-step', 'dg-arrow', 'dg-good', 'dg-warn', 'dg-bad']) {
    assert(html.includes(`class="${component}"`), `Missing human diagram component ${component}`);
  }
  assert.match(html, /href="\/docs\/health\.md">Full technical version \(Markdown\)<\/a>/);
  assert.equal([...html.matchAll(/<details>/g)].length, 2);
  assert.doesNotMatch(html, /<details[^>]*\bopen\b/);
  const plain = html.replace(/<details>[\s\S]*?<\/details>/g, '');
  assert.doesNotMatch(plain, /https:\/\/auth\.dliu\.com|Cache-Control|application\/json|\bGET\b|\bHEAD\b|\b200\b/);

  const functions = markdownRows(markdown.match(/## Functions\n([\s\S]*?)\n## Guest checks/)[1]);
  const checks = markdownRows(markdown.match(/## Guest checks\n([\s\S]*?)\n## Health endpoint/)[1]);
  assert.deepEqual(htmlRows(html, 'health-functions'), functions);
  assert.deepEqual(htmlRows(html, 'health-checks'), checks);
  assert.deepEqual([...html.matchAll(/data-health-function="([^"]+)"/g)].map(([, key]) => key),
    functions.map(([key]) => key));
  assert.deepEqual(functions.map(([key]) => key), ['pages', 'runtime', 'configuration', 'signin', 'documentation']);
  assert.equal(checks.length, 6);
  for (const [key, method, url, status, type, marker, slow] of checks) {
    assert(functions.some(([name]) => name === key));
    assert(['GET', 'HEAD'].includes(method));
    assert.equal(new URL(url).origin, 'https://auth.dliu.com');
    assert.equal(status, '200');
    assert(type);
    assert.equal(slow, '2000');
    if (method === 'HEAD') assert.equal(marker, '-');
    if (url.endsWith('app.js') || url.endsWith('redirect.js')) {
      assert.equal(method, 'HEAD');
      assert.equal(type, 'text/javascript');
    }
  }
  for (const text of ['No cookies', 'Authorization', 'no-store', '15 minutes', '64 KiB',
    'Five-second timeout', 'not one of the six scheduled site checks', 'No Graph request',
    'Never change content', 'no `/health` endpoint']) {
    assert(markdown.includes(text), `Missing machine safety/limit ${text}`);
  }
  assert.doesNotMatch(html, /<script|\/Users\/|(?:\d{12})|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}/i);
  assert.doesNotMatch(markdown, /<details|\/Users\/|(?:\d{12})|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}/i);
  assert.match(markdown, /Testing tab at https:\/\/auth\.dliu\.com\/docs#health/);
  assert.match(markdown, /301 with `Location: \/docs#health`/);
});

test('guest references have exact routes without reading credentials or adding a health backend', async () => {
  const script = await source('lib/static-routes.js');
  const redirects = ['/docs/health', '/docs/health/'];
  const targets = new Map([['/docs/health.md', '/health.md']]);
  for (const uri of [...redirects, ...targets.keys(), '/health', '/health/', '/docs/health.md/', '/docs/health//']) {
    const request = {
      uri,
      get headers() { assert.fail('Static health routing must not inspect headers or credentials.'); },
      get querystring() { assert.fail('Static health routing must not inspect query strings.'); },
    };
    const returned = runInNewContext(`${script}\nhandler(event);`, { event: { request } });
    if (redirects.includes(uri)) {
      assert.equal(returned.statusCode, 301);
      assert.equal(returned.headers.location.value, '/docs#health');
      assert.equal(returned.headers['cache-control'].value, 'no-store, max-age=0');
      assert.equal(request.uri, uri);
    } else {
      assert.equal(returned, request);
      assert.equal(returned.uri, targets.get(uri) ?? uri);
    }
  }
  const stack = await source('lib/token-console-stack.ts');
  assert.match(stack, /contentType: 'text\/markdown; charset=utf-8'/);
  assert.match(await source('web/docs.html'), /href="\/docs#health"/);
  assert.match(await source('README.md'), /\/docs\/health\.md/);
});
