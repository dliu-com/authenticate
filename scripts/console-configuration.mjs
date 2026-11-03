import { GetParametersCommand, SSMClient } from '@aws-sdk/client-ssm';
import { readConfiguration } from '../web/token-console.mjs';

export const SHARED_PARAMETER_NAMES = Object.freeze([
  '/dliu/entra-tenant-id', '/dliu/api-app-id',
]);

export async function resolveConsoleConfiguration({
  requireConfig = false, env = process.env, client,
} = {}) {
  if (!requireConfig) {
    const values = {
      tenantId: env.AUTH_TENANT_ID,
      clientId: env.AUTH_CLIENT_ID,
      audience: env.AUTH_API_AUDIENCE,
    };
    return Object.values(values).some((value) => value !== undefined)
      ? { configured: true, ...readConfiguration({ configured: true, ...values }) }
      : { configured: false };
  }

  const ssm = client ?? new SSMClient({ region: 'eu-west-1', maxAttempts: 2 });
  try {
    const result = await ssm.send(new GetParametersCommand({
      Names: [...SHARED_PARAMETER_NAMES], WithDecryption: false,
    }));
    if (!Array.isArray(result.Parameters) || result.Parameters.length !== 2 ||
        (result.InvalidParameters?.length ?? 0) > 0) {
      throw new Error('Shared Auth metadata is missing from SSM in eu-west-1.');
    }
    const values = new Map();
    for (const parameter of result.Parameters) {
      if (!SHARED_PARAMETER_NAMES.includes(parameter.Name) ||
          values.has(parameter.Name) || parameter.Type !== 'String' ||
          typeof parameter.Value !== 'string') {
        throw new Error('Shared Auth metadata must contain exactly the two expected Standard String parameters.');
      }
      values.set(parameter.Name, parameter.Value);
    }
    return {
      configured: true,
      ...readConfiguration({
        configured: true,
        tenantId: values.get(SHARED_PARAMETER_NAMES[0]),
        clientId: values.get(SHARED_PARAMETER_NAMES[1]),
        audience: values.get(SHARED_PARAMETER_NAMES[1]),
      }),
    };
  } finally {
    if (!client) ssm.destroy();
  }
}
