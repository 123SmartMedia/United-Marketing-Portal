# Jira Service Management integration — `/custom-requests`

The custom-request wizard on `marketing.unitedmortgage.com/custom-requests` creates a
request in the **Marketing Requests** Jira Service Management project instead of
emailing the marketing desk. The page, the form and the United Mortgage design are
unchanged; only the destination moved.

---

## 1. Architecture

```
Browser (UMC wizard, /custom-requests)
  |
  |  STAGE 1 -- POST /api/jira/requests/init      (same-origin, metadata only)
  |                   |
  |                   +- 1. same-origin + body-size guard
  |                   +- 2. honeypot
  |                   +- 3. per-IP rate limit
  |                   +- 4. zod validation
  |                   +- 5. attachment metadata rules (count/size/type/name)
  |                   +- 6. submitter email domain allow-list
  |                   +- 7. Turnstile siteverify   <-- LAST GATE
  |                   |
  |                   +-> mint requestUUID + random object keys
  |                   +-> presign PUTs (300s max)
  |                   +-> sign the finalize token (HMAC)
  |                   |
  |                   <- { requestId, uploads:[{index,key,uploadUrl}], finalizeToken }
  |                      no readable URL, no bucket name, no account id
  |
  |  file bytes ----> PRIVATE R2 bucket, direct PUT
  |                   key = marketing-requests/{requestUUID}/{randomUUID}
  |
  |  STAGE 2 -- POST /api/jira/requests/finalize
  |                   |
  |                   +- verify token signature + expiry
  |                   +- re-validate the form and the file set
  |                   +- verify the canonical payload hash
  |                   +- reject any key outside the token's permitted set
  |                   +- HeadObject each object: real size + stored content type
  |                   +- idempotency claim
  |                   |
  |                   +-> POST /rest/servicedeskapi/request
  |                   |     on failure: DELETE every staged object, stop
  |                   +-> read bytes server-side via the S3 API
  |                   +-> POST .../servicedesk/{id}/attachTemporaryFile
  |                   +-> POST .../request/{key}/attachment   (bounded retry)
  |                   +-> DELETE each object Jira accepted
  |                         an object Jira refused is LEFT private for the
  |                         lifecycle rule to expire (short retry window)
  v
{ requestKey, requestUrl, portalUrl, correlationId, attachments:{total,attached,failed} }
```

**Why two stages.** The retired `/api/upload-url` presigned a PUT for any
same-origin caller, before any bot check ran: Turnstile was verified at submission
time, long after the bytes had landed. Splitting the flow moves every gate in
front of the upload URL, and the signed finalize token is what lets stage 2 trust
stage 1 without re-running the challenge or keeping server state between two
stateless lambda invocations.

`/api/upload-url` now returns **410 Gone**. `/api/admin/upload-url` is a separate,
authenticated endpoint for the admin CMS and is unaffected.

Everything that touches Jira is server-side. The browser never sees a Jira
credential, a Jira field ID, a Jira error body, or an R2 object key beyond the one
opaque id it needs to reference its own upload. There is no iframe, no portal
scraping, and no Atlassian call from the client.

The order above is deliberate: cheap local rejections first, then the Turnstile
redemption, and only then anything that costs an external call or creates state.

---

## 2. Files

### Core

| File | Purpose |
| --- | --- |
| `src/app/api/jira/requests/init/route.js` | **Stage 1** — every gate, then presigned PUTs + finalize token |
| `src/app/api/jira/requests/finalize/route.js` | **Stage 2** — verify, create the ticket, attach, clean up |
| `src/app/api/jira/requests/route.js` | Single-stage submission endpoint (kept; no longer used by the wizard) |
| `src/app/api/upload-url/route.js` | **Retired** — returns 410 Gone |
| `src/lib/uploadRules.js` | File rules shared by the browser and both stages |
| `src/lib/uploadToken.js` | HMAC finalize token + canonical payload hash |
| `src/lib/jira/config.js` | Auth modes, base-URL selection, config checks, allow-lists |
| `src/lib/jira/client.js` | Authenticated Jira REST calls + error normalization |
| `src/lib/jira/fieldMap.js` | **The only place Jira field IDs are referenced** |
| `src/lib/jira/attachments.js` | Attachment validation + the Jira upload sequence |
| `src/lib/jira/submitRequest.js` | Orchestration: mapping → create → attach |
| `src/lib/jira/responseMessages.js` | Internal error code → safe user-facing message |
| `src/lib/r2Uploads.js` | Private-bucket key minting, head, read, delete |
| `src/lib/turnstile.js` | Cloudflare siteverify redemption |
| `src/lib/rateLimit.js` | Per-IP throttling, same-origin check |
| `src/lib/idempotencyStore.js` | Idempotency behind a swappable interface |
| `src/components/wizard/TurnstileWidget.jsx` | Accessible, explicitly-rendered widget |
| `scripts/jira-discover.mjs` | Read-only configuration discovery |
| `scripts/jira-smoke-test.mjs` | Explicitly-invoked live ticket test |
| `scripts/set-r2-lifecycle.mjs` | Prefix-scoped expiry rule for staged uploads |
| `scripts/set-r2-cors.mjs` | Browser-PUT CORS rule on the PRIVATE uploads bucket |
| `scripts/lib/jira-script-auth.mjs` | Shared script auth — same config module as production |

