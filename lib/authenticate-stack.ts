import * as path from 'path';
import {
  aws_certificatemanager as acm,
  aws_cloudfront as cloudfront,
  aws_cloudfront_origins as origins,
  aws_dynamodb as dynamodb,
  aws_iam as iam,
  aws_lambda as lambda,
  aws_logs as logs,
  aws_route53 as route53,
  aws_route53_targets as targets,
  CfnOutput, Duration, Fn, RemovalPolicy, Stack, StackProps,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';

export class AuthenticateStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);
    const zone = route53.HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
      zoneName: Fn.importValue('MainDomain'),
      hostedZoneId: Fn.importValue('MainHostedZoneId'),
    });
    // The browser and client registry are deliberately fixed, not wildcard-configurable.
    const domainName = 'auth.dliu.com';
    const table = new dynamodb.Table(this, 'Sessions', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      timeToLiveAttribute: 'expiresAt',
      removalPolicy: RemovalPolicy.RETAIN,
      deletionProtection: true,
    });
    const api = new lambda.Function(this, 'Broker', {
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../build/lambda')),
      memorySize: 256,
      timeout: Duration.seconds(30),
      description: 'Central Microsoft Entra login broker for auth.dliu.com',
      environment: { TABLE_NAME: table.tableName },
      logGroup: new logs.LogGroup(this, 'BrokerLogs', {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
    });
    api.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:DeleteItem', 'dynamodb:ConditionCheckItem'],
      resources: [table.tableArn],
    }));
    api.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ssm:GetParameters'],
      resources: ['entra-tenant-id', 'entra-client-id', 'entra-client-secret'].map((name) =>
        this.formatArn({ service: 'ssm', resource: 'parameter', resourceName: `authenticate/${name}` })),
    }));
    api.addToRolePolicy(new iam.PolicyStatement({
      actions: ['kms:Decrypt'],
      resources: ['*'],
      conditions: {
        StringEquals: { 'kms:ViaService': `ssm.${this.region}.amazonaws.com` },
        StringLike: {
          'kms:EncryptionContext:PARAMETER_ARN': this.formatArn({
            service: 'ssm', resource: 'parameter', resourceName: 'authenticate/entra-client-secret',
          }),
        },
      },
    }));
    const functionUrl = api.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.AWS_IAM });
    const certificate = new acm.DnsValidatedCertificate(this, 'Certificate', {
      domainName, hostedZone: zone, region: 'us-east-1',
    });
    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: domainName,
      domainNames: [domainName],
      certificate,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      errorResponses: [400, 403, 404, 405, 414, 500, 502, 503, 504].map((httpStatus) => ({
        httpStatus, ttl: Duration.seconds(0),
      })),
      defaultBehavior: {
        origin: origins.FunctionUrlOrigin.withOriginAccessControl(functionUrl, {
          readTimeout: Duration.seconds(30),
        }),
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        compress: true,
      },
    });
    for (const [id, Record] of [['AliasIpv4', route53.ARecord], ['AliasIpv6', route53.AaaaRecord]] as const) {
      new Record(this, id, {
        zone, recordName: 'auth',
        target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution)),
      });
    }
    new CfnOutput(this, 'SiteUrl', { value: `https://${domainName}` });
  }
}
