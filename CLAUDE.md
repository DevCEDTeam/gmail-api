# CLAUDE.md

Project guide for AI assistants working on this codebase.

## Project Overview

Gmail Bulk Sending System (v2.0.0) — a Node.js email relay with full tracking (bounces, opens, clicks, spam, unsubscribes) via Gmail OAuth2, Firebase Realtime Database, and optional DuoCircle SMTP. Designed for the domain `cfored.com`. GCP Project ID: `gmail-bulk-sending-389112`.

## Quick Reference

```bash
npm start          # Start all 3 services locally (relay + webhooks + worker)
npm run relay      # Blue Truck relay only (port 3000)
npm run webhooks   # Webhook/tracking server only (port 3001)
npm run worker     # Orange Airplane queue processor only
npm run report     # Generate and send weekly report
```

No test suite or linter is configured. `npm test` exits with an error.

## Architecture — Three Services

| Service | Nickname | Entry Point | Port | Deploy Target |
|---------|----------|-------------|------|---------------|
| Relay | Blue Truck | `src/relay/server.js` | 3000 | Cloud Run |
| Webhooks | Tracking | `src/webhooks/server.js` | 3001 | Cloud Run |
| Worker | Orange Airplane | `src/queue/worker.js` | N/A | Cloud Function |

`app.js` starts all three together for local development. In production they run independently.

## Folder Structure

```
gmail-api/
├── app.js                     # Combined entry point (all services)
├── .env.example               # Environment variable template (85 lines, 9 sections)
├── Dockerfile                 # Cloud Run image (node:20-alpine)
├── firebase.json              # Firebase CLI config (rules + functions paths)
├── database.rules.json        # Firebase RTDB security rules & indexes
├── package.json               # Dependencies + npm scripts
├── MAUTIC-7X-REVIEW.md        # Mautic 7.x compatibility analysis & integration notes
├── GCP-INSTALL.md             # Complete 12-step deployment guide with folder annotations
├── SETUP.md                   # Basic single-profile OAuth2 quickstart
│
├── functions/
│   └── index.js               # Cloud Functions: processEmailQueue + weeklyReport
│                               # (firebase-functions dependency required — run npm init + npm install
│                               #  inside functions/ before deploying)
│
└── src/
    ├── config/
    │   ├── credentials.js     # OAuth2 multi-profile manager (3 wristbands)
    │   └── firebase.js        # Firebase Admin SDK init (singleton)
    ├── services/
    │   ├── email.js           # Core send logic + tracking pixel + click wrapping + suppression
    │   └── database.js        # Firebase RTDB data-access layer (7 collections)
    ├── relay/
    │   └── server.js          # Express: /relay/send, /relay/bulk, /relay/queue, /relay/stats
    ├── webhooks/
    │   └── server.js          # Express: /mailer/callback, /tracking/open/:id, /tracking/click/:id/:linkId, /email/unsubscribe/:id, /email/dnc/:id
    ├── queue/
    │   └── worker.js          # Processes /queue items with concurrency control
    ├── reports/
    │   └── generate.js        # Weekly digest email with metric grading
    └── middleware/             # Reserved — currently empty
```

## Module Dependency Graph

```
app.js
├── src/config/firebase.js        → initFirebase()
├── src/relay/server.js            → Express app (exported)
├── src/webhooks/server.js         → Express app (exported)
└── src/queue/worker.js            → processOnce(), onQueueWrite()

src/relay/server.js
├── src/services/email.js          → sendEmail(), sendBulk()
├── src/services/database.js       → enqueueEmail(), getStats()
└── src/config/firebase.js         → initFirebase()

src/webhooks/server.js
├── src/services/database.js       → recordOpen(), recordClick(), recordBounce(), recordSpam(), addSuppression()
├── src/services/email.js          → TRACKING_PIXEL (Buffer)
└── src/config/firebase.js         → getDatabase() [dynamic require in unsubscribe/dnc handlers]

src/services/email.js
├── src/config/credentials.js      → getOAuthClient(), getDuoCirclePassword()
└── src/services/database.js       → isSuppressed(), recordDelivery(), updateQueueItem()

src/services/database.js
└── src/config/firebase.js         → getDatabase()

src/config/credentials.js
├── googleapis                     → google.auth.OAuth2
└── @google-cloud/secret-manager   → SecretManagerServiceClient [optional]

src/queue/worker.js
├── src/config/firebase.js         → initFirebase(), getDatabase()
├── src/services/email.js          → sendEmail()
└── src/services/database.js       → updateQueueItem(), getPendingEmails()

src/reports/generate.js
├── src/config/firebase.js         → initFirebase()
├── src/services/email.js          → sendEmail()
└── src/services/database.js       → getStats()

functions/index.js
├── firebase-functions             → database trigger, pubsub schedule
├── firebase-admin                 → separate init (not shared with src/)
└── src/queue/worker.js            → processQueueItem()
```

