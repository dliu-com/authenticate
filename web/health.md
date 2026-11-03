# Auth anonymous guest checks

This is the complete technical reference for testing https://auth.dliu.com as
an anonymous guest. The human version is https://auth.dliu.com/docs/health.
It is separate from https://auth.dliu.com/docs/api, which documents credentials
for signed-in managed APIs. Never acquire or use a token for these checks.

## Functions

| Key | Name | Critical |
| --- | --- | --- |
| pages | Token page | yes |
| runtime | Page controls | yes |
| configuration | Sign-in setup | yes |
| signin | Sign-in return page | yes |
| documentation | Help pages | no |

- `pages`: visitors can open the token page; failure prevents starting.
- `runtime`: the browser program is available; failure prevents the controls running.
- `configuration`: public sign-in setup is available; failure disables sign-in.
- `signin`: the popup return page and program are available; failure can prevent completion.
- `documentation`: help is available; failure alone does not establish an issuance outage.

Flow: status.dliu.com as a guest -> public pages, setup and script availability ->
available / degraded / down. This is not a completed Microsoft sign-in test.

## Guest checks

| Function | Method | URL | Status | Media type | Body marker or rule | Slow ms |
| --- | --- | --- | --- | --- | --- | --- |
| pages | GET | https://auth.dliu.com/ | 200 | text/html | Sign in. Get your token. | 2000 |
| runtime | HEAD | https://auth.dliu.com/app.js | 200 | text/javascript | - | 2000 |
| configuration | GET | https://auth.dliu.com/config.json | 200 | application/json | configured=true | 2000 |
| signin | GET | https://auth.dliu.com/redirect.html | 200 | text/html | src="/redirect.js" | 2000 |
| signin | HEAD | https://auth.dliu.com/redirect.js | 200 | text/javascript | - | 2000 |
| documentation | HEAD | https://auth.dliu.com/docs | 200 | text/html | - | 2000 |

Match the media type before `;`; charset parameters are permitted. GET text
markers are literal substrings. `configured=true` means parse JSON and require
the boolean `configured` to equal `true`, not a textual truthy value. Also require
GUID-shaped string `tenantId`, `clientId` and `audience`, with `clientId === audience`.
These are public OAuth identifiers, not secrets; do not log their values.
This tests public configuration shape, not Entra consent or role assignment.
HEAD has no body marker. Do not follow redirects: these URLs should return 200.

## Health endpoint

There is **no `/health` endpoint**. Auth has no application backend: S3 serves
static assets through CloudFront and an edge request-rewrite function.
Deployment helpers are not a token-processing backend. Do not invent a health
JSON response, add a Lambda, or call another app's authenticated API to fill it.

## Timing, caching and budget

- Every 15 minutes, request sequentially as
  `dliu-status-bot/1.0 (+https://status.dliu.com/docs)`.
- Five-second timeout per request; 64 KiB maximum on GET bodies.
- Retry a failed check once in the same run. A function is degraded after one
  failed run and down after two consecutive failed runs. More than 2000 ms is
  a warning, not proof of total failure.
- `Cache-Control: no-store, max-age=0` and disabled CloudFront caching are
  deliberate. Do not enable caching or introduce a cached `/health` route.
- Use HEAD for large scripts and documentation instead of downloading them.
  The six scheduled site checks add no application backend. The Status app
  owns the overall under-$1/month budget; free allowances are not a guarantee.
- The human page and this Markdown are reference material, not extra checks
  that must be fetched on every scheduled run. Compile the check table into
  the Status app's configuration.

## Optional Microsoft public discovery

This is an optional upstream observation, not one of the six scheduled site checks.
Read `tenantId` from the validated public config and construct:

`https://login.microsoftonline.com/<tenantId>/v2.0/.well-known/openid-configuration`

Use an anonymous GET, no redirects and the same timeout/body limit.
Allow only `login.microsoftonline.com` with the GUID-shaped tenant path.
Expect 200 `application/json`, `issuer` equal to
`https://login.microsoftonline.com/<tenantId>/v2.0`, and an
`authorization_endpoint` on `login.microsoftonline.com`.
No Graph request, account credentials or token are required.
Discovery availability does not prove consent, assignment, MFA, code redemption
or successful token issuance for a particular account. Do not log identifier values.

## Not tested

Real Microsoft sign-in, MFA, conditional access, consent and API assignment;
token generation, actual issued lifetime, clipboard or filesystem exports;
other applications' API authorization or mutations. A guest cannot prove these.

## Safety rules

GET and HEAD only. No cookies, Authorization header, request bodies, login,
token acquisition, writes, load tests, S3 listing, Entra/AWS access or user-data
operations. Never change content. A monitoring failure is not permission to
broaden access or silently substitute an authenticated test.