**Unchanged on purpose:**

- `/api/requests` (SendGrid email) still serves the lightweight inline forms on
  `/get-started` and the category pages. They have no Turnstile widget and no
  uploads, so nothing in the two-stage work touches them. Routing those to Jira
  as well is a separate decision — see §11.
- `/api/admin/upload-url` is the authenticated admin-CMS endpoint that publishes
  into the **public** asset bucket. It is a different route from the retired
  `/api/upload-url` and was deliberately left alone.

### Content Security Policy

**This project has no CSP today** (`next.config.mjs` sets only a `Cache-Control`
header for `/assets/*`), so there was nothing to update. If one is added later,
Turnstile needs:

```
script-src  https://challenges.cloudflare.com
frame-src   https://challenges.cloudflare.com
connect-src https://<account-id>.r2.cloudflarestorage.com
```

The `connect-src` entry is for the browser's direct PUT to the presigned URL.
Note that Next.js needs a nonce or hash strategy for its own inline scripts, so
adding a CSP is a change in its own right rather than a one-line addition.

---

## 3. Authentication

`JIRA_AUTH_MODE` is **required and never guessed**. An unset or unrecognized value
leaves the integration unconfigured and the form returns a clean "not available"
message.

### `scoped_token` — the intended production mode

An Atlassian **organization service account** with a **scoped API token**. Scoped
tokens are not accepted on the site host; they only work through the Atlassian
Platform API Gateway. So:

| | |
| --- | --- |
| API base | `https://api.atlassian.com/ex/jira/${JIRA_CLOUD_ID}` |
| Authorization | `Bearer <token>` |
| Email | not used |
| Also needs | `JIRA_CLOUD_ID` |

`JIRA_SITE_URL` stays separate and is used only for human-facing links. A `_links.web`
returned by Jira is handed to the browser **only** if its host matches `JIRA_SITE_URL`;
anything else falls back to the configured portal URL.

Find the cloud id at `https://unitedmortgage.atlassian.net/_edge/tenant_info`.

### `site_basic` — legacy alternative

A classic **unscoped** API token belonging to an Atlassian account.

| | |
| --- | --- |
| API base | `JIRA_SITE_URL` |
| Authorization | `Basic base64(email:token)` |
| Also needs | `JIRA_SERVICE_ACCOUNT_EMAIL` |

### Required Atlassian token scopes

For a scoped token, grant the **minimum** that covers creating a request and adding
attachments. On a granular-scope token these are:

```
read:servicedesk-request        list service desks, request types, fields
write:servicedesk-request       create a request, attach temporary files
read:request.attachment:jira-service-management
write:request.attachment:jira-service-management
```

If the token UI offers classic scopes instead, `read:jira-work` + `write:jira-work`
plus Service Desk agent access on the project is the equivalent. `manage:servicedesk-customer`
is **only** needed if you choose `on_behalf_of` reporter mode, and even then only for
the customer *lookup* — this integration never creates or invites a customer.

> Atlassian renames and re-groups scopes periodically. Treat the list above as the
> starting point, grant it, run `npm run jira:discover`, and widen only if a call
> returns 403. Record what actually worked in this section.

### Scripts use the same config

`npm run jira:discover` and `npm run jira:smoke` both resolve credentials through
`src/lib/jira/config.js` (via `scripts/lib/jira-script-auth.mjs`), so a script can
never succeed against a host or auth mode the app would not use. Both print a
credential-free summary of how they authenticated, and neither ever prints the token.

---

## 4. Environment variables

Set these in `.env.local` locally and in **Vercel → Project → Settings →
Environment Variables** for Preview and Production. Never commit real values.

### Jira — required

| Variable | Notes |
| --- | --- |
| `JIRA_AUTH_MODE` | `scoped_token` or `site_basic`. No default. |
| `JIRA_SITE_URL` | `https://unitedmortgage.atlassian.net`. Human-facing links. |
| `JIRA_API_TOKEN` | The token. Secret. |
| `JIRA_CLOUD_ID` | `scoped_token` only. |
| `JIRA_SERVICE_ACCOUNT_EMAIL` | `site_basic` only. |
| `JIRA_SERVICE_DESK_ID` | *(discover it)* — **not** the `68` in the portal URL |
| `JIRA_REQUEST_TYPE_ID` | *(discover it)* |