No circular dependencies exist. Config modules are leaf dependencies; services layer sits in the middle; server modules are top-level consumers.

## Key Concepts

### Three OAuth2 Profiles ("Wristbands")

Defined in `src/config/credentials.js`. Each maps to separate GCP OAuth2 client credentials:

| Profile | Client Name | Sender | Env Prefix |
|---------|-------------|--------|------------|
| `general` | gmail-bulk-sending-1 | noreply@cfored.com | `GENERAL_` |
| `director` | gmail-bulk-sending-2 | director@cfored.com | `DIRECTOR_` |
| `team` | gmail-bulk-sending-3 | team@cfored.com | `TEAM_` |

Each profile needs: `{PREFIX}CLIENT_ID`, `{PREFIX}CLIENT_SECRET`, `{PREFIX}REFRESH_TOKEN`, `{PREFIX}SENDER_EMAIL`, `{PREFIX}SENDER_NAME`.

Select via `profile` parameter in API requests (defaults to `director`).

OAuth2 clients are cached in a `Map` (`clientCache`) so tokens are reused across calls within the same process.

### Secret Manager vs Environment Variables

`src/config/credentials.js` resolves credentials in this order:
1. Google Secret Manager (when `USE_SECRET_MANAGER=true`) — production
2. Environment variables — local development

Secret IDs follow the pattern: `oauth-secret-client{1,2,3}`, `oauth-refresh-{general,director,team}`, `duocircle-smtp-password`.

### Transport Layer

`src/services/email.js` supports two transports selected by `EMAIL_TRANSPORT` env var:
- `gmail` (default) — Gmail OAuth2 via googleapis + nodemailer
- `duocircle` — DuoCircle SMTP relay for high-volume sends

Both transports share the same `sendEmail()` pipeline, so tracking, suppression checks, and delivery recording work identically regardless of transport.

### Firebase RTDB Collections

Managed by `src/services/database.js`. Rules in `database.rules.json`.

| Collection | Purpose | Key Fields |
|------------|---------|------------|
| `/queue` | Outbound email jobs | status, to, subject, profile |
| `/deliveries` | Sent email records | trackingId, to, messageId, sentVia |
| `/bounces` | Hard & soft bounces | email, type (hard/soft), reason |
| `/spam` | Spam complaints | email, feedbackType |
| `/opens` | Open tracking events | trackingId/{pushKey}/openedAt |
| `/clicks` | Click tracking events | trackingId/{pushKey}/linkId, clickedAt |
| `/suppressions` | DNC list | email, reason, suppressedAt |

Suppression keys are base64-encoded emails with special chars replaced (`[.#$/[\]]` → `_`).

### Queue Item Status Lifecycle

```
pending → processing → sent
                     → skipped_suppressed
                     → failed (with error message)
```

- `pending`: created by `/relay/queue` endpoint via `db.enqueueEmail()`
- `processing`: set at start of `processQueueItem()` in worker
- `sent`: set after successful `sendEmail()` (includes trackingId + sentAt)
- `skipped_suppressed`: set when recipient is on DNC list
- `failed`: set on error (includes error message + failedAt timestamp)

### Email Send Pipeline

