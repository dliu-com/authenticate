import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('release build refuses absent or partial Entra configuration before deploying', () => {
  const env = { ...process.env };
  for (const key of ['AUTH_TENANT_ID', 'AUTH_CLIENT_ID', 'AUTH_API_AUDIENCE']) delete env[key];
  const script = new URL('../scripts/build-console.mjs', import.meta.url).pathname;
  const missing = spawnSync(process.execPath, [script, '--require-config'], { env, encoding: 'utf8' });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /Deployment requires AUTH_TENANT_ID/);
  const partial = spawnSync(process.execPath, [script, '--require-config'], {
    env: { ...env, AUTH_TENANT_ID: '11111111-1111-4111-8111-111111111111' },
    encoding: 'utf8',
  });
  assert.notEqual(partial.status, 0);
  assert.match(partial.stderr, /setup is incomplete/);
});
