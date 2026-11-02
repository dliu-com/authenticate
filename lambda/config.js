import { GetParametersCommand, SSMClient } from '@aws-sdk/client-ssm';

export const SITE_URL = 'https://auth.dliu.com';
export const CLIENTS = Object.freeze({
  video: 'https://video.dliu.com/auth/callback',
  files: 'https://files.dliu.com/auth/callback',
});
export const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const PREFIX = '/authenticate';
const NAMES = ['entra-tenant-id', 'entra-client-id', 'entra-client-secret'];
let cached;
let cachedUntil = 0;
const ssm = new SSMClient({});

export async function loadConfig(client = ssm, now = Date.now()) {
  if (cached && now < cachedUntil) return cached;
  const result = await client.send(new GetParametersCommand({
    Names: NAMES.map((name) => `${PREFIX}/${name}`),
    WithDecryption: true,
  }));
  const parameters = new Map((result.Parameters || []).map((p) => [p.Name, p]));
  const tenantId = parameters.get(`${PREFIX}/entra-tenant-id`)?.Value?.trim().toLowerCase();
  const clientId = parameters.get(`${PREFIX}/entra-client-id`)?.Value?.trim().toLowerCase();
  const secret = parameters.get(`${PREFIX}/entra-client-secret`);
  if (!UUID.test(tenantId || '') || !UUID.test(clientId || '') ||
      secret?.Type !== 'SecureString' || !secret.Value) {
    throw new Error('Invalid or missing /authenticate SSM configuration');
  }
  cached = { tenantId, clientId, clientSecret: secret.Value };
  cachedUntil = now + 5 * 60 * 1000;
  return cached;
}