`JIRA_BASE_URL` and `JIRA_API_EMAIL` remain accepted as aliases for `JIRA_SITE_URL`
and `JIRA_SERVICE_ACCOUNT_EMAIL`.

### Jira — optional

| Variable | Default | Notes |
| --- | --- | --- |
| `JIRA_PORTAL_URL` | the portal-68 URL | Shown to users; not a secret |
| `JIRA_REPORTER_MODE` | `service_account` | or `on_behalf_of` — §7 |
| `JIRA_ALLOWED_REPORTER_DOMAINS` | *(empty)* | Empty disables `on_behalf_of` |
| `JIRA_ATTACHMENTS_ENABLED` | `true` | |
| `JIRA_ACK_EMAIL` | `true` | Submitter's confirmation email |
| `JIRA_EMAIL_FALLBACK` | `false` | Disclosed fallback to SendGrid |
| `JIRA_TIMEOUT_MS` | `15000` | |
| `JIRA_FIELD_*`, `JIRA_FIELD_OPTIONS` | *(unset)* | §6 |

### Turnstile

| Variable | Notes |
| --- | --- |
| `TURNSTILE_SITE_KEY` | **Public**, but supplied at runtime through the dynamic Server Component — see below |
| `TURNSTILE_SECRET_KEY` | **Secret. Server-only.** Never a prop, never in a client component |
| `TURNSTILE_EXPECTED_HOSTNAME` | `marketing.unitedmortgage.com` |
| `TURNSTILE_EXPECTED_ACTION` | `marketing_request` (`TURNSTILE_ACTION` is a legacy alias) |
| `TURNSTILE_TIMEOUT_MS` | Optional, default `10000` |
| ~~`NEXT_PUBLIC_TURNSTILE_SITE_KEY`~~ | **Deprecated and no longer read.** Remove it from Vercel |

#### Why the site key has no `NEXT_PUBLIC_` prefix

`TURNSTILE_SITE_KEY` is **public** — it identifies the widget and is visible in the
page source. The missing prefix is about *when* it is read, not about hiding it.

Next.js replaces every `process.env.NEXT_PUBLIC_*` reference with a string literal
during `next build`, **in server code as well as client code**. The value is frozen
into the bundle, so marking a page `force-dynamic` does not make it re-readable: the
page would still serve whatever string existed at build time.

That is exactly how production served an empty site key. `/custom-requests` had been
prerendered before the key was added in Vercel, so the deployed HTML carried
`turnstileSiteKey=""`; adding the key afterwards changed nothing because no rebuild
had happened.

Without the prefix, the variable stays a real `process.env` lookup.
`/custom-requests` is `export const dynamic = 'force-dynamic'` and reads it through
`src/lib/turnstileClientConfig.js` **inside the component body** (not at module
scope, which would only re-evaluate per lambda cold start). So:

> **Rotating `TURNSTILE_SITE_KEY` does not require rebuilding**, once this dynamic
> implementation is deployed. Change it in Vercel and the next request picks it up.
> No rebuild, no redeploy.

`TURNSTILE_SECRET_KEY` is read **only** by `src/lib/turnstile.js`, server-side, when
redeeming a token against Cloudflare siteverify. It never becomes a prop and never
reaches a client component; tests assert both.

#### Fail-closed behaviour

A missing `TURNSTILE_SITE_KEY` does **not** hide the widget. The page renders
"Verification is temporarily unavailable. Please contact the marketing desk." and
Submit stays disabled. The earlier code returned `null` and left Submit enabled,
so the user only discovered the problem after filling in the whole form.

### Storage and access

| Variable | Notes |
| --- | --- |
| `R2_UPLOADS_BUCKET` | **Private** bucket for staged attachments |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | Already configured |
| `ALLOWED_REQUEST_EMAIL_DOMAINS` | `unitedmortgage.com` in production |

---

## 5. Discovering the service desk and request type IDs

```bash
npm run jira:discover                                           # every visible desk
npm run jira:discover -- --project "Marketing Requests"         # one desk
npm run jira:discover -- --service-desk 42 --request-type 118   # one type's fields
```

Read-only; never prints the token or an `Authorization` header. For each request type
it reports the type ID and name, every field ID with REQUIRED/optional and its schema
type, valid option IDs and labels, whether an `attachment` field is exposed, and
whether the account may raise requests on behalf of customers.

