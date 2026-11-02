import { createHash } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand, TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';

export const digest = (value) => createHash('sha256').update(value).digest('base64url');
export const keyFor = (kind, token) => `${kind}#${digest(token)}`;

function conditionalFailure(error) {
  if (error.name === 'ConditionalCheckFailedException') return true;
  return error.name === 'TransactionCanceledException' &&
    error.CancellationReasons?.some((reason) => reason.Code === 'ConditionalCheckFailed');
}

export class Store {
  constructor(tableName, client = DynamoDBDocumentClient.from(new DynamoDBClient({}))) {
    if (!tableName) throw new Error('TABLE_NAME is required');
    this.tableName = tableName;
    this.client = client;
  }

  async put(item) {
    await this.client.send(new PutCommand({
      TableName: this.tableName, Item: item, ConditionExpression: 'attribute_not_exists(pk)',
    }));
  }

  async get(pk, now) {
    const { Item } = await this.client.send(new GetCommand({
      TableName: this.tableName, Key: { pk }, ConsistentRead: true,
    }));
    return Item && Item.expiresAt > now ? Item : null;
  }

  async take(pk, now) {
    try {
      const { Attributes } = await this.client.send(new DeleteCommand({
        TableName: this.tableName, Key: { pk }, ReturnValues: 'ALL_OLD',
        ConditionExpression: 'expiresAt > :now', ExpressionAttributeValues: { ':now': now },
      }));
      return Attributes;
    } catch (error) {
      if (conditionalFailure(error)) return null;
      throw error;
    }
  }

  async remove(pk) {
    await this.client.send(new DeleteCommand({ TableName: this.tableName, Key: { pk } }));
  }

  liveSession(sessionPk, now) {
    return { ConditionCheck: {
      TableName: this.tableName, Key: { pk: sessionPk },
      ConditionExpression: 'expiresAt > :now AND kind = :kind',
      ExpressionAttributeValues: { ':now': now, ':kind': 'session' },
    } };
  }

  async issueCode(item, now) {
    try {
      await this.client.send(new TransactWriteCommand({ TransactItems: [
        this.liveSession(item.sessionPk, now),
        { Put: { TableName: this.tableName, Item: item, ConditionExpression: 'attribute_not_exists(pk)' } },
      ] }));
      return true;
    } catch (error) {
      if (conditionalFailure(error)) return false;
      throw error;
    }
  }

  async redeemCode(item, now) {
    try {
      await this.client.send(new TransactWriteCommand({ TransactItems: [
        this.liveSession(item.sessionPk, now),
        { Delete: {
          TableName: this.tableName, Key: { pk: item.pk },
          ConditionExpression: 'expiresAt > :now AND kind = :kind AND clientId = :client AND redirectUri = :redirect AND challenge = :challenge AND sessionPk = :session',
          ExpressionAttributeValues: {
            ':now': now, ':kind': 'code', ':client': item.clientId,
            ':redirect': item.redirectUri, ':challenge': item.challenge, ':session': item.sessionPk,
          },
        } },
      ] }));
      return true;
    } catch (error) {
      if (conditionalFailure(error)) return false;
      throw error;
    }
  }
}