Every send in `src/services/email.js` follows this flow:
1. Check suppression list (skip if suppressed)
2. Generate UUID tracking ID
3. Append 1x1 tracking pixel to HTML
4. Wrap `<a href>` links for click tracking (skips mailto:, #, unsubscribe/dnc links)
5. Build transport (Gmail or DuoCircle)
6. Resolve sender identity (from address + display name)
7. Add List-Unsubscribe headers (RFC 8058)
8. Send via nodemailer
9. Record delivery in Firebase
10. Update queue item status (if queued)

### Webhook Event Types

`src/webhooks/server.js` handles these callback types at `POST /mailer/callback`:
- `bounce`, `hard_bounce` — adds to DNC immediately
- `soft_bounce` — adds to DNC after 5 occurrences (`SOFT_BOUNCE_THRESHOLD`)
- `spam`, `complaint`, `spam_complaint` — adds to DNC immediately
- `unsubscribe`, `unsub` — adds to DNC

The callback endpoint accepts both single events and arrays of events.

## API Endpoints

### Relay Server (port 3000)

```
GET  /health           → {"status":"ok","role":"blue-truck"}
POST /relay/send       → Send single email. Body: {to, subject, html, text?, profile?}
POST /relay/bulk       → Bulk send. Body: {recipients[], subject, html, text?, profile?}
POST /relay/queue      → Queue async. Body: {to, subject, html, text?, profile?}
GET  /relay/stats      → Stats. Query: ?since=ISO-date (default: 7 days)
```

### Webhook Server (port 3001)

```
GET  /health                        → {"status":"ok"}
POST /mailer/callback               → Mautic/ESP event webhook (accepts array or single event)
GET  /tracking/open/:trackingId     → Returns 1x1 GIF, records open
GET  /tracking/click/:trackingId/:linkId?url=ENCODED → Records click, 302 redirects to url
GET  /email/unsubscribe/:trackingId → Unsubscribe confirmation page
POST /email/unsubscribe/:trackingId → Process unsubscribe (RFC 8058 one-click)
GET  /email/dnc/:trackingId         → Full DNC opt-out
```

## Environment Variables Reference

All variables are defined in `.env.example` (copy to `.env` for local dev):

| Group | Variables | Notes |
|-------|-----------|-------|
| GCP | `GCP_PROJECT_ID`, `USE_SECRET_MANAGER` | `USE_SECRET_MANAGER=false` for local dev |
| OAuth2 (x3 profiles) | `{PREFIX}_CLIENT_ID`, `{PREFIX}_CLIENT_SECRET`, `{PREFIX}_REFRESH_TOKEN`, `{PREFIX}_SENDER_EMAIL`, `{PREFIX}_SENDER_NAME` | Prefixes: `GENERAL_`, `DIRECTOR_`, `TEAM_` |
| OAuth2 shared | `REDIRECT_URI` | Default: `https://developers.google.com/oauthplayground` |
| Firebase | `FIREBASE_DATABASE_URL`, `GOOGLE_APPLICATION_CREDENTIALS` | Credentials path only needed for local dev |
| Mautic / Tracking | `MAUTIC_BASE_URL`, `TRACKING_BASE_URL`, `DOMAIN` | Base URLs for unsubscribe links and tracking pixels |
| DuoCircle | `EMAIL_TRANSPORT`, `DUOCIRCLE_HOST`, `DUOCIRCLE_PORT`, `DUOCIRCLE_USER`, `DUOCIRCLE_PASS`, `DUOCIRCLE_SECURE` | Set `EMAIL_TRANSPORT=duocircle` to activate |
| Ports | `RELAY_PORT`, `WEBHOOK_PORT` | Default: 3000, 3001 |
| Queue | `QUEUE_CONCURRENCY` | Default: 5 |
| Reports | `REPORT_RECIPIENT` | Default: `director@cfored.com` |

## Dependencies

| Package | Purpose |
|---------|---------|
| `express` | HTTP servers (relay + webhooks) |
| `nodemailer` | Email transport (Gmail SMTP / DuoCircle SMTP) |
| `googleapis` | Google OAuth2 client for access token management |
| `firebase-admin` | Firebase Realtime Database access |
| `@google-cloud/secret-manager` | Production credential loading |
| `dotenv` | Local .env file loading |
| `uuid` | Tracking ID generation (v4) |

Cloud Functions require `firebase-functions` and `firebase-admin` — install inside `functions/` directory before deploying (`cd functions && npm init -y && npm install firebase-functions firebase-admin`).

## Conventions and Patterns

### Code Style
- CommonJS `require()` — no ES modules
- `async/await` throughout — no raw Promise chains
- Console logging with bracketed prefixes: `[relay]`, `[worker]`, `[email]`, `[callback]`, etc.
- Express route handlers follow try/catch pattern with `res.status(code).json({error})` on failure

### Error Handling
- **Graceful degradation**: Firebase failure doesn't crash the app — tracking is just disabled
- **Fire-and-forget**: Open tracking always returns the pixel even if DB write fails
- **Status-based recovery**: Queue items get `failed` status with error message for investigation
- **Suppression returns**: Suppressed sends return `{skipped: true, reason: "suppressed"}` instead of throwing
- **Early validation**: Missing required fields return 400 before processing
- **Credential fail-fast**: Missing OAuth2 credentials throw descriptive errors listing which env vars are missing

### Naming
- Services use domain metaphors: "Blue Truck" (relay), "Orange Airplane" (queue worker)
- OAuth2 credential sets are called "wristbands"
- Files are named by their domain: `relay/server.js`, `webhooks/server.js`, `queue/worker.js`
- Firebase singleton uses `initialised` flag (British spelling)

### Security
- `.env` is in `.gitignore` — never commit secrets
- `service-account-key.json` should never be committed (add to `.gitignore` if working with one locally)
- Client Secrets and Refresh Tokens go in Secret Manager for production
- Client IDs are safe to put in Cloud Run env vars (not secrets)
- Suppression keys are base64-encoded to avoid Firebase path-unsafe characters

## Environment Setup (Local Dev)

```bash
git clone https://github.com/DevCEDTeam/gmail-api.git
cd gmail-api
npm install
cp .env.example .env
# Fill in OAuth2 credentials in .env
# Set GOOGLE_APPLICATION_CREDENTIALS for Firebase
node app.js
```

## Deployment

### Cloud Run (relay + webhooks)
```bash
gcloud builds submit --tag gcr.io/gmail-bulk-sending-389112/gmail-relay
gcloud run deploy gmail-relay --image gcr.io/gmail-bulk-sending-389112/gmail-relay ...
```

### Cloud Functions (worker + report)
```bash
cd functions && npm init -y && npm install firebase-functions firebase-admin && cd ..
firebase deploy --only functions
```

### Firebase Rules
```bash
firebase deploy --only database
```

See `GCP-INSTALL.md` for the complete 12-step deployment guide with folder-to-step mapping, all commands, and configurations.

## Related Documentation

| File | Purpose |
|------|---------|
| `GCP-INSTALL.md` | Complete 12-step GCP deployment guide with project folder annotations |
| `SETUP.md` | Quick single-profile OAuth2 setup (good for first-time dev onboarding) |
| `MAUTIC-7X-REVIEW.md` | Analysis of Mautic 7.x (Columba, Jan 2026) — integration opportunities, bounce handling improvements, and recommendations for this project |

## Common Tasks

### Add a new sender profile
1. Create OAuth2 client in GCP Console
2. Generate refresh token via OAuth Playground
3. Add `{PREFIX}_CLIENT_ID`, `{PREFIX}_CLIENT_SECRET`, `{PREFIX}_REFRESH_TOKEN`, `{PREFIX}_SENDER_EMAIL`, `{PREFIX}_SENDER_NAME` to `.env.example`
4. Add profile entry to `PROFILES` object in `src/config/credentials.js`
5. Store secrets in Secret Manager for production

### Add a new webhook event type
1. Add case to the switch in `src/webhooks/server.js` `POST /mailer/callback`
2. Add corresponding DB function in `src/services/database.js` if needed
3. Update `database.rules.json` if a new collection is required

### Add a new API endpoint
1. Add route to `src/relay/server.js` (relay) or `src/webhooks/server.js` (tracking)
2. Follow existing pattern: input validation, try/catch, JSON response
3. Update the architecture diagram in `GCP-INSTALL.md`

### Switch email transport
Set `EMAIL_TRANSPORT=duocircle` in `.env` or Cloud Run env vars. Both transports use the same `sendEmail()` pipeline so tracking still works.
