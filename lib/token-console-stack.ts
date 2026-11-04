import * as path from 'path';
import { readFileSync } from 'fs';
import {
  aws_certificatemanager as acm,
  aws_cloudfront as cloudfront,
  aws_cloudfront_origins as origins,
  aws_route53 as route53,
  aws_route53_targets as targets,
  aws_s3 as s3,
  aws_s3_deployment as deployment,
  CfnOutput, Duration, Fn, RemovalPolicy, Stack, StackProps,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';

export class TokenConsoleStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);
    const zone = route53.HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
      zoneName: Fn.importValue('MainDomain'),
      hostedZoneId: Fn.importValue('MainHostedZoneId'),
    });
    const domainName = 'auth.dliu.com';
    const bucket = new s3.Bucket(this, 'Site', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const certificate = new acm.DnsValidatedCertificate(this, 'Certificate', {
      domainName, hostedZone: zone, region: 'us-east-1',
    });
    const headers = new cloudfront.ResponseHeadersPolicy(this, 'Headers', {
      securityHeadersBehavior: {
        contentSecurityPolicy: {
          override: true,
          contentSecurityPolicy: [
            "default-src 'none'", "script-src 'self'",
            "style-src 'self' https://files.dliu.com/dliu.com/ui/",
            "connect-src 'self' https://login.microsoftonline.com",
            "img-src 'self' https://files.dliu.com/dliu.com/", "font-src 'none'", "frame-src 'none'",
            "frame-ancestors 'none'", "base-uri 'none'", "form-action 'none'",
            "object-src 'none'",
          ].join('; '),
        },
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
        referrerPolicy: {
          referrerPolicy: cloudfront.HeadersReferrerPolicy.NO_REFERRER, override: true,
        },
        strictTransportSecurity: { accessControlMaxAge: Duration.days(365), override: true },
      },
      customHeadersBehavior: {
        customHeaders: [
          { header: 'Cache-Control', value: 'no-store, max-age=0', override: true },
          // MSAL's redirect bridge must not receive a COOP header.
          { header: 'Cross-Origin-Resource-Policy', value: 'same-origin', override: true },
          {
            header: 'Permissions-Policy',
            value: 'clipboard-write=(self), clipboard-read=(), camera=(), microphone=(), geolocation=()',
            override: true,
          },
        ],
      },
    });
    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: domainName,
      domainNames: [domainName],
      certificate,
      defaultRootObject: 'index.html',
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_ALL,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      errorResponses: [403, 404].map((httpStatus) => ({ httpStatus, ttl: Duration.seconds(0) })),
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        responseHeadersPolicy: headers,
        functionAssociations: [{
          eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          function: new cloudfront.Function(this, 'StaticRoutes', {
            runtime: cloudfront.FunctionRuntime.JS_2_0,
            code: cloudfront.FunctionCode.fromFile({
              filePath: path.join(__dirname, 'static-routes.js'),
            }),
          }),
        }],
        compress: true,
      },
    });
    const publish = new deployment.BucketDeployment(this, 'Publish', {
      sources: [deployment.Source.asset(path.join(__dirname, '../build/web'))],
      exclude: ['health.md', 'api.md'],
      destinationBucket: bucket,
      distribution,
      distributionPaths: ['/*'],
      cacheControl: [deployment.CacheControl.noStore()],
    });
    const machineReferences = new deployment.BucketDeployment(this, 'PublishHealthReference', {
      sources: ['health.md', 'api.md'].map((name) => deployment.Source.data(name,
        readFileSync(path.join(__dirname, '../build/web', name), 'utf8'))),
      destinationBucket: bucket,
      prune: false,
      contentType: 'text/markdown; charset=utf-8',
      cacheControl: [deployment.CacheControl.noStore()],
      distribution,
      distributionPaths: ['/docs/health.md', '/health.md', '/docs/api.md', '/api.md'],
    });
    machineReferences.node.addDependency(publish);
    for (const [id, Record] of [['AliasIpv4', route53.ARecord], ['AliasIpv6', route53.AaaaRecord]] as const) {
      new Record(this, id, {
        zone, recordName: 'auth',
        target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution)),
      });
    }
    new CfnOutput(this, 'SiteUrl', { value: `https://${domainName}` });
  }
}
