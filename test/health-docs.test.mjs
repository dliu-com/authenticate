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
  const [html, markdown] = await Promise.all([source('web/health.html'), source('web/health.md')]);
  assert.equal(await source('build/web/health.html'), html);
  assert.equal(await source('build/web/health.md'), markdown);
  for (const component of ['dl-tabs', 'dg-flow', 'dg-step', 'dg-arrow', 'dg-good', 'dg-warn', 'dg-bad']) {
    assert(html.includes(`class="${component}"`), `Missing human diagram component ${component}`);
  }
  assert.match(html, /href="\/docs\/health\.md">Full technical version \(Markdown\)<\/a>/);
  assert.equal([...html.matchAll(/<details>/g)].length, 2);
  assert.doesNotMatch(html, /<details[^>]*\bopen\b/);
  const plain = html.match(/<article class="dl-docs">([\s\S]*?)<\/article>/)[1]
    .replace(/<details>[\s\S]*?<\/details>/g, '');
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
});

test('guest references have exact routes without reading credentials or adding a health backend', async () => {
  const script = await source('lib/static-routes.js');
  const targets = new Map([
    ['/docs/health', '/health.html'], ['/docs/health/', '/health.html'],
    ['/docs/health.md', '/health.md'],
  ]);
  for (const uri of [...targets.keys(), '/health', '/health/', '/docs/health.md/', '/docs/health//']) {
    const request = {
      uri,
      get headers() { assert.fail('Static health routing must not inspect headers or credentials.'); },
      get querystring() { assert.fail('Static health routing must not inspect query strings.'); },
    };
    const returned = runInNewContext(`${script}\nhandler(event);`, { event: { request } });
    assert.equal(returned, request);
    assert.equal(returned.uri, targets.get(uri) ?? uri);
  }
  const stack = await source('lib/token-console-stack.ts');
  assert.match(stack, /contentType: 'text\/markdown; charset=utf-8'/);
  assert.match(await source('web/docs.html'), /href="\/docs\/health"/);
  assert.match(await source('README.md'), /\/docs\/health\.md/);
});
