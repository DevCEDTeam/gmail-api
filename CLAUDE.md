# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run Commands

```bash
npm start          # Start all 3 services locally (relay + webhooks + worker)
npm run relay      # Blue Truck relay only (port 3000)
npm run webhooks   # Webhook/tracking server only (port 3001)
npm run worker     # Orange Airplane queue processor only
npm run report     # Generate and send weekly report
```

No test suite or linter is configured. `npm test` exits with an error.

Cloud Functions require separate dependency installation before deploying:
```bash
cd functions && npm init -y && npm install firebase-functions firebase-admin && cd ..
firebase deploy --only functions
```

## Architecture

Gmail Bulk Sending System (v2.0.0) — a Node.js email relay with full tracking (bounces, opens, clicks, spam, unsubscribes) via Gmail OAuth2 or DuoCircle SMTP, with Firebase Realtime Database for state. Domain: `cfored.com`. GCP Project: `gmail-bulk-sending-389112` (number: `895054114655`).

### Three Independent Services

| Service | Nickname | Entry Point | Port | Deploy Target |
|---------|----------|-------------|------|---------------|
| Relay | Blue Truck | `src/relay/server.js` | 3000 | Cloud Run |
| Webhooks | Tracking | `src/webhooks/server.js` | 3001 | Cloud Run |
| Worker | Orange Airplane | `src/queue/worker.js` | N/A | Cloud Function |

`app.js` starts all three for local dev. In production they run independently. `functions/index.js` wraps the worker as a Firebase Cloud Function with a separate `firebase-admin` init (not shared with `src/`).

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

No circular dependencies. Config modules are leaves; services sit in the middle; servers are top-level consumers.

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

### Three OAuth2 Profiles ("Wristbands")

Defined in `src/config/credentials.js` with env var prefixes `GENERAL_`, `DIRECTOR_`, `TEAM_`. Each needs `{PREFIX}CLIENT_ID`, `{PREFIX}CLIENT_SECRET`, `{PREFIX}REFRESH_TOKEN`, `{PREFIX}SENDER_EMAIL`, `{PREFIX}SENDER_NAME`. Default profile is `director`.

Credentials resolve via: Secret Manager (when `USE_SECRET_MANAGER=true`) → env var fallback. OAuth2 clients are cached in a `Map` per process.

### Queue Status Lifecycle

`pending` → `processing` → `sent` | `skipped_suppressed` | `failed`

### Firebase RTDB Collections (database.rules.json)

`/queue`, `/deliveries`, `/bounces`, `/spam`, `/opens`, `/clicks`, `/suppressions`. Suppression keys are base64-encoded emails with `[.#$/[\]]` replaced by `_`.

### Webhook Callback (POST /mailer/callback)

Accepts single event or array. Switch on `type`: `bounce`/`hard_bounce` → immediate DNC; `soft_bounce` → DNC after 5 occurrences; `spam`/`complaint`/`spam_complaint` → immediate DNC; `unsubscribe`/`unsub` → DNC.

## Key Conventions

- **CommonJS** `require()` — no ES modules
- **`async/await`** throughout — no raw Promise chains
- **Console logging** with bracketed prefixes: `[relay]`, `[worker]`, `[email]`, `[callback]`
- **Fire-and-forget tracking**: open/click tracking always returns response even if DB write fails
- **Graceful degradation**: Firebase failure doesn't crash — tracking is just disabled
- **Suppression returns**: `{skipped: true, reason: "suppressed"}` instead of throwing
- **British spelling**: Firebase singleton uses `initialised` flag
- `.env` is gitignored; `service-account-key.json` should also be gitignored locally

## Deployment

- **Cloud Run**: `Dockerfile` (node:20-alpine) for relay + webhooks
- **Cloud Functions**: `functions/index.js` for queue worker + weekly report schedule
- **Firebase Rules**: `firebase deploy --only database` deploys `database.rules.json`
- See `GCP-INSTALL.md` for the full 12-step guide; `SETUP.md` for single-profile OAuth2 quickstart; `MAINTENANCE.md` for the operational runbook (credential rotation, queue recovery, data pruning)