> The `68` in `…/servicedesk/customer/portal/68` is the **portal** ID. It is usually
> not the API `serviceDeskId`. Match on project name or key.
>
> On *this* instance they coincide: MCP discovery read `serviceDeskId: "68"` and
> `portalId: "68"` from live MKT requests, so `JIRA_SERVICE_DESK_ID=68` is verified
> rather than assumed (§6).

---

## 6. Form → Jira field mapping

All mapping lives in `src/lib/jira/fieldMap.js`. No Jira field ID appears anywhere
else, and none appears in a UI component.

| UMC field | Required in form | Jira target | Env var |
| --- | --- | --- | --- |
| `projectTitle` | yes | `summary` (+ description) | `JIRA_FIELD_PROJECT_TITLE` |
| *(all fields)* | — | `description` | — |
| `requestType` | yes | select | `JIRA_FIELD_REQUEST_TYPE` |
| `rush` | no | Yes/No | `JIRA_FIELD_RUSH` |
| `dateNeeded` | yes | date (`YYYY-MM-DD`) | `JIRA_FIELD_DATE_NEEDED` |
| `name` | yes | text | `JIRA_FIELD_REQUESTER_NAME` |
| `email` | yes | text | `JIRA_FIELD_REQUESTER_EMAIL` |
| `phone` | yes | text | `JIRA_FIELD_REQUESTER_PHONE` |
| `nmls` | yes | text | `JIRA_FIELD_NMLS` |
| `branch` | yes | text | `JIRA_FIELD_BRANCH` |
| `printingNeeded` | conditional | Yes/No | `JIRA_FIELD_PRINTING_NEEDED` |
| `quantity` | conditional | select | `JIRA_FIELD_QUANTITY` |
| `size` | conditional | select | `JIRA_FIELD_SIZE` |
| `finish` | conditional | select | `JIRA_FIELD_FINISH` |
| `cobrand` | conditional | Yes/No | `JIRA_FIELD_COBRAND` |
| `partnerName` | conditional | text | `JIRA_FIELD_PARTNER_NAME` |
| `complianceApproved` | conditional | Yes/No | `JIRA_FIELD_COMPLIANCE_APPROVED` |
| `keyMessage` | yes | text area | `JIRA_FIELD_KEY_MESSAGE` |
| `additionalDetails` | no | text area | `JIRA_FIELD_ADDITIONAL_DETAILS` |
| `asset` * | no | text | `JIRA_FIELD_ASSET` |
| `details` * | no | text area | `JIRA_FIELD_DETAILS` |
| `files` | no | Jira attachments; **filenames only** in the description | — |
| `company` | — | honeypot; never sent | — |

\* only sent by the lightweight inline forms, which still use `/api/requests`.

**Rules**

- `summary` and `description` are standard Jira fields and are always sent.
- Every other mapping is optional. **An unset `JIRA_FIELD_*` does not lose data** —
  the value still appears in the description. `unmappedFields` is logged on every
  submission so the gap stays visible.
- Select and Yes/No fields send `{ id }` when the label is in `JIRA_FIELD_OPTIONS`,
  otherwise `{ value: "<label>" }`, which Jira resolves by name.
- A `dateNeeded` that is not a bare `YYYY-MM-DD` is kept in the description rather
  than sent as an invalid date.
- The description lists attachment **filenames and sizes only**. No object key, no
  URL, no storage host — see §9.

**Verified IDs.** Read-only Atlassian MCP discovery ran on 2026-09-21. Full record,
including every option ID and the reasoning behind each mapping decision:
[`jira-mcp-discovery.md`](jira-mcp-discovery.md).

| Fact | Value | Status |
| --- | --- | --- |
| Cloud ID | `638ffe69-6618-4145-b60c-144cfb581ff6` | **verified (MCP)** |
| Project | Marketing Requests / `MKT` / id `10100` / `service_desk` | **verified (MCP)** |
| Service desk ID | `68` | **verified (MCP)** |
| Portal ID | `68` | **verified (MCP)** |
| Target issue type | `10078` — *Submit a request or incident* | **verified (MCP)** |
| Request type ID | — | **NOT verified** |
| `dateNeeded` → MKT – Requested Due Date | `customfield_10301` | **verified (MCP)** |

On this instance the portal ID and the service desk ID are both `68` — the general
warning above still holds elsewhere, but here Jira itself reports
`serviceDeskId: "68"` on every MKT request.

> **Still open.** The Atlassian MCP catalog contains **no `/rest/servicedeskapi/`
> operations**, so the portal's request type list, each request type's own field
> config and required fields, Jira Forms, attachment enablement, portal visibility
> and `raiseOnBehalfOf` permission could **not** be read. Those need the production
> service account and `npm run jira:discover` (§5). `JIRA_REQUEST_TYPE_ID` is
> deliberately still empty — see `jira-mcp-discovery.md` §2.

