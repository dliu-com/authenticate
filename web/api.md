# Shared dliu.com API authentication

This is the complete authentication reference for clients and AI agents using
dliu.com managed APIs. The human overview is https://auth.dliu.com/docs#api.
The old `/docs/api` and `/docs/api/` URLs return 301 with `Location: /docs#api`.
This file is served at https://auth.dliu.com/docs/api.md as
`text/markdown; charset=utf-8`, with `Cache-Control: no-store, max-age=0`.

Auth is a static Microsoft token console, not an API backend or custom issuer.
It has no token endpoint, session database, client secret or refresh-token export.
Application API guides own their API base URLs, endpoints, payloads, response
schemas, workflows, errors and operation-specific permissions. Read the
application's guide AND this authentication reference before implementing a client.
Anonymous monitoring is separate: https://auth.dliu.com/docs/health.md.

## Obtain a token

1. Open https://auth.dliu.com/ and select **Sign in with Microsoft**.
2. Use a Microsoft account assigned the required API access. Microsoft handles
   sign-in, MFA, application assignment and consent.
3. All integrated site API scopes are requested automatically; there is no
   permission picker. Check the actual expiry displayed after sign-in.
4. Choose **Save file**, or **Copy token file** and save the complete record
   yourself. Export again while valid if necessary.
5. Use only a trusted HTTPS managed API URL and route from the application guide.
   Do not assume the website origin hosts its API.
6. On expiry, return to Auth for a new token and save it again. Clients cannot
   renew a credential by editing its expiry.

The page uses locally bundled Microsoft MSAL Browser, authorization code with
PKCE, a Microsoft popup and the exact SPA callback
`https://auth.dliu.com/redirect.html`. The same single-tenant dliu API registration
is the resource audience and approved public SPA client. Public OAuth IDs are not
credentials. Auth's static hosting never receives the acquired access token.
Temporary OAuth transaction metadata is distinct from a token cache.

## One API user role, site-specific scopes

All four sites require the shared User-only **dliu API user** role, whose token
value is `api.access`. Assignment permits API access across the integrated sites,
but the role never bypasses scope checks, token validation or an application's
existing data-access rules. It is not a Microsoft directory-administrator role.
Assign it only to the intended API operator, not to every organisation member.

| Application | Requested delegated scopes | Application guide |
| --- | --- | --- |
| Video | `video.read`, `video.write`, `video.delete` | https://video.dliu.com/docs/api |
| Files | `files.read`, `files.write`, `files.delete` | https://files.dliu.com/docs/api |
| Blog | `blog.read`, `blog.write`, `blog.delete` | https://blog.dliu.com/docs/api |
| Trip planner | `trip.read`, `trip.write`, `trip.delete` | https://plan.dliu.com/docs/api |

Each scope is requested as `api://<shared-api-resource-guid>/<scope>`. The console
does not request Microsoft Graph management permissions or the combined
client/resource's own `/.default`. The application's guide defines the exact
scope for each operation and additional data-access restrictions.

API access does not replace website sign-in, cookies or sharing links. Other
organisation users can use standard webpages without this role; a website
session never substitutes for the API role. Retired site-specific roles alone
do not authorise the managed APIs. Only configured and deployed APIs are usable.

After an administrator adds an integration, scope or assignment, obtain and export
a NEW token. An already-exported token does not acquire new claims. Do not change
Entra registration, consent or role assignments without explicit authorisation.

The application gateway validates Microsoft's signature, issuer, audience,
timestamps and route scope. Application code additionally checks trusted gateway
context, the approved client, assigned-user role and exact operation scope before
applying its data-access rules. Local JWT decoding is not signature authorisation.
Knowledge of a public client ID cannot forge a token, but a stolen valid bearer
can exercise its granted permissions, including destructive operations.

## Saving a local token file

The default path is `~/.dliu_token` on the machine running the client or agent.
The file is UTF-8 plain text containing exactly these two fields:

```text
token=<Microsoft-access-token>
expires_at=<actual-expiry-in-UTC>
```

`expires_at` is the actual ISO UTC expiry from Microsoft's response, ending in
`Z`; do not assume 24 hours or extend it locally. A token lifetime policy has
been assigned, but actual issued-token lifetime remains unverified. The file
contains no ID token, refresh token or password.

