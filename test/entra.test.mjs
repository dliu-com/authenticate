import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { validateIdToken, exchangeMicrosoftCode } from '../lambda/entra.js';
import { config, NOW, idToken, publicKey, oid } from './helpers.mjs';

test('RS256 validation uses issuer, audience, tenant, nonce, times, subject and domain', async () => {
  const token = await idToken('expected-nonce');
  const keys = createLocalJWKSet({ keys: [{ ...await exportJWK(publicKey), kid: 'test-key', alg: 'RS256', use: 'sig' }] });
  assert.equal((await validateIdToken(token, config, 'expected-nonce', NOW, keys)).oid, oid);
  for (const override of [
    { iss: `https://login.microsoftonline.com/${config.tenantId}/` },
    { iss: 'https://attacker.example/v2.0' },
    { aud: 'wrong-client' }, { aud: [config.clientId, 'another-client'] },
    { tid: '44444444-4444-4444-8444-444444444444' },
    { nonce: 'wrong-nonce' }, { nonce: undefined },
    { exp: NOW - 61 }, { exp: undefined },
    { nbf: NOW + 61 }, { nbf: undefined },
    { iat: NOW + 61 }, { iat: undefined },
    { sub: undefined }, { sub: '' }, { ver: '1.0' },
    { oid: undefined }, { oid: 'not-an-oid' },
    { preferred_username: 'user@dliu.com.evil.example' },
    { preferred_username: 'user@other.example', email: 'user@other.example' },
    { preferred_username: `user\n@dliu.com` },
    { preferred_username: 'x'.repeat(250) + '@dliu.com' },
  ]) {
    await assert.rejects(() => idToken('expected-nonce', override).then((value) =>
      validateIdToken(value, config, 'expected-nonce', NOW, keys)), JSON.stringify(override));
  }
});

test('malformed token, wrong signature, unknown kid and algorithm substitution fail', async () => {
  const other = await generateKeyPair('RS256');
  await assert.rejects(() => validateIdToken('bad.token', config, 'n', NOW, publicKey));
  await assert.rejects(async () => validateIdToken(await idToken('n', {}, other.privateKey), config, 'n', NOW, publicKey));
  const keys = createLocalJWKSet({ keys: [{ ...await exportJWK(publicKey), kid: 'other-key' }] });
  await assert.rejects(async () => validateIdToken(await idToken('n'), config, 'n', NOW, keys));
  const hsToken = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).sign(new Uint8Array(32));
  await assert.rejects(() => validateIdToken(hsToken, config, 'n', NOW, publicKey));
  const token = await idToken('n');
  const parts = token.split('.');
  parts[1] = Buffer.from('{"nonce":"n"}').toString('base64url');
  await assert.rejects(() => validateIdToken(parts.join('.'), config, 'n', NOW, publicKey));
});

test('identity fields are nonnullable, bounded, and normalized', async () => {
  const user = await validateIdToken(await idToken('n', {
    preferred_username: 'user@other.example', email: 'ALTERNATE@DLIU.COM', name: undefined,
  }), config, 'n', NOW, publicKey);
  assert.equal(user.email, 'alternate@dliu.com');
  assert.equal(user.name, 'ALTERNATE@DLIU.COM');
  assert.equal(user.sub, `${user.tenant_id}:${user.oid}`);
  const longName = await validateIdToken(await idToken('n', { name: 'n'.repeat(400) }), config, 'n', NOW, publicKey);
  assert.equal(longName.name.length, 256);
});

test('token endpoint denial/missing ID token does not produce identity', async () => {
  for (const fetchImpl of [
    async () => ({ ok: false }),
    async () => ({ ok: true, json: async () => ({ access_token: 'not-an-id-token' }) }),
  ]) await assert.rejects(() => exchangeMicrosoftCode('code', { verifier: 'v', nonce: 'n' }, config, NOW, fetchImpl, publicKey));
});
