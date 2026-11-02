# auth.dliu.com

## Current design: Microsoft API token console

The default CDK entry point now builds **AuthTokenConsole**, a static S3/CloudFront
site. It does not deploy the retired broker described below. The shared Entra
registration is configured, and Microsoft accepted assignment of an app-specific
`23:59:59` token lifetime policy. The static site and Video managed API are
deployed. Microsoft Graph read-back verified the assigned policy and its
non-organisation-default setting; actual issued-token lifetime remains unverified.

The page uses locally bundled Microsoft MSAL Browser, authorization code with
PKCE, a Microsoft sign-in popup and a dedicated `/redirect.html` bridge. Microsoft
issues the access token; the page only displays and explicitly exports it. There
is no token API, custom signing key, client secret, authentication Lambda,
database, application session or refresh-token export. Video's managed API has
passed real credential-backed read/write verification. Files, Blog and Trip
planner shared API integrations are being prepared; their Entra configuration,
deployment and live verification remain separate release requirements.

### Browser-only token handling

- MSAL token caching is explicitly disabled for access, ID and refresh tokens,
  with memory-only storage as a second boundary. Its cache is cleared immediately
  after each acquisition, including errors.
- The access token remains in the current page's JavaScript memory until Clear,
  reload/navigation, closing the page or Microsoft's actual expiry. Copying,
  saving, cancellation, failure and switching tabs do not discard it. Repeated
  exports use temporary snapshots; Clear or expiry cancels pending exports.
  Reloading cannot restore the token because there is no durable browser cache.
- The page does not store tokens in cookies, local storage, session storage,
  IndexedDB, server files, logs or a database. MSAL may use session storage for
  temporary OAuth transaction metadata; this is not a token cache.
- Copying deliberately leaves the access token in the operating-system clipboard.
  Clipboard history, browser extensions, a compromised device and screenshots
  are outside this page's control. JavaScript strings cannot be guaranteed to be
  forensically erased from browser memory.
- Saving is explicitly user-initiated: Edge/Chrome offer a native Save As dialog
  suggesting `.dliu_token`. The user selects their home folder for `~/.dliu_token`;
  the browser cannot force an absolute local path. Other browsers download that
  filename for the user to move. Chrome on macOS sanitizes the suggested name
  and can strip its leading dot; users must restore the dot in Save As. The page
  still suggests `.dliu_token` and warns after saving under another name rather
  than claiming that default-file lookup will work. The plaintext file has exactly `token=` and
  `expires_at=` lines, using Microsoft's reported UTC expiry, never an ID/refresh
  token. The site does not retain file handles, upload the file, or set POSIX
  permissions; users can apply `chmod 600 ~/.dliu_token` locally. Pending save
  prompts are cancelled on Clear, expiry or navigation; an operation already committing may
  finish and cannot be undone by clearing the page. Exported files deliberately
  persist on the user's device and are not a browser token cache.
- **Copy token file** copies the same complete `token=` / `expires_at=` record
  as Save file, including Microsoft's actual UTC expiry. **Copy token** remains
  a separate raw-bearer action. Both can be repeated while the page's token is
  valid, use temporary export snapshots, and never write a personal file or
  upload the token. Clipboard copies remain outside the page's clearing boundary.
- Clearing the page or MSAL cache does **not** revoke an issued token or end
  Microsoft's own browser sign-in session. A compromised page can steal a token
  while acquiring/displaying it, and may attempt SSO from an existing Microsoft
  session. HTTPS and one-time display do not eliminate that trust boundary.

There is no permission picker. The page automatically requests all currently
configured delegated scopes: `video.read`, `video.write`, `video.delete`,
`files.read`, `files.write`, `files.delete`, `blog.read`, `blog.write`,
`blog.delete`, `trip.read`, `trip.write` and `trip.delete`, each explicitly
prefixed with `api://<shared-api-resource-guid>/`. It does not
request Graph permissions or use the combined client/resource's own `/.default`.
Microsoft consent, assignment and API authorization still apply.

