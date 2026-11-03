import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const BASE = 'https://files.dliu.com/dliu.com/';
const CSS = `${BASE}ui/v1/dl.css`;
const ICON = `${BASE}favicon.png`;
const pages = (await readdir(new URL('../web/', import.meta.url))).filter((name) => name.endsWith('.html'));

test('every page uses shared CSS, the original Auth brand/favicon and the footer DL logo, including the OAuth bridge', async () => {
  assert.deepEqual(pages.sort(), ['docs.html', 'index.html', 'redirect.html']);
  for (const name of pages) {
    const html = await source(`web/${name}`);
    assert.equal(await source(`build/web/${name}`), html);
    const styles = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((match) => match[1]);
    assert.equal(styles[0], CSS, name);
    assert.equal(styles.at(-1), '/style.css', name);
    assert(html.includes('<link rel="icon" href="/logo.svg" type="image/svg+xml">'), name);
    assert(html.includes('<body class="dl-page">'), name);
    assert(html.includes('<header class="dl-header">'), name);
    assert(html.includes('<a class="dl-brand" href="/"><img class="dl-logo" src="/logo.svg" alt="" width="32" height="32">DL auth</a>'), name);
    assert.doesNotMatch(html.match(/<header\b[\s\S]*?<\/header>/)[0], /files\.dliu\.com/);
    assert(html.includes('<nav class="dl-nav" aria-label="Site">'), name);
    assert.match(html, /<main class="dl-main (?:dl-narrow|dl-docs-main)">/, name);
    assert(html.includes(`<footer class="dl-footer">\n    <a class="dl-footer-logo" href="https://dliu.com" aria-label="dliu.com"><img src="${ICON}" alt="" width="24" height="24"></a>`), name);
    assert(html.includes('<a href="https://dliu.com">dliu.com</a> &middot; <a href="/docs">Docs</a>'), name);
    assert.match(html, /width=device-width, initial-scale=1, viewport-fit=cover/, name);
    assert.doesNotMatch(html, /\/docs\.css|<style|style=|\son\w+=|<script(?![^>]*\bsrc=)/, name);
    for (const [tag] of html.matchAll(/<button\b[^>]*>/g)) {
      assert.match(tag, /class="dl-button(?: [^"]*)?"/, name);
    }
  }
});

test('docs use the shared docs stylesheet, tabs and diagram text without a copied local kit', async () => {
  const html = await source('web/docs.html');
  assert(html.includes(`<link rel="stylesheet" href="${BASE}ui/v1/dl-docs.css">`));
  assert(html.indexOf('ui/v1/dl.css') < html.indexOf('ui/v1/dl-docs.css'));
  assert(html.includes('<main class="dl-main dl-docs-main">'));
  assert(html.includes('<nav class="dl-tabs" aria-label="Docs sections">'));
  assert.equal([...html.matchAll(/class="dl-docs"/g)].length, 5);
  assert.doesNotMatch(html, /class="dg-(?:node|step)"><strong>/);
  assert((await source('web/docs.js')).includes("querySelectorAll('.dl-tabs a')"));
  for (const path of ['web/docs.css', 'build/web/docs.css']) {
    await assert.rejects(() => access(new URL(`../${path}`, import.meta.url)), { code: 'ENOENT' });
  }
});

test('the release includes the original blue lock logo for the header and favicon', async () => {
  const logo = await source('web/logo.svg');
  assert.equal(await source('build/web/logo.svg'), logo);
  assert.match(logo, /viewBox="0 0 32 32"/);
  assert.match(logo, /fill="#209cee"/);
  assert.match(logo, /d="M12 15v-4a4 4 0 0 1 8 0v4M10 15h12v10H10z"/);
});

test('shared styles own the palette and components; auth CSS is token-console layout only', async () => {
  const css = await source('web/style.css');
  assert.doesNotMatch(css, /:root|prefers-color-scheme|color-scheme|#[a-f\d]{3,8}\b|rgba?\(|hsla?\(/i);
  assert.doesNotMatch(css, /(?:^|})\s*(?:body|main|header|footer|button|\.dl-|\.button|\.brand|\.secondary)\b/m);
  assert.doesNotMatch(css, /(?:color|background|border(?:-color)?|border-radius|box-shadow)\s*:/);
  for (const [, variable] of css.matchAll(/var\((--[^),\s]+)/g)) assert(variable.startsWith('--dl-'));
  assert(css.includes('var(--dl-mono)'));
  const html = await source('web/index.html');
  assert.match(html, /id="sign-in" class="dl-button dl-signin"/);
  assert.match(html, /id="save" class="dl-button dl-button-primary"/);
});

test('shared UI adds no JavaScript and preserves the local MSAL bridge entry point', async () => {
  const expected = { 'index.html': ['/app.js'], 'docs.html': ['/docs.js'], 'redirect.html': ['/redirect.js'] };
  for (const name of pages) {
    const html = await source(`web/${name}`);
    assert.deepEqual([...html.matchAll(/<script\b[^>]*src="([^"]+)"/g)].map((match) => match[1]), expected[name]);
    assert(html.includes('<meta name="referrer" content="no-referrer">'));
  }
  assert.equal(await source('web/redirect.js'),
    "import { broadcastResponseToMainFrame } from '@azure/msal-browser/redirect-bridge';\n\nbroadcastResponseToMainFrame();\n");
});
