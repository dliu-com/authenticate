import test from 'node:test';
import assert from 'node:assert/strict';
import { GetParametersCommand } from '@aws-sdk/client-ssm';
import { loadConfig } from '../lambda/config.js';
import { config } from './helpers.mjs';

test('fixed SSM paths require UUID IDs and SecureString secret; cache refreshes after five minutes', async () => {
  let now = Date.now();
  const valid = [
    { Name: '/authenticate/entra-tenant-id', Type: 'String', Value: config.tenantId },
    { Name: '/authenticate/entra-client-id', Type: 'String', Value: config.clientId },
    { Name: '/authenticate/entra-client-secret', Type: 'SecureString', Value: config.clientSecret },
  ];
  let values = [];
  let calls = 0;
  const client = { send: async (command) => {
    calls++;
    assert(command instanceof GetParametersCommand);
    assert.deepEqual(command.input, {
      Names: valid.map((p) => p.Name), WithDecryption: true,
    });
    return { Parameters: values };
  } };
  await assert.rejects(() => loadConfig(client, now));
  values = valid.map((p) => ({ ...p, ...(p.Type === 'SecureString' ? { Type: 'String' } : {}) }));
  await assert.rejects(() => loadConfig(client, now));
  values = valid.map((p) => ({ ...p, ...(p.Name.endsWith('tenant-id') ? { Value: 'common' } : {}) }));
  await assert.rejects(() => loadConfig(client, now));
  values = valid;
  assert.deepEqual(await loadConfig(client, now), config);
  const count = calls;
  assert.deepEqual(await loadConfig(client, now + 299_999), config);
  assert.equal(calls, count);
  now += 300_000;
  values = [];
  await assert.rejects(() => loadConfig(client, now));
  assert.equal(calls, count + 1);
});
