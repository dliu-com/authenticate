import { createRemoteJWKSet, jwtVerify, errors } from 'jose';
import { UUID, SITE_URL } from './config.js';

const keySets = new Map();
export const authority = (config) => `https://login.microsoftonline.com/${config.tenantId}`;
export class IdentityRejected extends Error {}

export async function validateIdToken(token, config, nonce, now, keyResolver) {
  const issuer = `${authority(config)}/v2.0`;
  if (!keyResolver) {
    if (!keySets.has(issuer)) {
      keySets.set(issuer, createRemoteJWKSet(new URL(`${authority(config)}/discovery/v2.0/keys`), {
        timeoutDuration: 5000, cooldownDuration: 30_000, cacheMaxAge: 600_000,
      }));
    }
    keyResolver = keySets.get(issuer);
  }
  let payload;
  try {
    ({ payload } = await jwtVerify(token, keyResolver, {
      algorithms: ['RS256'], issuer, audience: config.clientId,
      currentDate: new Date(now * 1000), clockTolerance: 60,
      requiredClaims: ['iss', 'aud', 'sub', 'exp', 'iat', 'nbf', 'nonce', 'tid', 'oid'],
    }));
  } catch (error) {
    if (error instanceof errors.JOSEError && [
      'ERR_JWT_CLAIM_VALIDATION_FAILED', 'ERR_JWT_EXPIRED', 'ERR_JWT_INVALID',
      'ERR_JWS_INVALID', 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED',
      'ERR_JOSE_ALG_NOT_ALLOWED', 'ERR_JOSE_NOT_SUPPORTED', 'ERR_JWKS_NO_MATCHING_KEY',
    ].includes(error.code)) throw new IdentityRejected('Invalid Microsoft ID token');
    throw error;
  }
  if (payload.aud !== config.clientId || payload.tid !== config.tenantId ||
      payload.ver !== '2.0' || payload.nonce !== nonce ||
      !UUID.test(payload.oid) || typeof payload.sub !== 'string' || !payload.sub ||
      payload.iat > now + 60) throw new IdentityRejected('Invalid identity claims');
  const email = [payload.preferred_username, payload.email]
    .find((value) => typeof value === 'string' && value.length <= 254 && /^[^@\s]+@dliu\.com$/i.test(value));
  if (!email) throw new IdentityRejected('Account domain not allowed');
  return {
    sub: `${config.tenantId}:${payload.oid.toLowerCase()}`,
    tenant_id: config.tenantId,
    oid: payload.oid.toLowerCase(),
    email: email.toLowerCase(),
    name: typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim().slice(0, 256) : email,
  };
}

export async function exchangeMicrosoftCode(code, transaction, config, now, fetchImpl = fetch, keyResolver) {
  const result = await fetchImpl(`${authority(config)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId, client_secret: config.clientSecret,
      grant_type: 'authorization_code', code, code_verifier: transaction.verifier,
      redirect_uri: `${SITE_URL}/auth/callback`, scope: 'openid profile email',
    }).toString(),
    signal: AbortSignal.timeout(8000),
    redirect: 'error',
  });
  if (!result.ok) {
    if (result.status === 400 || result.status === 401) throw new IdentityRejected('Microsoft token exchange rejected');
    throw new Error('Microsoft token endpoint unavailable');
  }
  const tokens = await result.json();
  if (typeof tokens.id_token !== 'string') throw new Error('Missing Microsoft ID token');
  return validateIdToken(tokens.id_token, config, transaction.nonce, now, keyResolver);
}
