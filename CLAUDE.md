# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run Commands

```bash
npm start          # Start all 3 services locally (relay + webhooks + worker)
npm run relay      # Blue Truck relay only (port 3000)
npm run webhooks   # Webhook/tracking server only (port 3001)
npm run worker     # Orange Airplane queue processor only
npm run report     # Generate and send weekly report
node src/queue/worker.js --once   # Drain queue backlog (≤200 items) and exit
```

No test suite or linter is configured. `npm test` exits with an error. After changes, verify with `node --check <file>` and boot via `npm start` + `curl localhost:3000/health`.

Cloud Functions require separate dependency installation before deploying:
```bash
cd functions && npm init -y && npm install firebase-functions firebase-admin && cd ..
firebase deploy --only functions
```

## Project Identifiers

| Field | Value |
|-------|-------|
| GCP Project name | `gmail-bulk-sending` |
| GCP Project number | `895054114655` |
| GCP Project ID | `gmail-bulk-sending-389112` |
| Domain | `cfored.com` |
| Firebase RTDB | `https://gmail-bulk-sending-389112-default-rtdb.firebaseio.com` |

## Architecture

Gmail Bulk Sending System (v2.0.0) — a Node.js email relay with full tracking (bounces, opens, clicks, spam, unsubscribes) via Gmail OAuth2 or DuoCircle SMTP, with Firebase Realtime Database for state.

### Three Independent Services

| Service | Nickname | Entry Point | Port | Deploy Target |
|---------|----------|-------------|------|---------------|
| Relay | Blue Truck | `src/relay/server.js` | 3000 | Cloud Run |
| Webhooks | Tracking | `src/webhooks/server.js` | 3001 | Cloud Run |
| Worker | Orange Airplane | `src/queue/worker.js` | N/A | Cloud Function |

`app.js` starts all three for local dev. In production they run independently. `functions/index.js` wraps the worker as a Firebase Cloud Function (`processEmailQueue` on `/queue` writes + `weeklyReport` Mondays 9 AM CST) with a separate `firebase-admin` init (not shared with `src/`).

### Data Flow

```
src/config/credentials.js  ──→  resolves OAuth2 tokens (3 profiles) or DuoCircle SMTP creds
src/config/firebase.js     ──→  Firebase Admin singleton (getDatabase())
         │                              │
         ▼                              ▼
src/services/email.js              src/services/database.js
(suppression check → tracking      (CRUD for 7 Firebase collections:
 pixel → click wrapping →          queue, deliveries, bounces, spam,
 transport → send → record)        opens, clicks, suppressions)
         │                              │
    ┌────┴────────┐              ┌──────┴──────┐
    ▼             ▼              ▼             ▼
src/relay/    src/queue/     src/webhooks/  src/reports/
server.js     worker.js      server.js      generate.js
```

No circular dependencies. Config modules are leaves; services sit in the middle; servers are top-level consumers. `src/middleware/` exists but is empty (reserved).

### Email Send Pipeline (src/services/email.js)

Every send follows this flow:
1. Check suppression list → skip if on DNC
2. Generate UUID tracking ID
3. Append 1x1 tracking pixel to HTML
4. Rewrite `<a href>` links for click tracking (skips `mailto:`, `#`, unsubscribe/dnc links)
5. Build transport — `EMAIL_TRANSPORT=duocircle` uses SMTP, default uses Gmail OAuth2
6. Resolve sender identity from profile (general/director/team)
7. Add List-Unsubscribe headers (RFC 8058)
8. Send via nodemailer
9. Record delivery in Firebase
10. Update queue item status if queued

Both transports share this pipeline, so tracking and suppression work identically. Suppressed sends return `{skipped: true, reason: "suppressed"}` instead of throwing — callers must check `result.skipped`, not just catch errors.

### Three OAuth2 Profiles ("Wristbands")

Defined in `src/config/credentials.js` with env var prefixes `GENERAL_`, `DIRECTOR_`, `TEAM_`:

| Profile | OAuth Client | Sender |
|---------|-------------|--------|
| `general` | gmail-bulk-sending-1 | noreply@cfored.com |
| `director` (default) | gmail-bulk-sending-2 | director@cfored.com |
| `team` | gmail-bulk-sending-3 | team@cfored.com |

Each needs `{PREFIX}CLIENT_ID`, `{PREFIX}CLIENT_SECRET`, `{PREFIX}REFRESH_TOKEN`, `{PREFIX}SENDER_EMAIL`, `{PREFIX}SENDER_NAME`.