---

## 7. Reporter identity

`/custom-requests` is **not authenticated** — anyone who can reach the site can
submit, and the email field is user-editable. Reporter behavior is conservative by
default.

| Mode | Behavior |
| --- | --- |
| `service_account` (default) | The integration account is the Jira reporter. The submitter's name, email, phone, NMLS and branch go into Jira fields (when mapped) and always into the description. The submitter still receives the acknowledgment email. |
| `on_behalf_of` | `raiseOnBehalfOf` is used **only** when the submitted email's domain is in `JIRA_ALLOWED_REPORTER_DOMAINS` **and** a Jira customer with exactly that email already exists. Otherwise it silently falls back to `service_account`. |

- A browser-submitted email can never select an arbitrary Jira customer: the
  allow-list gate runs before any lookup, and an empty allow-list disables the mode.
- **No Jira customer account is ever created or invited automatically.**
- If the site later gains employee authentication, replace the payload email with the
  server-side session identity in `resolveReporter()` — that is the only place that
  needs to change.

Separately, `ALLOWED_REQUEST_EMAIL_DOMAINS` gates **who may submit at all**. It is
enforced server-side, before Turnstile and Jira, and returns a 403 naming the `email`
field. HTML validation is not relied on. An empty list accepts any domain, which is
correct for local development and wrong for production.

---

## 8. Turnstile

The widget renders in the final wizard step (`TurnstileWidget.jsx`), explicitly rather
than by auto-discovery, so the parent owns the widget id and can reset it.

- The token is sent with the submission and **redeemed server-side** against
  `https://challenges.cloudflare.com/turnstile/v0/siteverify` before any Jira call,
  any R2 read, or any other external work.
- Verified on redemption: `success`, the `hostname` (must equal
  `TURNSTILE_EXPECTED_HOSTNAME`), and `action` when `TURNSTILE_ACTION` is configured.
- Rejected: missing, empty, oversized/malformed, failed, expired and duplicate
  (Cloudflare reports replay and expiry alike as `timeout-or-duplicate`).
- **Fails closed.** A siteverify timeout, outage, non-JSON body or non-200 never lets
  a submission through.
- The token and the secret are never logged. Only Cloudflare's own error-code strings
  are recorded.
- The widget resets after every completed or failed attempt, because a Turnstile token
  is single use. The server sets `resetChallenge: true` on a Turnstile rejection.
- The submit button waits for a token, but that is a convenience only — the server
  redeems the token regardless of what the browser did.
- The honeypot and the rate limiter are kept as defence in depth. The honeypot runs
  *before* siteverify so an obvious bot never costs a Cloudflare call.

**Accessibility:** the widget is labelled, grouped, described by its error text via
`aria-describedby`, and its state is announced in a polite live region. If the script
cannot load (blocked, offline), the user sees a plain explanation instead of a silent
dead end.

**Not configured = not enforced.** With no `TURNSTILE_SECRET_KEY`, verification is
skipped and **every submission logs a loud warning**. That keeps local development
usable without keys. It also means a misconfigured production deploy silently loses
bot protection — which is why the warning exists and why the launch checklist has an
explicit item for it.

**Testing** uses Cloudflare's published test keys (site `1x00000000000000000000AA`,
secret `1x0000000000000000000000000000000AA`, and the always-fail / already-spent
variants). These are documented dummy values, not secrets.

---

## 9. Attachment handling and R2 lifecycle

### Storage model

| | |
| --- | --- |
| Bucket | `R2_UPLOADS_BUCKET` — **private**, no public r2.dev domain, no custom domain |
| Key | `requests/<date>/<uuid>.<ext>` — random, non-guessable, **no filename** |
| Client receives | the presigned PUT URL and the opaque key. Nothing readable. |
| Server reads bytes | through the S3 API with its own credentials — never over HTTP |
| Presign TTL | 5 minutes, scoped to one key and one content type |

Reading through the S3 API rather than fetching a URL also removes the SSRF surface a
fetch-by-URL design would have: there is no attacker-controllable URL to fetch.

If `R2_UPLOADS_BUCKET` is unset it falls back to `R2_BUCKET`, which is **public** (it
serves the asset catalog). The upload route logs a warning when that happens. Create
the dedicated private bucket before launch.

### Validation

Before anything is created in Jira: file count (≤5), per-file size (≤10MB), total size
(≤10MB), MIME type, filename extension matching the MIME type, blocked extensions
(executables and archives, regardless of declared type), sanitized filenames, no
duplicate keys, and the key must match the shape this server mints with an extension
agreeing with the declared type.

