import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GetCommand, PutCommand, DeleteCommand, TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { Store, keyFor } from '../lambda/store.js';
import { NOW } from './helpers.mjs';

const table = 'test-auth-table';
const sessionPk = keyFor('session', 'session-cookie');
const item = {
  pk: keyFor('code', 'one-use-code'), kind: 'code', sessionPk,
  clientId: 'video', redirectUri: 'https://video.dliu.com/auth/callback',
  challenge: 'challenge', expiresAt: NOW + 60,
};

test('reads are strongly consistent and expiry is enforced independently of DynamoDB TTL', async () => {
  const commands = [];
  const store = new Store(table, { send: async (command) => {
    commands.push(command);
    return { Item: { pk: 'record', expiresAt: NOW } };
  } });
  assert.equal(await store.get('record', NOW), null);
  assert.deepEqual((await store.get('record', NOW - 1)).expiresAt, NOW);
  assert(commands[0] instanceof GetCommand);
  assert.deepEqual(commands[0].input, { TableName: table, Key: { pk: 'record' }, ConsistentRead: true });
  assert.notEqual(keyFor('session', 'cookie'), keyFor('code', 'cookie'));
  assert(!keyFor('session', 'secret-cookie-value').includes('secret-cookie-value'));
});

test('transactions atomically bind code issuance and redemption to a live session', async () => {
  const commands = [];
  const store = new Store(table, { send: async (command) => { commands.push(command); return {}; } });
  assert.equal(await store.issueCode(item, NOW), true);
  assert.equal(await store.redeemCode(item, NOW), true);
  assert(commands.every((command) => command instanceof TransactWriteCommand));
  const [issue, redeem] = commands.map((command) => command.input.TransactItems);
  for (const transaction of [issue, redeem]) {
    assert.equal(transaction.length, 2);
    assert.deepEqual(transaction[0].ConditionCheck, {
      TableName: table, Key: { pk: sessionPk },
      ConditionExpression: 'expiresAt > :now AND kind = :kind',
      ExpressionAttributeValues: { ':now': NOW, ':kind': 'session' },
    });
  }
  assert.equal(issue[1].Put.ConditionExpression, 'attribute_not_exists(pk)');
  assert.deepEqual(issue[1].Put.Item, item);
  assert.deepEqual(redeem[1].Delete.Key, { pk: item.pk });
  assert.equal(redeem[1].Delete.ConditionExpression,
    'expiresAt > :now AND kind = :kind AND clientId = :client AND redirectUri = :redirect AND challenge = :challenge AND sessionPk = :session');
  assert.deepEqual(redeem[1].Delete.ExpressionAttributeValues, {
    ':now': NOW, ':kind': 'code', ':client': item.clientId,
    ':redirect': item.redirectUri, ':challenge': item.challenge, ':session': item.sessionPk,
  });
});

test('login transaction consumption is a conditional delete with returned prior value', async () => {
  const commands = [];
  const flow = { pk: 'flow#hash', expiresAt: NOW + 600 };
  const store = new Store(table, { send: async (command) => {
    commands.push(command); return { Attributes: flow };
  } });
  await store.put(flow);
  assert(commands[0] instanceof PutCommand);
  assert.equal(commands[0].input.ConditionExpression, 'attribute_not_exists(pk)');
  assert.deepEqual(await store.take(flow.pk, NOW), flow);
  assert(commands[1] instanceof DeleteCommand);
  assert.deepEqual(commands[1].input, {
    TableName: table, Key: { pk: flow.pk }, ReturnValues: 'ALL_OLD',
    ConditionExpression: 'expiresAt > :now', ExpressionAttributeValues: { ':now': NOW },
  });
});

test('only conditional misses map to invalid grant; operational failures surface', async () => {
  for (const error of [
    { name: 'ConditionalCheckFailedException' },
    { name: 'TransactionCanceledException', CancellationReasons: [{ Code: 'None' }, { Code: 'ConditionalCheckFailed' }] },
  ]) {
    const store = new Store(table, { send: async () => { throw error; } });
    assert.equal(await store.take('flow', NOW), null);
    assert.equal(await store.issueCode(item, NOW), false);
    assert.equal(await store.redeemCode(item, NOW), false);
  }
  for (const error of [
    { name: 'AccessDeniedException' },
    { name: 'TransactionCanceledException', CancellationReasons: [{ Code: 'TransactionConflict' }] },
    { name: 'ProvisionedThroughputExceededException' },
  ]) {
    const store = new Store(table, { send: async () => { throw error; } });
    await assert.rejects(() => store.take('flow', NOW), error);
    await assert.rejects(() => store.issueCode(item, NOW), error);
    await assert.rejects(() => store.redeemCode(item, NOW), error);
  }
});
