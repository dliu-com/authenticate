import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { resolveConsoleConfiguration } from './console-configuration.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const outdir = `${root}build/web`;
const config = await resolveConsoleConfiguration({
  requireConfig: process.argv.includes('--require-config'),
});
await mkdir(outdir, { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: ['web/app.js', 'web/redirect.js', 'web/docs.js'],
  outdir,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2022'],
  minify: true,
  sourcemap: false,
  legalComments: 'eof',
});
for (const name of ['docs.css']) {
  await rm(`${outdir}/${name}`, { force: true });
}
for (const name of ['index.html', 'redirect.html', 'style.css', 'docs.html', 'health.html', 'health.md', 'logo.svg']) {
  await copyFile(`${root}web/${name}`, `${outdir}/${name}`);
}
await writeFile(`${outdir}/config.json`, `${JSON.stringify(config)}\n`, { mode: 0o600 });
