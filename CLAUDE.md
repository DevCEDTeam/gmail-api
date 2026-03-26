# CLAUDE.md

Project guide for AI assistants working on this codebase.

## Project Overview

Gmail Bulk Sending System (v2.0.0) — a Node.js email relay with full tracking (bounces, opens, spam, unsubscribes) via Gmail OAuth2, Firebase Realtime Database, and optional DuoCircle SMTP. Designed for the domain `cfored.com`. GCP Project ID: `gmail-bulk-sending-389112`.

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
├── .env.example               # Environment variable template
├── Dockerfile                 # Cloud Run image (node:20-alpine)
├── firebase.json              # Firebase CLI config (rules + functions paths)
├── database.rules.json        # Firebase RTDB security rules & indexes
├── package.json               # Dependencies + npm scripts
│
├── functions/
│   └── index.js               # Cloud Functions: processEmailQueue + weeklyReport
│
└── src/
    ├── config/
    │   ├── credentials.js     # OAuth2 multi-profile manager (3 wristbands)
    │   └── firebase.js        # Firebase Admin SDK init (singleton)
    ├── services/
    │   ├── email.js           # Core send logic + tracking pixel + suppression
    │   └── database.js        # Firebase RTDB data-access layer (6 collections)
    ├── relay/
    │   └── server.js          # Express: /relay/send, /relay/bulk, /relay/queue, /relay/stats
    ├── webhooks/
    │   └── server.js          # Express: /mailer/callback, /tracking/open/:id, /email/unsubscribe/:id, /email/dnc/:id
    ├── queue/
    │   └── worker.js          # Processes /queue items with concurrency control
    └── reports/
        └── generate.js        # Weekly digest email with metric grading
```

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

### Secret Manager vs Environment Variables

`src/config/credentials.js` resolves credentials in this order:
1. Google Secret Manager (when `USE_SECRET_MANAGER=true`) — production
2. Environment variables — local development

Secret IDs follow the pattern: `oauth-secret-client{1,2,3}`, `oauth-refresh-{general,director,team}`, `duocircle-smtp-password`.

### Transport Layer

`src/services/email.js` supports two transports selected by `EMAIL_TRANSPORT` env var:
- `gmail` (default) — Gmail OAuth2 via googleapis + nodemailer
- `duocircle` — DuoCircle SMTP relay for high-volume sends

### Firebase RTDB Collections

Managed by `src/services/database.js`. Rules in `database.rules.json`.

| Collection | Purpose | Key Fields |
|------------|---------|------------|
| `/queue` | Outbound email jobs | status, to, subject, profile |
| `/deliveries` | Sent email records | trackingId, to, messageId, sentVia |
| `/bounces` | Hard & soft bounces | email, type (hard/soft), reason |
| `/spam` | Spam complaints | email, feedbackType |
| `/opens` | Open tracking events | trackingId/{pushKey}/openedAt |
| `/suppressions` | DNC list | email, reason, suppressedAt |

Suppression keys are base64-encoded emails with special chars replaced.

### Email Send Pipeline

Every send in `src/services/email.js` follows this flow:
1. Check suppression list (skip if suppressed)
2. Generate UUID tracking ID
3. Append 1x1 tracking pixel to HTML
4. Build transport (Gmail or DuoCircle)
5. Add List-Unsubscribe headers (RFC 8058)
6. Send via nodemailer
7. Record delivery in Firebase
8. Update queue item status (if queued)

### Webhook Event Types

`src/webhooks/server.js` handles these callback types at `POST /mailer/callback`:
- `bounce`, `hard_bounce` — adds to DNC immediately
- `soft_bounce` — adds to DNC after 5 occurrences (`SOFT_BOUNCE_THRESHOLD`)
- `spam`, `complaint`, `spam_complaint` — adds to DNC immediately
- `unsubscribe`, `unsub` — adds to DNC

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
GET  /email/unsubscribe/:trackingId → Unsubscribe confirmation page
POST /email/unsubscribe/:trackingId → Process unsubscribe (RFC 8058 one-click)
GET  /email/dnc/:trackingId         → Full DNC opt-out
```

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

Cloud Functions additionally use `firebase-functions` (installed separately in `functions/`).

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

### Naming
- Services use domain metaphors: "Blue Truck" (relay), "Orange Airplane" (queue worker)
- OAuth2 credential sets are called "wristbands"
- Files are named by their domain: `relay/server.js`, `webhooks/server.js`, `queue/worker.js`
- Firebase singleton uses `initialised` flag (British spelling)

### Security
- `.env` and `service-account-key.json` are in `.gitignore` — never commit secrets
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
firebase deploy --only functions
```

### Firebase Rules
```bash
firebase deploy --only database
```

See `GCP-INSTALL.md` for the complete 12-step deployment guide with all commands and configurations.

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
