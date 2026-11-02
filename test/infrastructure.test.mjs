import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('ts-node/register');
const { App } = require('aws-cdk-lib');
const { Match, Template } = require('aws-cdk-lib/assertions');
const { AuthenticateStack } = require('../lib/authenticate-stack.ts');

test('offline CDK synth restricts the Lambda URL to CloudFront, no auth caching, encrypted TTL storage', () => {
  const app = new App();
  const stack = new AuthenticateStack(app, 'TestAuthenticate', {
    env: { region: 'eu-west-1', account: '000000000000' },
  });
  const template = Template.fromStack(stack);
  template.hasResourceProperties('AWS::DynamoDB::Table', {
    BillingMode: 'PAY_PER_REQUEST',
    KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }],
    TimeToLiveSpecification: { AttributeName: 'expiresAt', Enabled: true },
    SSESpecification: { SSEEnabled: true },
    DeletionProtectionEnabled: true,
  });
  template.hasResource('AWS::DynamoDB::Table', { DeletionPolicy: 'Retain' });
  template.hasResourceProperties('AWS::Lambda::Url', { AuthType: 'AWS_IAM' });
  for (const action of ['lambda:InvokeFunctionUrl', 'lambda:InvokeFunction']) {
    template.hasResourceProperties('AWS::Lambda::Permission', {
      Action: action, Principal: 'cloudfront.amazonaws.com',
      SourceArn: Match.anyValue(),
      ...(action === 'lambda:InvokeFunction' ? { InvokedViaFunctionUrl: true } : {}),
    });
  }
  template.resourceCountIs('AWS::Lambda::Permission', 2);
  template.hasResourceProperties('AWS::CloudFront::OriginAccessControl', {
    OriginAccessControlConfig: Match.objectLike({
      OriginAccessControlOriginType: 'lambda', SigningBehavior: 'always', SigningProtocol: 'sigv4',
    }),
  });
  template.hasResourceProperties('AWS::CloudFront::Distribution', {
    DistributionConfig: Match.objectLike({
      Aliases: ['auth.dliu.com'],
      DefaultCacheBehavior: Match.objectLike({
        AllowedMethods: ['GET', 'HEAD', 'OPTIONS', 'PUT', 'PATCH', 'POST', 'DELETE'],
        ViewerProtocolPolicy: 'https-only',
        CachePolicyId: '4135ea2d-6df8-44a3-9df3-4b5a84be39ad',
        OriginRequestPolicyId: 'b689b0a8-53d0-40ab-baf2-68738e2966ac',
      }),
      Origins: Match.arrayWith([Match.objectLike({ OriginAccessControlId: Match.anyValue() })]),
    }),
  });
  const resources = template.toJSON().Resources;
  const policies = Object.values(resources).filter((r) => r.Type === 'AWS::IAM::Policy');
  const statements = policies.flatMap((p) => p.Properties.PolicyDocument.Statement);
  const ssm = statements.find((s) => s.Action === 'ssm:GetParameters');
  assert.equal(ssm.Resource.length, 3);
  assert(ssm.Resource.every((r) => JSON.stringify(r).includes('parameter/authenticate/entra-')));
  const ddb = statements.find((s) => Array.isArray(s.Action) && s.Action.includes('dynamodb:ConditionCheckItem'));
  assert.deepEqual(ddb.Action.sort(), ['dynamodb:ConditionCheckItem', 'dynamodb:DeleteItem', 'dynamodb:GetItem', 'dynamodb:PutItem']);
  const kms = statements.find((s) => s.Action === 'kms:Decrypt');
  assert.equal(kms.Condition.StringEquals['kms:ViaService'], 'ssm.eu-west-1.amazonaws.com');
  assert(kms.Condition.StringLike['kms:EncryptionContext:PARAMETER_ARN']);
  const lambda = Object.values(resources).find((r) => r.Type === 'AWS::Lambda::Function' && r.Properties.Handler === 'index.handler');
  assert.equal(lambda.Properties.Runtime, 'nodejs22.x');
  assert.deepEqual(Object.keys(lambda.Properties.Environment.Variables), ['TABLE_NAME']);
  const distribution = Object.values(resources).find((r) => r.Type === 'AWS::CloudFront::Distribution').Properties.DistributionConfig;
  assert(!distribution.Logging);
  assert(distribution.CustomErrorResponses.every((r) => r.ErrorCachingMinTTL === 0));
  template.resourceCountIs('AWS::Route53::RecordSet', 2);
  app.synth();
});