Credentials resolve via: Secret Manager (when `USE_SECRET_MANAGER=true`) → env var fallback. Secret IDs: `oauth-secret-client{1,2,3}`, `oauth-refresh-{general,director,team}`, `duocircle-smtp-password`. OAuth2 clients are cached in a `Map` per process — rotating a credential requires a process restart to take effect.

### Queue Status Lifecycle

`pending` → `processing` → `sent` | `skipped_suppressed` | `failed`

Created as `pending` by `/relay/queue`; the worker marks `processing` before sending, then a terminal state. `failed` items carry an `error` field. Before resetting a stuck `processing` item to `pending`, check `/deliveries` for the recipient to avoid duplicate sends.

### Firebase RTDB Collections (database.rules.json)

`/queue`, `/deliveries`, `/bounces`, `/spam`, `/opens`, `/clicks`, `/suppressions`.

- `/opens` and `/clicks` are nested: `/{trackingId}/{pushKey}` — `getStats()` in `database.js` flattens this shape
- Suppression keys are base64-encoded lowercased emails with `[.#$/[\]]` replaced by `_` — the same encoding must be used in both write and check paths, or DNC is silently bypassed
- `/suppressions` entries never expire; `spam_complaint`/`unsubscribed`/`dnc_all_channels` reasons must never be removed

### Webhook Callback (POST /mailer/callback)

Accepts single event or array. Switch on `type`: `bounce`/`hard_bounce` → immediate DNC; `soft_bounce` → DNC after 5 occurrences (`SOFT_BOUNCE_THRESHOLD`); `spam`/`complaint`/`spam_complaint` → immediate DNC; `unsubscribe`/`unsub` → DNC. Email extracted from `event.email` → `event.recipient` → `event.contact.email`; events missing an email are logged and skipped, never thrown.

## API Surface

### Relay (port 3000)
```
GET  /health
POST /relay/send    {to, subject, html, text?, profile?}
POST /relay/bulk    {recipients[], subject, html, text?, profile?}
POST /relay/queue   {to, subject, html, text?, profile?}   → hands off to worker
GET  /relay/stats   ?since=ISO-date (default last 7 days)
```

### Webhooks (port 3001)
```
GET  /health
POST /mailer/callback                                  ESP/Mautic events (single or array)
GET  /tracking/open/:trackingId                        1x1 GIF, records open
GET  /tracking/click/:trackingId/:linkId?url=ENCODED   records click, 302 → url
GET  /email/unsubscribe/:trackingId                    confirmation page
POST /email/unsubscribe/:trackingId                    RFC 8058 one-click
GET  /email/dnc/:trackingId                            full DNC opt-out
```

## Key Conventions

- **CommonJS** `require()` — no ES modules
- **`async/await`** throughout — no raw Promise chains
- **Console logging** with bracketed prefixes: `[relay]`, `[worker]`, `[email]`, `[callback]`, `[open-tracking]`, `[click-tracking]`
- **Fire-and-forget tracking**: open/click endpoints always return their response (pixel/redirect) even if the DB write fails
- **Graceful degradation**: Firebase failure doesn't crash — tracking is just disabled
- **British spelling**: Firebase singleton uses `initialised` flag
- `.env` is gitignored; `service-account-key.json` must also never be committed
- Never place real credentials in `.env.example`, docs, or code — placeholders only; live values go in `.env` (local) or Secret Manager (production)

## Common Tasks

- **Add a sender profile**: create OAuth client in GCP Console → refresh token via OAuth Playground → add the 5 env vars to `.env.example` → add entry to `PROFILES` in `src/config/credentials.js` → add secrets to Secret Manager
- **Add a webhook event type**: new case in the `/mailer/callback` switch → DB function in `database.js` if needed → collection rules in `database.rules.json` if new collection
- **Switch transport**: set `EMAIL_TRANSPORT=duocircle` (env or Cloud Run); DuoCircle vars: `DUOCIRCLE_HOST/PORT/USER/PASS/SECURE`
- **Rotate credentials**: new Secret Manager version → restart Cloud Run services (in-process cache) — full steps in `MAINTENANCE.md`

## Deployment

- **Cloud Run**: `Dockerfile` (node:20-alpine) for relay + webhooks
- **Cloud Functions**: `functions/index.js` for queue worker + weekly report schedule
- **Firebase Rules**: `firebase deploy --only database` deploys `database.rules.json`

## Documentation Map

| File | Purpose |
|------|---------|
| `GCP-INSTALL.md` | Full 12-step deployment guide with folder-to-step mapping |
| `SETUP.md` | Single-profile OAuth2 quickstart |
| `MAINTENANCE.md` | Operational runbook: credential rotation, queue recovery, data pruning, troubleshooting |
| `MAUTIC-7X-REVIEW.md` | Mautic 7.x (Columba) compatibility analysis and integration notes |