In supported desktop Edge/Chrome, **Save file** opens a native Save As dialog
suggesting `.dliu_token`. Choose your home folder. A website cannot silently
choose/write your home directory. Auth does not upload the token or retain a file
handle. Chrome on macOS sanitizes suggested filenames and can remove the leading
dot: type it back into Save As. `dliu_token` is NOT the default `.dliu_token`.
The page warns if the actual saved name differs.

Browsers without the Save As API show **Download file** instead; move the download
to your home folder and restore the exact name, including its leading dot.
**Copy token file** copies the complete two-field record, including the actual
UTC expiry, for you to paste as plain text. Copying is not saving.

Save file and Copy token file are the only token-panel actions. Saving, copying,
cancellation or failure leaves a valid token available for repeated exports.
It is removed from the current page on expiry, another sign-in, navigation/reload
or page close; reloading cannot restore it. A new sign-in, expiry or leaving the
page cancels a save still waiting for a destination. An operation already
committing to disk may finish; clearing the page cannot undo it.

**The file is plaintext.** Keep it private, outside source control, chat and logs.
The browser controls filesystem permissions; on macOS/Linux you can restrict
access locally:

```sh
chmod 600 ~/.dliu_token
```

Clearing the page does not delete the exported file, clear clipboard history,
revoke the token or end Microsoft's browser session. Extensions and compromised
devices can steal credentials; memory handling cannot guarantee forensic erasure.

## Default credentials for clients and agents

Application requesters reread credentials for EVERY request; do not retain a
bearer in an application-global cache. Parse the credential file as data, never
`source`/execute it, and never print the token or include it in an exception.
Reject missing, duplicate, unknown or malformed fields and expired credentials
before sending any request. Raw-token-only files need a new Save file export.

The default lookup is `~/.dliu_token` for the process user's home directory.
An explicit access-token override takes precedence; an empty/invalid explicit
override MUST fail rather than falling back to another source. An optional
token-file override must be an absolute path: use `$HOME/.dliu_token`, not a
literal `~/` string in that variable. A bad selected file must not cause fallback.

| Requester | Access-token override | Token-file override |
| --- | --- | --- |
| Video | `VIDEO_API_ACCESS_TOKEN` | `VIDEO_API_TOKEN_FILE` |
| Files | `FILES_API_ACCESS_TOKEN` | `FILES_API_TOKEN_FILE` |
| Blog | `BLOG_API_ACCESS_TOKEN` | `BLOG_API_TOKEN_FILE` |
| Trip planner | `TRIP_API_ACCESS_TOKEN` | Uses the default file; its API guide documents supported overrides. |

These variables configure local requesters, not Auth. Overrides are optional.
Saved-file mode checks both `expires_at` and JWT `exp`, using the EARLIER expiry;
reject invalid metadata and fail if either expiry has passed. These checks are
not cryptographic token verification: the managed API still validates Microsoft.
Explicit access-token mode leaves expiry enforcement to the gateway and must not
silently try another credential source.

Video alone retains a separate native-client mode selected by explicit native
tenant/client/audience settings. Leave these unset for browser-saved credentials;
that native client is not approved by the current browser-client API guard.
Files, Blog and Trip planner requesters do not acquire Microsoft credentials.

A remote/chat-only agent cannot automatically read your Mac's file. Use only the
remote tool's approved secret configuration, never chat or an upload to Auth.
Having credentials is not authorisation to perform tasks: the user must explicitly
authorise the intended operation, particularly writes and deletions.

## Sending the token

Send the access token ONLY to the trusted application's HTTPS managed API, using
a client's secret bearer-token field or this header:

```http
GET /<application-route> HTTP/1.1
Host: <managed-api-host>
Authorization: Bearer <access-token>
```

Do not use an ID token, password or refresh token. Never put credentials in a URL,
source control, chat, logs, screenshots or verbose HTTP traces. Do not forward
bearer credentials through arbitrary redirects or to untrusted origins. Use the
application guide for the API address, routes, methods, schemas and errors.

### Read-only curl request from the default file