After the bytes are read back: the **actual byte count must equal the declared size**,
and the **leading bytes must match the declared type** (`%PDF`, PNG signature, JPEG
SOI). An executable renamed to `.png` does not survive this.

### The Jira sequence

Jira's supported order, and what the code does:

1. `POST /rest/servicedeskapi/request` — create the customer request
2. `POST .../servicedesk/{id}/attachTemporaryFile` — with `X-Atlassian-Token: no-check`
3. `POST .../request/{key}/attachment` — permanently attach, `public: true`

### Cleanup and retry

| Outcome | Staged object | Reported |
| --- | --- | --- |
| Attached successfully | **Deleted immediately** | `attached: n of n` |
| Some files failed | Successful ones deleted; failed ones **retained** | `attached: 1 of 3`, `attachment_partial_failure` |
| Temp upload failed for all | **Retained** for the retry window | `attachment_upload_failed` |
| Permanent attach failed | **Retained** for the retry window | `attachment_attach_failed` |

Retained objects expire automatically — `scripts/set-r2-lifecycle.mjs` installs a
2-day expiry on the `requests/` prefix (plus a 1-day abort for incomplete multipart
uploads), matching `UPLOAD_RETENTION_DAYS` in `src/lib/r2Uploads.js`. Run it once:

```bash
node --env-file=.env.local scripts/set-r2-lifecycle.mjs
node --env-file=.env.local scripts/set-r2-lifecycle.mjs --show
```

**No public fallback link is ever produced** — not in the response, not in the Jira
description, not in a log line. When a file cannot be attached, the success screen
says how many of how many landed and asks the user to reply to their confirmation
email with the rest. That is the recovery path; there is deliberately no durable
pointer to the raw object.

A failed attachment **never** invalidates a created ticket, and the UI never claims
files landed when they did not: `attachments.total`, `.attached` and `.failed` are all
returned, and the success screen renders "N of M file(s) attached" whenever they differ.

### What is never logged

Object keys, key prefixes, presigned URLs, storage hosts, attachment bytes, the Jira
token, the Turnstile token or secret, or the full request body. Failures log the
correlation ID, the sanitized **filename**, and a short reason code. There is a test
asserting the key never reaches the log.

---

## 10. Duplicate protection

Three layers:

1. **Client in-flight ref** — a second submit cannot start before React re-renders.
2. **Server in-flight claim** — a second request with the same `submissionId` while
   the first is still running gets a 409.
3. **Server result cache** — a repeat with the same `submissionId` returns the
   original ticket, marked `duplicate: true`.

All of this lives behind the interface in `src/lib/idempotencyStore.js`
(`get` / `remember` / `claim` / `release`).

> **Production note — the bundled store is NOT durable.** It is per-process, so on
> Vercel each lambda instance has its own copy, and two clicks routed to different
> instances could still produce two tickets. The client guard makes that unlikely, not
> impossible. The repository has no Redis, KV or database dependency, and none was
> added here — that is a paid-service decision. To close the gap, implement the same
> four-method shape against Vercel KV or Upstash Redis and return it from
> `createIdempotencyStore()` when its env vars are present. Nothing else changes.

The rate limiter (`src/lib/rateLimit.js`) has the same per-process caveat and the same
role: a speed bump behind Turnstile, not the primary control.

---

## 11. Failure behavior

| Situation | What the user sees | HTTP |
| --- | --- | --- |
| Integration not configured | "not available right now… email marketing@" | 503 |
| Form validation failed | Inline field errors + the step with the first error | 400 |
| Email domain not allowed | "Please submit with your United Mortgage work email" | 403 |
| Turnstile missing / failed / expired | "Complete the challenge again and resubmit" | 400 |
| Turnstile service unreachable | "Couldn't reach the verification service" | 503 |
| Attachment rejected | Specific message naming the file | 400 |
| Jira rejected the payload | "Some details weren't accepted…" | 502 |
| Jira auth / permission / outage / rate limit | One generic "not submitted" message | 502 |
| Jira timeout | "Taking longer than expected and wasn't submitted" | 504 |
| Too many submissions | "Please wait a few minutes" + `Retry-After` | 429 |
| Payload too large | "Too large to submit" | 413 |

In every failure case the form keeps everything typed, the message says plainly that
the request was **not** submitted, a correlation ID is shown, and retrying is safe.
Nothing is reported as success when the Jira create failed. Auth, permission,
rate-limit and outage failures share one message so the response cannot be used to
probe the Jira instance.

`JIRA_EMAIL_FALLBACK=true` (off by default) routes a failed submission to SendGrid
instead. Turning it on is a disclosure decision.

---

## 12. Security summary

