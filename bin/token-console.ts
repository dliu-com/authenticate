#!/usr/bin/env node
import { App, Tags } from 'aws-cdk-lib';
import { TokenConsoleStack } from '../lib/token-console-stack';

const region = process.env.CDK_DEFAULT_REGION || 'eu-west-1';
if (region !== 'eu-west-1') throw new Error('The token console requires the eu-west-1 domain exports.');
const app = new App();
Tags.of(app).add('service', 'auth-token-console');
new TokenConsoleStack(app, 'AuthTokenConsole', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region },
});
