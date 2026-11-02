import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
require('ts-node/register');
const { App } = require('aws-cdk-lib');
const { Match, Template } = require('aws-cdk-lib/assertions');
const { TokenConsoleStack } = require('../lib/token-console-stack.ts');

test('default entry deploys only a private static site, never the retired authentication broker', async () => {
  const entry = JSON.parse(await readFile(new URL('../cdk.json', import.meta.url), 'utf8'));
  assert.equal(entry.app, 'npx ts-node bin/token-console.ts');
  const app = new App();
  const stack = new TokenConsoleStack(app, 'TestTokenConsole', {
    env: { region: 'eu-west-1', account: '000000000000' },
  });
  const template = Template.fromStack(stack);
  template.resourceCountIs('AWS::DynamoDB::Table', 0);
  template.resourceCountIs('AWS::Lambda::Url', 0);
  template.resourceCountIs('AWS::SSM::Parameter', 0);
  template.resourceCountIs('AWS::S3::Bucket', 1);
  template.hasResource('AWS::S3::Bucket', { DeletionPolicy: 'Retain' });
  template.hasResourceProperties('AWS::S3::Bucket', {
    PublicAccessBlockConfiguration: {
      BlockPublicAcls: true, BlockPublicPolicy: true,
      IgnorePublicAcls: true, RestrictPublicBuckets: true,
    },
  });
  template.hasResourceProperties('AWS::CloudFront::OriginAccessControl', {
    OriginAccessControlConfig: Match.objectLike({
      OriginAccessControlOriginType: 's3', SigningBehavior: 'always',
    }),
  });
  template.hasResourceProperties('AWS::CloudFront::Distribution', {
    DistributionConfig: Match.objectLike({
      Aliases: ['auth.dliu.com'],
      DefaultRootObject: 'index.html',
      PriceClass: 'PriceClass_All',
      HttpVersion: 'http2and3',
      DefaultCacheBehavior: Match.objectLike({
        AllowedMethods: ['GET', 'HEAD'],
        ViewerProtocolPolicy: 'redirect-to-https',
        CachePolicyId: '4135ea2d-6df8-44a3-9df3-4b5a84be39ad',
      }),
    }),
  });
  const resources = Object.values(template.toJSON().Resources);
  const distribution = resources.find((r) => r.Type === 'AWS::CloudFront::Distribution').Properties.DistributionConfig;
  assert(!distribution.Logging);
  assert(!distribution.CacheBehaviors?.length);
  assert.deepEqual(distribution.CustomErrorResponses.map((response) => response.ErrorCachingMinTTL), [0, 0]);
  template.resourceCountIs('AWS::CloudFront::Function', 1);
  const routes = Object.entries(template.toJSON().Resources)
    .find(([, resource]) => resource.Type === 'AWS::CloudFront::Function');
  assert.deepEqual(distribution.DefaultCacheBehavior.FunctionAssociations, [{
    EventType: 'viewer-request',
    FunctionARN: { 'Fn::GetAtt': [routes[0], 'FunctionARN'] },
  }]);
  assert.equal(routes[1].Properties.FunctionCode,
    await readFile(new URL('../lib/static-routes.js', import.meta.url), 'utf8'));
  const policy = resources.find((r) => r.Type === 'AWS::CloudFront::ResponseHeadersPolicy').Properties.ResponseHeadersPolicyConfig;
  const csp = policy.SecurityHeadersConfig.ContentSecurityPolicy.ContentSecurityPolicy;
  assert.equal(csp, [
    "default-src 'none'", "script-src 'self'",
    "style-src 'self' https://files.dliu.com/dliu.com/ui/",
    "connect-src 'self' https://login.microsoftonline.com",
    "img-src 'self' https://files.dliu.com/dliu.com/", "font-src 'none'", "frame-src 'none'",
    "frame-ancestors 'none'", "base-uri 'none'", "form-action 'none'", "object-src 'none'",
  ].join('; '));
  for (const required of ["script-src 'self'", "frame-ancestors 'none'", "form-action 'none'", "base-uri 'none'"]) {
    assert(csp.includes(required));
  }
  assert(!csp.includes('unsafe-inline'));
  assert(!csp.includes('unsafe-eval'));
  assert(policy.CustomHeadersConfig.Items.some((h) =>
    h.Header === 'Cache-Control' && h.Value === 'no-store, max-age=0' && h.Override === true));
  assert(!policy.CustomHeadersConfig.Items.some((h) => h.Header.toLowerCase() === 'cross-origin-opener-policy'));
  const allPolicies = resources.filter((r) => r.Type === 'AWS::IAM::Policy');
  assert(!JSON.stringify(allPolicies).includes('ssm:GetParameters'));
  assert(!JSON.stringify(allPolicies).includes('dynamodb:'));
  const deployment = resources.find((r) => r.Type === 'Custom::CDKBucketDeployment');
  assert.deepEqual(deployment.Properties.SystemMetadata, { 'cache-control': 'no-store' });
  app.synth();
});