- Secrets are server-only. `src/lib/jira/*`, `src/lib/turnstile.js` and
  `src/lib/r2Uploads.js` import `server-only`, so a client component importing them
  fails the build. The only `NEXT_PUBLIC_` value is the Turnstile **site** key.
- POST only; every other method gets a 405 from Next.
- Cross-origin posts refused on both `/api/jira/requests` and `/api/upload-url`.
- Body capped at 128 KB before parsing; file bytes never transit the endpoint.
- Server-side zod validation regardless of what the client did.
- Turnstile redeemed server-side, failing closed.
- Submitter domain allow-list enforced server-side.
- Per-IP throttling on both the submit and presign endpoints.
- Private storage, random keys, byte-level type verification, prompt deletion.
- No `dangerouslySetInnerHTML`. No new runtime dependencies were added.

---

## 13. Testing

```bash
npm test          # unit + endpoint tests, Jira and Cloudflare mocked — creates nothing
npm run build
```

Coverage includes: auth-mode base-URL and authorization-scheme selection (both modes,
plus refusing to guess), credential non-leakage, form validation, field mapping,
select options, submitter allow-list, Turnstile success / failure / missing /
malformed / hostname mismatch / action mismatch / replay / timeout / outage, object-key
forgery, magic-byte and byte-count verification, the Jira attachment order, partial
failure counts, staged-object deletion and retention, cross-origin rejection, Jira
401/400/429/timeout/outage, duplicate-click protection, and assertions that no secret,
Jira field ID, object key or URL reaches the client, the logs or the Jira description.

### Live smoke test

After credentials and verified IDs are configured:

```bash
npm run jira:smoke -- --confirm
```

Creates **one** ticket titled `[TEST — PLEASE CLOSE] …` and prints the key. It refuses
to run without `--confirm` and is never part of `npm test`.

---

## 14. Production deployment

1. Create the Jira service account and scoped API token (§15).
2. `npm run jira:discover` locally; record the verified IDs in §6.
3. Create the **private** `R2_UPLOADS_BUCKET` and run `scripts/set-r2-lifecycle.mjs`.
4. Create the Turnstile site; copy the site and secret keys.
5. Add every variable from §4 in Vercel for **Preview** and **Production**
   (tokens and secrets as secrets). Redeploy — Next inlines build-time env.
6. Submit a real request on Preview; confirm the ticket, the field values, the
   attachments, and that the staged R2 objects were deleted.
7. Promote to Production and submit once more.

**Open decision:** the inline forms on `/get-started` and the category pages still
email the marketing desk through `/api/requests`. Point them at Jira by switching
their `fetch` target — the endpoint already accepts their payload shape via
`simpleSchema` — but note they have no Turnstile widget, so add one first.

---

## 15. Jira administrator actions still required

