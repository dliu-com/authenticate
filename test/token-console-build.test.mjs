import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveConsoleConfiguration, SHARED_PARAMETER_NAMES } from '../scripts/console-configuration.mjs';

const tenantId = '11111111-1111-4111-8111-111111111111';
const appId = '22222222-2222-4222-8222-222222222222';
const parameters = () => [
  { Name: '/dliu/entra-tenant-id', Type: 'String', Value: tenantId },
  { Name: '/dliu/api-app-id', Type: 'String', Value: appId },
];

test('release configuration reads only central public metadata without decryption or environment overrides', async () => {
  const calls = [];
  const result = await resolveConsoleConfiguration({
    requireConfig: true,
    env: { AUTH_TENANT_ID: 'stale', AUTH_CLIENT_ID: 'stale', AUTH_API_AUDIENCE: 'stale' },
    client: {
      async send(command) {
        calls.push(command.input);
        return { Parameters: parameters().reverse(), InvalidParameters: [] };
      },
    },
  });
  assert.deepEqual(SHARED_PARAMETER_NAMES, ['/dliu/entra-tenant-id', '/dliu/api-app-id']);
  assert.deepEqual(calls, [{ Names: [...SHARED_PARAMETER_NAMES], WithDecryption: false }]);
  assert.deepEqual(result, { configured: true, tenantId, clientId: appId, audience: appId });
});

test('release configuration rejects missing, duplicate, unexpected, secret or malformed central parameters', async () => {
  for (const response of [
    {}, { Parameters: [] }, { Parameters: parameters().slice(0, 1) },
    { Parameters: parameters(), InvalidParameters: ['/dliu/api-app-id'] },
    { Parameters: [parameters()[0], parameters()[0]] },
    { Parameters: [...parameters(), parameters()[0]] },
    { Parameters: [parameters()[0], { ...parameters()[1], Name: '/authenticate/entra-client-id' }] },
    { Parameters: [parameters()[0], { ...parameters()[1], Type: 'SecureString' }] },
    { Parameters: [parameters()[0], { ...parameters()[1], Value: undefined }] },
    { Parameters: [parameters()[0], { ...parameters()[1], Value: 'invalid' }] },
    { Parameters: [{ ...parameters()[0], Value: 'invalid' }, parameters()[1]] },
  ]) {
    await assert.rejects(resolveConsoleConfiguration({
      requireConfig: true,
      env: { AUTH_TENANT_ID: tenantId, AUTH_CLIENT_ID: appId, AUTH_API_AUDIENCE: appId },
      client: { async send() { return response; } },
    }));
  }
  const error = new Error('Synthetic AccessDeniedException');
  await assert.rejects(resolveConsoleConfiguration({
    requireConfig: true,
    client: { async send() { throw error; } },
  }), (value) => value === error);
});

test('local builds stay offline and reject partial local configuration', async () => {
  const client = { async send() { assert.fail('Local builds must not read AWS.'); } };
  assert.deepEqual(await resolveConsoleConfiguration({ env: {}, client }), { configured: false });
  assert.deepEqual(await resolveConsoleConfiguration({
    env: { AUTH_TENANT_ID: tenantId, AUTH_CLIENT_ID: appId, AUTH_API_AUDIENCE: appId }, client,
  }), { configured: true, tenantId, clientId: appId, audience: appId });
  await assert.rejects(resolveConsoleConfiguration({
    env: { AUTH_TENANT_ID: tenantId }, client,
  }), /setup is incomplete/);
});

test('the deploy command requires the central configuration gate before CDK publication', async () => {
  const script = await readFile(new URL('../scripts/build-console.mjs', import.meta.url), 'utf8');
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.match(script, /const config = await resolveConsoleConfiguration/);
  assert.match(script, /requireConfig: process\.argv\.includes\('--require-config'\)/);
  assert(script.indexOf('await resolveConsoleConfiguration') < script.indexOf('await mkdir'));
  assert.match(pkg.scripts.deploy, /node scripts\/build-console\.mjs --require-config && cdk deploy/);
});