Set `API_REQUEST_URL` to a trusted read-only HTTPS endpoint from the application
guide. This example validates the saved record locally and passes the header to
curl on stdin, not command arguments. Only the API response is printed; it does
not follow redirects, acquire credentials or run any write. It deliberately uses
the default file, not the application-specific override variables above.

```sh
API_REQUEST_URL='https://<trusted-api-host>/<read-only-route>'
python3 - "$API_REQUEST_URL" <<'PY'
import base64, datetime, json, re, subprocess, sys
from pathlib import Path
from urllib.parse import urlsplit

def fail(message):
    raise SystemExit(message)

try:
    lines = (Path.home() / ".dliu_token").read_text(encoding="utf-8").splitlines()
except (OSError, UnicodeError):
    fail("Cannot read ~/.dliu_token. Use Save file in Auth.")
fields = {}
for line in lines:
    if not line:
        continue
    key, separator, value = line.partition("=")
    if not separator or key not in ("token", "expires_at") or key in fields:
        fail("Malformed credential file. Export it again from Auth.")
    fields[key] = value
if set(fields) != {"token", "expires_at"}:
    fail("The file must contain token= and expires_at= fields.")
token = fields["token"]
if not re.fullmatch(r"[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+", token):
    fail("Invalid access-token format.")
try:
    part = token.split(".")[1]
    payload = json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)))
    token_expiry = payload["exp"]
    if isinstance(token_expiry, bool) or not isinstance(token_expiry, int) or token_expiry <= 0:
        raise ValueError()
    saved = fields["expires_at"]
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z", saved):
        raise ValueError()
    saved_expiry = datetime.datetime.fromisoformat(saved.replace("Z", "+00:00")).timestamp()
except (ValueError, KeyError, TypeError):
    fail("Invalid token or expiry metadata. Export the file again.")
now = datetime.datetime.now(datetime.timezone.utc).timestamp()
if now >= min(saved_expiry, token_expiry):
    fail("Token expired. Sign in to Auth and save a new file.")
url = urlsplit(sys.argv[1])
if url.scheme != "https" or not url.hostname or url.username or url.password or url.fragment:
    fail("Use a trusted HTTPS API URL without URL credentials.")
config = 'header = "Authorization: Bearer ' + token + '"\n'
subprocess.run(["curl", "--fail-with-body", "--silent", "--show-error",
                "--config", "-", sys.argv[1]], input=config, text=True, check=True)
PY
```

## Common failures

| Failure | What to check |
| --- | --- |
| Microsoft sign-in is unavailable | Site configuration, exact SPA redirect, popup blocking and administrator consent. |
| Account not assigned | Enterprise application assignment and required user role; obtain a new token after changes. |
| HTTP 401 or 403 from a managed API | Correct endpoint, expiry, Microsoft issuer/audience, approved client, exact route scope and `api.access` role. Do not use an ID token or weaken checks to bypass an error. |
| Missing/malformed/expired local credentials | Export a new two-field file at the selected path; never silently fall back after an explicit override fails. |
| Token no longer visible | It expired, another sign-in started or the page was reloaded/closed. Obtain a new token; reload does not restore one. |

## Site routes and separation from anonymous monitoring

| Route | Purpose |
| --- | --- |
| `GET /` | Public token-console page; sign-in runs in the browser. |
| `GET /redirect.html` | Exact Microsoft SPA callback, using the local `/redirect.js` bridge. |
| `GET /config.json` | Public OAuth metadata, never a secret or token endpoint. |
| `GET /docs` or `/docs/` | Human docs; `#api` selects API and `#health` selects Health. |
| `GET /docs/api` or `/docs/api/` | Fixed 301 `Location: /docs#api`, no-store. |
| `GET /docs/health` or `/docs/health/` | Fixed 301 `Location: /docs#health`, no-store. |
| `GET /docs/api.md` | This complete machine reference, `text/markdown; charset=utf-8`. |
| `GET /docs/health.md` | Full anonymous monitoring reference, `text/markdown; charset=utf-8`. |

Static routes also support HEAD. Responses are no-store; CloudFront caching is
disabled. No `/health` backend exists. Monitoring never signs in, obtains tokens,
reads token files or calls managed APIs with credentials.
