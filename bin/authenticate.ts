#!/usr/bin/env node
import { App, Tags } from 'aws-cdk-lib';
import { AuthenticateStack } from '../lib/authenticate-stack';

const region = process.env.CDK_DEFAULT_REGION || 'eu-west-1';
if (region !== 'eu-west-1') throw new Error('Authenticate requires the eu-west-1 MainDomain and MainHostedZoneId exports.');
const app = new App();
Tags.of(app).add('service', 'authenticate');
new AuthenticateStack(app, 'Authenticate', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region },
});