The home page focuses on Microsoft sign-in, actual expiry and repeat save/copy.
API permissions and technical explanations are kept in Docs. The page does not
decode tokens or treat browser-side metadata as API authorization. The
application API Gateway JWT authorizer validates the Microsoft signature,
issuer, audience, timestamps and route scopes using cached Microsoft public keys;
this is not an online Microsoft approval for every request. Each application's Lambda then
checks trusted gateway context, the approved client, assigned-user role and
route scope before performing the operation. Neither issues API tokens.
The generated token never reaches Auth's static hosting. Each application processes an API
request's bearer token without an application-level token cache or persistent
store; warm Lambda memory is not guaranteed to be physically wiped when the
invocation returns.

All four managed APIs require the same User-only **dliu API user** role,
`api.access`. It permits API access across the integrated sites, but it never
bypasses an exact route scope or any other token-validation/data-access check.
Only the intended API operator receives this role; ordinary organisation
members keep standard website access without API access.
Website sign-in, cookies and each site's existing data-access rules stay
unchanged. The API role is not a directory-administrator role. New scopes
or role assignments require a newly issued token and a fresh user-controlled
export; existing credential files cannot gain new claims.

### Site documentation

`/docs` and `/docs/` serve the static documentation page, using the shared
horizontal tabs: Technical architecture, Cost, Security and API.
`/docs/api` and `/docs/api/` open the shared authentication reference directly:
token acquisition/export, default `~/.dliu_token` credentials, expiry checks
and bearer-token transport. App-specific endpoints, schemas and scopes belong
to each app's API guide; those guides link here for authentication.
All sections remain readable without JavaScript; local JavaScript enhances them
with hash-linked navigation. A narrowly scoped CloudFront Function rewrites only
these four paths to `/docs.html`, leaving the OAuth bridge and all other paths
unchanged. All scripts remain same-origin.

### Public-source threat model

The Security docs describe an attacker who knows the entire repository,
browser bundle, public OAuth IDs, callback and API URLs. Source knowledge is
not a signing key and cannot grant an API assignment. Public SPA client IDs
and `azp` are not confidential-client authentication; PKCE protects the code
exchange, not an already-stolen bearer token.

A stolen all-scope `api.access` token can affect all integrated apps. Malicious
page/dependency releases, deployment-account takeover, browser extensions,
clipboard access and plaintext exports remain material risks. Current-page
memory and `no-store` limit retention; neither guarantees device safety,
forensic erasure or immediate token revocation.

Synthetic negative tests establish only the boundaries they exercise, not a
universal security guarantee or live tenant/API correctness. Before a public
push, inspect the exact commit contents and history for secrets and private
information; ignored files can still exist in history or the Git index. Rotate
exposed secrets rather than merely deleting their latest occurrence.

The online advisory check on 2026-11-02 reported
[GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)
in CDK's bundled `minimatch` dependency. This is a moderate glob-pattern
denial-of-service advisory in deployment tooling, not browser code; the review
found no attacker-controlled glob input in Auth. The audit reported no
automatic fix. Track a compatible CDK remediation and reassess before release;
do not describe the advisory audit as completely clean. The current CDK release
bundles the affected copy: an isolated npm override check still resolved that
bundled version, not the patched package. A root dependency or lockfile-only
edit is not proof of remediation; verify the copy actually resolved by CDK.

The ignore rules exclude local token/credential exports (including browser
copies without the leading dot), CDK context and account-specific output files.
`test/publication-safety.test.mjs` verifies these rules in an isolated temporary
Git repository. This is preventive protection, not a secret scanner: arbitrary
renamed files, tracked content and remote history still need review.

The home and Docs headers expose one labeled Docs button with a decorative
document icon. The Docs page marks it current; the home page does not. The
existing footer shortcut is preserved, without adding duplicate header items.

### Shared dliu.com appearance

