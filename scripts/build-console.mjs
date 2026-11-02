import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { readConfiguration } from '../web/token-console.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const outdir = `${root}build/web`;
const values = {
  tenantId: process.env.AUTH_TENANT_ID,
  clientId: process.env.AUTH_CLIENT_ID,
  audience: process.env.AUTH_API_AUDIENCE,
};
const configured = Object.values(values).some((value) => value !== undefined);
const config = configured ? { configured: true, ...readConfiguration({ configured: true, ...values }) } :
  { configured: false };
if (process.argv.includes('--require-config') && !configured) {
  throw new Error('Deployment requires AUTH_TENANT_ID, AUTH_CLIENT_ID and AUTH_API_AUDIENCE.');
}
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
for (const name of ['index.html', 'redirect.html', 'style.css', 'docs.html', 'logo.svg']) {
  await copyFile(`${root}web/${name}`, `${outdir}/${name}`);
}
await writeFile(`${outdir}/config.json`, `${JSON.stringify(config)}\n`, { mode: 0o600 });