- [ ] Create an Atlassian **organization service account** (not a person's login).
- [ ] Issue it a **scoped** API token with the scopes in §3.
- [ ] Grant it the minimum project access needed to create requests and add
      attachments (agent access is normally required for `raiseOnBehalfOf`).
- [x] ~~Provide `JIRA_CLOUD_ID`~~ — verified `638ffe69-6618-4145-b60c-144cfb581ff6`.
- [x] ~~Identify the service desk~~ — verified `68` (project `MKT`, id `10100`).
- [ ] **Choose the request type for the UMC form and set `JIRA_REQUEST_TYPE_ID`.**
      It must be one whose `issueTypeId` is `10078`; the MKT custom fields exist on
      no other issue type. Request type `115` is email-intake-only and must not be
      used. Run `npm run jira:discover -- --service-desk 68`.
- [ ] Confirm the chosen request type is **customer-portal visible**, not hidden.
- [ ] Confirm attachments are enabled on the chosen request type.
- [ ] Confirm whether the request type uses a **Jira Form** — if it does, its fields
      and choice IDs govern the payload and none of it is visible through MCP.
- [ ] Confirm the request type's own required fields — any field the *request type*
      marks REQUIRED that the UMC form does not collect will cause a 400 until mapped
      or made optional. Nothing is required at the Jira **issue** level except
      `project` and `summary`, so this is the likeliest cause of a first-submit 400.
- [ ] Decide reporter mode (§7).
- [ ] Resolve the `customfield_10297` (MKT – Branch / Team) option set — its context
      returns only `10152` "Other / Not Listed", so `branch` cannot be mapped yet.
- [ ] Decide `complianceApproved` → `customfield_10303`. The two fields mean
      **opposite things**; see `jira-mcp-discovery.md` §3.
- [ ] Decide whether to collect `MKT – Urgency` / `MKT – Impact` instead of the
      boolean `rush`, and whether an automation rule derives priority from them.
- [ ] Create the Jira fields that have no target today (NMLS ID, phone, print
      quantity / size / finish, co-branding, key message) if they should be
      structured rather than description-only.

---

## 16. Key rotation

**Jira token:** create a new token for the same service account → update
`JIRA_API_TOKEN` in Vercel (Preview + Production) → redeploy → submit a test request →
revoke the old token.

**Turnstile secret:** rotate in the Cloudflare dashboard → update
`TURNSTILE_SECRET_KEY` → redeploy. The site key normally stays the same.

**R2 keys:** rotate in Cloudflare → update `R2_*` in Vercel → redeploy. In-flight
presigned PUTs (5-minute TTL) will fail; the user simply re-uploads.

No secret appears in logs, error messages or client responses, so rotation needs no
code change. Rotate immediately if a value is ever pasted into a shared channel or a
screenshot.

---

## 17. Troubleshooting

| Status | Likely cause | Fix |
| --- | --- | --- |
| **400** | A Jira-required field is missing, or a select option ID is wrong | Re-run discovery; map the REQUIRED fields or set `JIRA_FIELD_OPTIONS` |
| **401** | Scoped token used against the site host, or wrong account for a Basic token | Confirm `JIRA_AUTH_MODE`; a scoped token only works via `api.atlassian.com` |
| **403** | Missing token scope, or no project access | Grant the §3 scopes; for `raiseOnBehalfOf`, agent access |
| **404** | Wrong `JIRA_CLOUD_ID` (gateway), or `JIRA_SERVICE_DESK_ID` is the portal ID | Re-run discovery |
| **413** | Payload or attachment over a limit | Remove an attachment; check the Jira instance attachment cap |
| **422** | Value rejected | Compare against the discovered `validValues` |
| **429** | Atlassian throttling the service account | Back off; consider a queue if sustained |
| `turnstile_*` | Challenge not solved, expired, replayed, or solved elsewhere | Check `TURNSTILE_EXPECTED_HOSTNAME` matches the deployment host |
| `attachment_*` | Byte/type/size mismatch, or storage unreachable | Check the private bucket exists and the R2 keys are valid |

Every failed submission logs a correlation ID that is also shown to the user — search
the Vercel function logs for it.

---

## 18. Disabling the integration safely

- **Pause submissions:** unset `JIRA_AUTH_MODE` (or any required variable) and
  redeploy. The route returns 503 directing users to email the marketing desk. No
  ticket is created and nothing is lost.
- **Revert to email:** set `JIRA_EMAIL_FALLBACK=true`. Jira is tried first; failures
  go to SendGrid.
- **Full revert:** point `RequestWizard`'s `fetch` back at `/api/requests`, which was
  never modified and still emails the desk.

---

## 19. Launch checklist

**Jira**
- [ ] Service account created; scoped token issued with least-privilege scopes
- [ ] `JIRA_AUTH_MODE=scoped_token` and `JIRA_CLOUD_ID` set
- [ ] `npm run jira:discover` run; desk and request-type IDs verified
- [ ] All Jira-required fields mapped or confirmed optional
- [ ] Select option IDs recorded in `JIRA_FIELD_OPTIONS`
- [ ] Verified IDs written into §6 of this document
- [ ] Reporter mode decided and documented
- [ ] `npm run jira:smoke -- --confirm` created a ticket in the right project/type

**Bot protection and access**
- [ ] Turnstile site created; `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` set
- [ ] Deprecated `NEXT_PUBLIC_TURNSTILE_SITE_KEY` removed from Vercel
- [ ] Loaded `/custom-requests` and confirmed the widget is VISIBLE above Submit
- [ ] `TURNSTILE_EXPECTED_HOSTNAME` matches the production host
- [ ] Verified the function logs show **no** "bot protection is DISABLED" warning
- [ ] `ALLOWED_REQUEST_EMAIL_DOMAINS=unitedmortgage.com` set in production

**Storage**
- [ ] `R2_UPLOADS_BUCKET` created as a **private** bucket (no public domain)
- [ ] Confirmed a staged object is NOT reachable by URL
- [ ] `scripts/set-r2-lifecycle.mjs` run; `--show` confirms the expiry rule
- [ ] Verified a successful submission deletes its staged objects

**General**
- [ ] `npm test` and `npm run build` pass
- [ ] Preview submission verified end to end, attachments included
- [ ] Partial-attachment path verified (UI says "N of M", never "all attached")
- [ ] Failure path verified (bad token → generic message + correlation ID, no false success)
- [ ] Durable idempotency store decided (§10) or the residual risk accepted in writing
- [ ] Marketing desk knows where tickets now arrive and who triages them
- [ ] Rotation owner and schedule agreed for `JIRA_API_TOKEN` and `TURNSTILE_SECRET_KEY`