The home page, documentation (including `/docs/api`) and Microsoft popup bridge
at `/redirect.html` load
[`dl.css`](https://files.dliu.com/dliu.com/ui/v1/dl.css) first and use the shared
`dl-header`, blue buttons and `dl-footer`, in the light theme. Auth's original
blue lock (`/logo.svg`) is both the favicon and the top-left logo, joined with
the app name in one home link. The shared DL logo starts the footer and links
to `https://dliu.com`, followed by the dliu.com and Docs links.
Docs additionally load
[`dl-docs.css`](https://files.dliu.com/dliu.com/ui/v1/dl-docs.css) and use
`dl-tabs`, `dl-docs` and the shared diagram markup. No shared JavaScript is loaded.
`web/style.css` contains only token-console layout, using the shared `--dl-*`
variables; the former local docs stylesheet is removed. The original Auth SVG
logo is retained as an app asset, not a copied shared icon.

Follow the [shared UI guide](https://files.dliu.com/dliu.com/README.md) for future
page changes. The CSP permits shared styles only beneath
`https://files.dliu.com/dliu.com/ui/` and images only beneath
`https://files.dliu.com/dliu.com/`, in addition to the existing same-origin sources.
Script, connection, framing, form and other directives are unchanged. Shared
assets are public static CSS/images, not destinations for tokens or configuration;
the existing no-referrer policy remains in place. Token acquisition, memory-only
handling and explicit export behavior are unchanged.

`test/shared-ui.test.mjs` guards every page, generated output, component ownership
and the local-only script entries. Infrastructure tests check the exact CSP.
After a reviewed UI release, check a desktop and a touch viewport no wider than
400 px, then run the live audit from the shared-resources checkout:

```sh
node ../shared-resources/scripts/audit.mjs auth.dliu.com
```

### Local build and validation

```sh
npm ci
npm test
CDK_DEFAULT_ACCOUNT=000000000000 CDK_DEFAULT_REGION=eu-west-1 npm run synth -- --no-lookups
```

The synthetic account is for offline synthesis only. All legacy broker source
and tests are retained for recovery, but `cdk.json` points only to the new static
site. Do not manually deploy `bin/authenticate.ts` or run `scripts/set-secrets.sh`.

An unconfigured local build renders a setup error and disables sign-in. A release
requires these non-secret values in the local environment, never committed:

```sh
AUTH_TENANT_ID=<directory-guid>
AUTH_CLIENT_ID=<browser-spa-client-guid>
AUTH_API_AUDIENCE=<shared-api-resource-guid>
```

The release build writes only those three IDs to ignored `build/web/config.json`.
**Browser OAuth necessarily makes these IDs public to visitors. They are public
identifiers, not credentials.** No real IDs or personal/account details belong
in tracked files. Deployment refuses missing or malformed configuration.

Before an explicitly approved deployment, confirm the configuration below.
Checks requiring the published console or gateway follow deployment:

1. Reuse the existing single-tenant **dliu API** registration as both resource and
   browser client; set `AUTH_CLIENT_ID` and `AUTH_API_AUDIENCE` to that same
   application ID. Add the exact **Single-page application** redirect
   `https://auth.dliu.com/redirect.html`. Do not create another SPA registration.
   The native localhost CLI callback is not a substitute. No client secret,
   implicit grant or device-code flow is used.
2. Expose and configure the exact delegated scopes listed above on the shared
   `dliu API` resource. Grant admin consent separately; preserve resource
   assignment-required. Use the single User-only **dliu API user** role
   (`api.access`) for all four APIs. Preserve the existing intended user's role
   assignment when migrating the former Video-specific role; do not assign API
   access to other website users or grant directory roles.
   Verify assigned accounts satisfy the intended `dliu.com` member restriction.
   Obtain a fresh token with the new role and all requested scopes for the
   coordinated cutover. Existing exported tokens do not gain the new role claim.
   Verify combined resource/client token issuance with a real gateway request;
   synthetic compatibility tests do not establish live issuance.
3. The resource's assigned `23:59:59` token lifetime policy and its
   non-organisation-default setting have been verified through Microsoft Graph.
   After publication, verify the lifetime of a newly issued token; policy
   read-back does not establish actual token duration. This is not a front-end
   setting; existing tokens cannot be extended, and the UI always displays
   Microsoft's actual expiry.
4. Configure each API's approved client to this SPA and deploy/verify its
   managed endpoint independently. Website cookie authentication stays
   unchanged. The page itself never calls the Video API or needs API CORS.
5. Confirm `auth.dliu.com` is not owned by another stack, then review the
   **AuthTokenConsole** CDK diff. The new stack uses the existing `MainDomain`
   and `MainHostedZoneId` exports in eu-west-1. It must not reuse/delete the
   retired broker's retained DynamoDB table or SSM values.

Only after those approvals/configuration, `npm run deploy` builds the configured
static site and deploys the new stack. The S3 origin is private behind CloudFront
OAC; HTTP redirects to HTTPS. Responses are `no-store`, request logging is off,
framing and inline/third-party scripts are blocked by CSP, and the callback serves
only Microsoft's locally bundled bridge. The site has no service worker,
analytics, arbitrary redirect destination or user-generated HTML.

CloudFront uses `PRICE_CLASS_ALL` and `HTTP2_AND_3` so edge locations in Europe
and Asia are eligible and supported clients can negotiate HTTP/3. HTTPS remains
required, with HTTP/2 and older-client fallback handled by CloudFront. The small
authentication console deliberately keeps caching disabled and `no-store` for
all assets, including its unversioned scripts, configuration and OAuth bridge;
this delivery change does not add public-cache exceptions. Cost depends on
regional traffic and the account's remaining applicable allowance, not a
guaranteed zero-cost estimate.

### Automatic cache-clearing decision

Auth is excluded from the one-day automatic cache-clearing policy. Its
CloudFront cache policy is `CACHING_DISABLED`, all responses override
`Cache-Control` with `no-store, max-age=0`, and error-cache TTLs are zero.
There is no edge-cache retention period to expire, so no scheduled cache-clearing
job or one-day cache lifetime is needed. Normal deployments still invalidate
`/*` to publish releases; that is separate from periodic clearing.

The private S3 bucket contains the site's source assets, not an expendable
cache or user tokens. Keep those assets available: do not add a one-day S3
object-expiration rule or delete the bucket's contents as cache cleanup.
This decision does not change current-page token memory, explicit user exports
or Microsoft's token expiry and revocation rules.

Do not publish the expanded scope request until all requested permissions exist
and are consented in Entra; otherwise token acquisition can fail for existing
Video users. Each app owner publishes only its own reviewed API and docs, with
the real managed API base URL and a required link to Auth's shared API guide.
Retiring Blog's old API-token mechanism must not delete historical token-table
data or change website sign-in.

Live Microsoft sign-in, actual token lifetime, assigned/unassigned account
behavior and each new API remain separate live-verification requirements.
Local tests use synthetic tokens and never prove these tenant/cloud properties.

## Retired broker integration (historical reference only)

On 2026-10-28, Files and Video were restored and deployed with their original,
direct Microsoft Entra sign-in integrations. Neither application depends on this
broker. Their existing Entra registrations and app-specific configuration remain
in use.

This source is preserved for reference and recovery. The implementation and setup
instructions below describe the retired design, not the current authentication
architecture. Do not deploy this stack or run its credential uploader unless
reintroducing the broker is explicitly intended.

## Historical design

A small, serverless **login broker**, not an OpenID Connect provider. Microsoft
Entra handles passwords, account policy and MFA. The broker validates Microsoft's
ID token, keeps an opaque central session, and hands a one-use authorization code
to each registered application. Applications keep their own sessions and secrets.
There is no discovery endpoint, broker JWT, shared signing key, refresh token or
Microsoft token delivered to applications.

Only these clients are registered:

| `client_id` | Exact `redirect_uri` |
|---|---|
| `video` | `https://video.dliu.com/auth/callback` |
| `files` | `https://files.dliu.com/auth/callback` |

No wildcards, extra query strings, trailing slashes, HTTP redirects or arbitrary
subdomains are accepted. Blog and traffic-monitor are not clients. This repository
does not modify or deploy any other application.

## Local development and validation

Use Node.js 22+ and npm:

```sh
npm ci
npm test
CDK_DEFAULT_ACCOUNT=000000000000 CDK_DEFAULT_REGION=eu-west-1 npm run synth -- --no-lookups
```

The account above is a synthetic offline-synthesis placeholder. Do not deploy it.
`npm test` typechecks CDK, bundles all Lambda dependencies and runs Node's test
runner, including an offline infrastructure synthesis/assertion test. Tests use
generated RSA keys, a memory store and AWS SDK command stubs, not real Microsoft
or AWS credentials. They exercise claims/signatures, state/nonce, both PKCE legs,
exact client registration, expiry, concurrent/replayed handoffs, logout, hashed
POSTs, and IAM/OAC/cache/storage infrastructure. DynamoDB transactions are asserted
at the SDK command boundary; tests do not claim a live DynamoDB integration.

Source layout:

| Path | Purpose |
|---|---|
| `lambda/broker.js` | HTTP routes, opaque sessions, handoff and CSRF checks |
| `lambda/entra.js` | Microsoft code exchange and `jose` ID token validation |
| `lambda/store.js` | DynamoDB conditional/transactional storage |
| `lambda/config.js` | Fixed client registry and cached SSM credentials |
| `lambda/logout-page.js` | Same-origin, SHA256-hashed logout form submission |
| `lib/authenticate-stack.ts`, `bin/authenticate.ts` | CDK stack and eu-west-1 entry point |
| `scripts/set-secrets.sh` | Interactive uploader; secret values do not enter process arguments |
| `test/` | Behavior, token, storage, config, UI-script and CDK tests |

`build/`, `cdk.out/`, local environment files and dependencies are ignored.

## Configuration and deployment prerequisites

No deployment or Entra registration creation is performed by local tests.
The operator creates a **new, single-tenant** Entra app registration:

1. Configure a **Web**, confidential-client authorization-code flow. Register
   `https://auth.dliu.com/auth/callback` as the sign-in redirect URI and
   `https://auth.dliu.com/` as an additional Web redirect URI for the explicit
   Microsoft sign-out return. Do not add the pilot apps' callbacks to Entra.
2. Obtain the directory tenant UUID, application client UUID and a client secret
   **value**, not the secret ID. Do not enable implicit grants or public-client
   flows. No Graph API permissions or consumer application secrets are needed.
3. Configure user assignment/Conditional Access/MFA in Entra as appropriate.
   The broker additionally requires the configured tenant and a `dliu.com`
   `preferred_username` or `email` claim. This check is not a substitute for
   Entra assignment or MFA policy. No ordinary sign-in forces `prompt=select_account`.
4. From this repository, upload the values using the retained interactive script:

   ```sh
   AWS_REGION=eu-west-1 bash scripts/set-secrets.sh
   ```

   The fixed SSM paths are `/authenticate/entra-tenant-id` (String),
   `/authenticate/entra-client-id` (String), and
   `/authenticate/entra-client-secret` (**SecureString**). IDs must be UUIDs.
   Credentials are loaded with decryption and cached for at most five minutes.
   Expired/invalid configuration fails closed; no environment-variable secret
   fallback exists. The script uses the AWS-managed SSM KMS key; a custom key
   would need an explicit additional key grant.
5. Use the existing AWS environment in **eu-west-1**, with CloudFormation exports
   `MainDomain` (`dliu.com`) and `MainHostedZoneId` for its Route 53 public zone.
   Bootstrap CDK if necessary. Deployment credentials need the normal stack,
   Lambda, DynamoDB, IAM, CloudFront, Route 53 and ACM permissions; the DNS-validated
   CloudFront certificate is requested in **us-east-1**, matching existing site
   infrastructure. Confirm `auth.dliu.com` is not owned by another stack before
   deploying.

An operator can then run `npm run synth`, review the template/diff, and
**explicitly choose** `npm run deploy`. Never put credentials, account IDs or
identity data in source, context files or command arguments. Dependency builds
bundle runtime SDK packages; the Lambda does not rely on an unpinned built-in SDK.

The stack is pay-per-use: CloudFront, an IAM-protected Lambda function URL and an
on-demand DynamoDB table. CloudFront OAC uses SigV4 and both required
`lambda:InvokeFunctionUrl` and `lambda:InvokeFunction` permissions restricted to
this distribution. Direct unsigned function-URL access fails. Both CDN and origin
require HTTPS. All broker responses are `no-store`; CDN error caching is disabled.
Requests, cookie values, URLs/query strings, bodies and identity claims are not
logged by application code. CDN access logging is deliberately not enabled because
login query strings carry one-use credentials. Keep that property if adding
observability; use sanitized counts/error categories rather than raw requests.

## Application integration contract

### 1. Begin in the application

The application backend creates a cryptographically random `state` and PKCE
`code_verifier`. Store them in a one-use, short-lived, browser-bound server
transaction (or an authenticated/encrypted transient cookie), with an
application-local, validated return path. Use a host-only `Secure`, `HttpOnly`,
`SameSite=Lax` cookie; do not share cookies between applications.

`state` must be **43-128 base64url characters** (`A-Z a-z 0-9 _ -`), generated with
at least 32 random bytes. `code_verifier` is **43-128 RFC 7636 unreserved ASCII
characters** (`A-Z a-z 0-9 - . _ ~`) with at least 256 bits of randomness.
Compute `code_challenge = base64url(SHA256(ASCII(code_verifier)))`, without padding.

Redirect the browser with a GET to:

```text
https://auth.dliu.com/auth/authorize
  ?client_id=video
  &redirect_uri=https%3A%2F%2Fvideo.dliu.com%2Fauth%2Fcallback
  &state=<application-state>
  &code_challenge=<43-character-SHA256-base64url>
  &code_challenge_method=S256
```

Send exactly those five query parameters, once each. Use `files` and its exact
callback for Files. The broker returns **303** to Microsoft if needed, or directly
to the application when its central browser session is still live.

The broker stores Microsoft's separate state, nonce and verifier server-side in a
10-minute, one-use transaction bound to the `__Host-auth_flow` cookie. On callback
it validates state, consumes that transaction, exchanges the Microsoft code with
PKCE, and validates RS256 signature/JWKS, issuer, exact audience, tenant, nonce,
required timestamps, v2 token version, subject and object UUID. Microsoft timestamp
validation allows 60 seconds of clock tolerance; broker sessions and handoff codes
have no expiry grace period. Untrusted JWT key URLs are not used.

Only the most recent unfinished Microsoft login in a browser is retained by its
flow cookie. Starting another flow replaces that cookie; the earlier tab must
retry. Already completed central sessions work across both applications.

### 2. Application callback

On success the broker redirects **303** to the exact registered callback:

```text
https://video.dliu.com/auth/callback?code=<opaque-code>&state=<original-state>
```

No identity, ID/access tokens, session cookies or keys appear in the URL.
`code` is a 43-character opaque base64url random value. Its expiry is the earlier
of **60 seconds after issuance** and the central session's absolute expiry.
Failures stay on the broker; they never redirect to an unvalidated client or
reflect Microsoft's error descriptions.

The application must verify browser-bound state, **atomically consume** its
transient transaction, then exchange the code from its backend. Do not accept
callback identity data, trust a browser-provided verifier, or redirect to an
unvalidated return path. Serve callback responses with `Cache-Control: no-store`
and `Referrer-Policy: no-referrer`, without third-party resources or request logging.

### 3. Backend exchange

`POST https://auth.dliu.com/auth/exchange` is **backend-to-backend only**.
There is no CORS API, and requests containing `Origin` or `Sec-Fetch-Site` are
rejected. No Entra secret, client password, bearer token or AWS credentials are
sent by the consumer. Possession of the verifier proves the initiating application
transaction.

Request content type is `application/json`, at most 8 KiB:

```json
{
  "code": "<opaque-code>",
  "client_id": "video",
  "redirect_uri": "https://video.dliu.com/auth/callback",
  "code_verifier": "<original-application-verifier>"
}
```

**Required CloudFront OAC detail:** every POST must include
`x-amz-content-sha256`, the lowercase hexadecimal SHA256 of the **exact UTF-8 bytes
sent as the body**. CloudFront supplies the SigV4 signature; consumers do not.
Do not separately serialize the body for hashing and transmission:

```js
import { createHash } from 'node:crypto';

const body = JSON.stringify(payload);
const response = await fetch('https://auth.dliu.com/auth/exchange', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-amz-content-sha256': createHash('sha256').update(body).digest('hex'),
  },
  body,
  redirect: 'error',
  signal: AbortSignal.timeout(10000),
});
```

See [AWS's Lambda URL OAC payload requirement](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-lambda.html).

Success is HTTP **200** with exactly this shape (example placeholders):

```json
{
  "user": {
    "sub": "<lowercase-tenant-UUID>:<lowercase-object-UUID>",
    "tenant_id": "<lowercase-tenant-UUID>",
    "oid": "<lowercase-object-UUID>",
    "email": "user@dliu.com",
    "name": "Example User"
  },
  "session_expires_at": 1800043200
}
```

`tenant_id` and `oid` are UUID strings. `sub` is exactly `tenant_id + ':' + oid`,
stable across consumers for that tenant/object; it is not Microsoft's pairwise
`sub`. `email` is always a lowercase, nonempty string, at most **254 characters**,
with an exact `@dliu.com` suffix. It is an Entra sign-in/account claim, not proof
that a mailbox receives email. `name` is always a nonempty string, at most
**256 characters**, with surrounding whitespace removed; absent/blank names fall
back to the accepted email claim's original spelling. Escape both fields when
rendering. Consumers can use their own stricter authorization rules.

`session_expires_at` is an integer **Unix timestamp in seconds**, strictly in the
future when accepted and no more than 43,200 seconds ahead. Reject malformed or
already-expired responses. Create an application-owned session whose absolute
expiry is **no later** than this timestamp; never restart a fresh 12-hour window.
Near-expiry logins can legitimately leave very little time. No response cookies or
Microsoft/broker tokens are returned.

The code is bound to the exact client, redirect, SHA256 verifier challenge and
live central session. DynamoDB atomically checks session liveness and deletes the
code, so only one concurrent exchange succeeds. Incorrect verifiers/bindings do
not consume it. Retrying after a lost successful response cannot recover identity;
restart authorization instead.

Common JSON errors are `{ "error": "<code>" }`, always `no-store`:

| HTTP | Code | Meaning |
|---|---|---|
| 400 | `invalid_client` | Unknown client or non-exact callback |
| 400 | `invalid_authorization_request` | Missing/invalid state or S256 parameters |
| 400 | `invalid_grant` | Bad, expired, replayed or mismatched code/verifier; central session ended |
| 400 | `invalid_payload_hash` | Missing/mismatched SHA256 POST header |
| 400 | `invalid_login_state` | Missing/expired/mismatched Microsoft browser transaction |
| 400 | `duplicate_parameter`, `invalid_parameters`, `invalid_body`, `invalid_json` | Malformed request |
| 401 | `session_expired` | Central session ended during handoff issuance |
| 403 | `backchannel_required` | Browser exchange rejected |
| 403 | `invalid_origin`, `invalid_csrf` | Logout protection rejected |
| 413 | `body_too_large` | Body exceeds 8 KiB |
| 415 | `unsupported_media_type` | Wrong request content type |
| 503 | `service_unavailable` | Configuration, storage or upstream service unavailable |

Microsoft denial/identity rejection produces a generic HTTP 401 **HTML** page,
never reflected upstream details. CloudFront/Lambda can independently return
non-JSON errors, e.g. missing OAC payload headers; consumers must check status,
shape and content type and never treat an error as authenticated.

## Sessions, account page and logout

`GET /` is a minimal account page. `GET /auth/login` signs in to the broker alone
and returns to `/`; an existing session is reused. Microsoft authentication creates
a 32-byte random central session, server-side only, with an absolute **12-hour**
lifetime. There is no sliding refresh:

```text
__Host-auth_session=<43-character-opaque-value>; Path=/; Max-Age=43200; Secure; HttpOnly; SameSite=Lax
__Host-auth_flow=<43-character-opaque-value>; Path=/; Max-Age=600; Secure; HttpOnly; SameSite=Lax
```

Neither cookie has a `Domain` attribute. Session/flow/code lookup keys store SHA256
digests, not browser bearer values. Session records contain normalized identity,
expiry and a CSRF nonce; flow records contain the short-lived Microsoft verifier,
nonce and application continuation. No Microsoft access/refresh/ID tokens are
stored. DynamoDB TTL is cleanup only: every read/conditional consumption enforces
expiry explicitly, even when expired rows have not been deleted.

There are three deliberately different sign-out scopes:

| Action | Exact integration | Effect |
|---|---|---|
| Local application | Application's own same-origin CSRF-protected POST | Clears only that application's cookies/session. No central or Microsoft action. |
| Central broker | First clear the application's local session; then navigate to `https://auth.dliu.com/auth/logout?client_id=video` (or `files`) | Shows a confirmation page. The user explicitly submits central sign-out; broker session and current pending browser flow are deleted and both broker cookies expire. Then returns to the fixed application root. Without `client_id`, returns to `/`. |
| Microsoft browser session | Choose **Also sign out of Microsoft in this browser** on that same confirmation page | Clears central state first, then navigates to the tenant's Microsoft `/oauth2/v2.0/logout` with fixed `post_logout_redirect_uri=https://auth.dliu.com/`. May affect other Microsoft web apps; Microsoft controls completion. |

`GET /auth/logout` **never** logs anyone out. It accepts only optional exact
`client_id`; there is no arbitrary `return_to` or `redirect_uri`. An already-ended
central session shows a signed-out page without changing anything.

The broker's own confirmation page uses `/logout.js`: it computes the OAC payload
hash and sends `POST /auth/logout`, content type
`application/x-www-form-urlencoded`, with `csrf=<session-nonce>`,
optional `client_id`, and `mode=central` (default) or `mode=microsoft`. The broker
requires exact `Origin: https://auth.dliu.com`, the active HttpOnly session cookie,
the session's CSRF value and the SHA256 header. Success is **200 JSON**
`{"redirect_to":"<fixed-next-location>"}` plus expired cookies; only then does the
page navigate. JavaScript is required for this secure hashed POST. Consumers do
not fetch this endpoint, copy central cookies, synthesize CSRF values or invoke
Microsoft logout silently.

**Revocation boundary:** central logout stops central reuse and outstanding code
exchange immediately. It does **not** revoke already-issued independent local
application sessions. Clearing one application does not clear another.
Microsoft sign-out is not a guarantee of global token/session revocation, and
account disablement/Conditional Access changes are not continuously checked by
this broker. Existing broker/app sessions can persist until their absolute expiry.
This intentionally small protocol provides no logout webhook, introspection,
front-channel logout, refresh or Entra continuous-access enforcement.

## Operational checks after an explicitly authorized deployment

Verify a real Microsoft round trip, identity/tenant/domain rejection, each pilot's
state/PKCE exchange, reuse of the central session in the second pilot, expiry, and
each logout scope. Check HTTPS and unsigned function-URL denial. Do not paste
callback URLs, cookies, code/verifier pairs or identity payloads into public logs.
Local tests and synthesis alone do not prove DNS, OAC invocation, SSM/KMS access,
Microsoft registration, MFA policy or a successful live login.

The DynamoDB table has deletion protection and a retain policy. Removing a stack
does not delete retained identity/session records; TTL eventually cleans them up.
Secret rotation uses the same uploader and takes effect on cache refresh.
