# GCP Installation Guide — Gmail Bulk Sending System

Step-by-step deployment on Google Cloud Platform.

---

## Prerequisites

- GCP account with billing enabled
- `gcloud` CLI installed ([install guide](https://cloud.google.com/sdk/docs/install))
- Node.js 20+ on your local machine
- A domain (e.g. `cfored.com`) with DNS access

---

## Project Folder Structure

Every file in this repo has a specific role. The tree below shows what each file does and which installation step uses it.

```
gmail-api/
│
│── app.js                          # Main entry point — starts all 3 services locally
│                                   #   Blue Truck + Webhooks + Orange Airplane
│                                   #   Usage: npm start  |  node app.js
│                                   #   Used in: Step 6 (Cloud Run), Step 11 (GCE VM)
│
│── .env.example                    # Template for all environment variables
│                                   #   Copy to .env and fill in your values
│                                   #   Used in: Step 5 (env config), Step 11 (VM setup)
│
│── Dockerfile                      # Docker image for Cloud Run deployment
│                                   #   Runs app.js inside node:20-alpine
│                                   #   Used in: Step 6a (build & push image)
│
│── package.json                    # Node.js project manifest — defines npm scripts:
│                                   #   npm start     → node app.js       (all services)
│                                   #   npm run relay → node src/relay/server.js
│                                   #   npm run worker → node src/queue/worker.js
│                                   #   npm run webhooks → node src/webhooks/server.js
│                                   #   npm run report → node src/reports/generate.js
│
│── firebase.json                   # Firebase project config — tells Firebase CLI where to find:
│                                   #   database rules  → database.rules.json
│                                   #   cloud functions → functions/ directory
│                                   #   Used in: Step 4b (deploy rules), Step 5b (deploy functions)
│
│── database.rules.json             # Firebase RTDB security rules + indexes
│                                   #   Defines read/write auth and indexes for:
│                                   #   /queue, /deliveries, /bounces, /spam, /opens, /suppressions
│                                   #   Used in: Step 4b (firebase deploy --only database)
│
│── functions/
│   └── index.js                    # Cloud Functions entry point — "Orange Airplane"
│                                   #   processEmailQueue: triggered on /queue writes
│                                   #   weeklyReport: scheduled every Monday 9 AM CST
│                                   #   Used in: Step 5b (firebase deploy --only functions)
│
│── src/
│   │── config/
│   │   │── credentials.js          # Multi-profile OAuth2 credential manager
│   │   │                           #   3 profiles: general, director, team
│   │   │                           #   Loads secrets from Secret Manager (prod) or env vars (dev)
│   │   │                           #   Secret IDs: oauth-secret-client{1,2,3}, oauth-refresh-{general,director,team}
│   │   │                           #   Used in: Step 2 (create OAuth clients), Step 3 (store secrets)
│   │   │
│   │   └── firebase.js             # Firebase Admin SDK initialisation
│   │                               #   Uses Application Default Credentials in GCP
│   │                               #   Locally: set GOOGLE_APPLICATION_CREDENTIALS env var
│   │                               #   Used in: Step 4 (Firebase setup)
│   │
│   │── services/
│   │   │── email.js                # Core email sending service with full tracking
│   │   │                           #   - Open tracking pixel injection (1x1 GIF)
│   │   │                           #   - List-Unsubscribe headers (RFC 8058)
│   │   │                           #   - Suppression list check before every send
│   │   │                           #   - Delivery recording to Firebase
│   │   │                           #   - Gmail OAuth2 or DuoCircle SMTP transport
│   │   │                           #   Used in: Step 2 (OAuth), Step 10 (DuoCircle)
│   │   │
│   │   └── database.js             # Firebase RTDB data-access layer
│   │                               #   CRUD for: /queue, /deliveries, /bounces,
│   │                               #   /spam, /opens, /suppressions
│   │                               #   Used in: Step 4 (Firebase RTDB setup)
│   │
│   │── relay/
│   │   └── server.js               # "Blue Truck" HTTP relay server (Express)
│   │                               #   POST /relay/send    — single email
│   │                               #   POST /relay/bulk    — bulk email
│   │                               #   POST /relay/queue   — async queue
│   │                               #   GET  /relay/stats   — delivery stats
│   │                               #   GET  /health        — health check
│   │                               #   Used in: Step 6b (Cloud Run deploy), Step 9 (cPanel integration)
│   │
│   │── webhooks/
│   │   └── server.js               # Webhook + tracking server (Express)
│   │                               #   POST /mailer/callback       — Mautic/ESP bounce & spam
│   │                               #   GET  /tracking/open/:id     — open-tracking pixel
│   │                               #   GET  /email/unsubscribe/:id — unsubscribe page
│   │                               #   GET  /email/dnc/:id         — full do-not-contact
│   │                               #   Used in: Step 6c (webhook Cloud Run), Step 7 (Mautic config)
│   │
│   │── queue/
│   │   └── worker.js               # "Orange Airplane" queue processor
│   │                               #   Watches Firebase /queue for pending email jobs
│   │                               #   Can run standalone (npm run worker) or as Cloud Function
│   │                               #   Supports --once flag for one-shot processing
│   │                               #   Used in: Step 5 (Cloud Functions deploy)
│   │
│   └── reports/
│       └── generate.js             # Weekly report generator — "Report Card"
│                                   #   Aggregates opens, bounces, spam, unsubscribes
│                                   #   Sends HTML report email to REPORT_RECIPIENT
│                                   #   Used in: Step 5 (Cloud Function schedule), Step 11 (cron)
│
│── .gitignore                      # Excludes .env, node_modules, service-account-key.json
└── .dockerignore                   # Excludes node_modules from Docker builds
```

### How files connect (data flow)

```
.env.example ──→ .env (your secrets)
                   │
                   ▼
              src/config/credentials.js ──→ loads OAuth2 tokens
              src/config/firebase.js    ──→ connects to Firebase RTDB
                   │
         ┌─────────┴──────────┐
         ▼                    ▼
  src/services/email.js    src/services/database.js
  (send via Gmail/DuoCircle)   (read/write Firebase)
         │                    │
    ┌────┴────┐          ┌────┴────┐
    ▼         ▼          ▼         ▼
src/relay/  src/queue/  src/webhooks/  src/reports/
server.js   worker.js   server.js      generate.js
(Blue Truck) (Orange     (Tracking     (Weekly
  HTTP API)  Airplane)    + Callbacks)  Report Card)
         │         │          │
         └────┬────┘          │
              ▼               ▼
           app.js          functions/index.js
        (local dev —       (Cloud Functions —
         all-in-one)        production triggers)
              │
              ▼
          Dockerfile
       (Cloud Run image)
```

### Which files matter at each step

| Step | Files Involved |
|---|---|
| Step 1: GCP Project Setup | *(GCP Console only — no project files)* |
| Step 2: OAuth2 Clients | `src/config/credentials.js` — reads the Client IDs, Secrets, Refresh Tokens |
| Step 3: Secret Manager | `src/config/credentials.js` — `loadFromSecretManager()` loads secrets by ID |
| Step 4: Firebase RTDB | `firebase.json`, `database.rules.json`, `src/config/firebase.js`, `src/services/database.js` |
| Step 5: Cloud Functions | `functions/index.js`, `src/queue/worker.js`, `src/reports/generate.js` |
| Step 6: Cloud Run | `Dockerfile`, `app.js`, `src/relay/server.js`, `src/webhooks/server.js` |
| Step 7: Mautic Webhooks | `src/webhooks/server.js` — `/mailer/callback` endpoint |
| Step 8: DNS Tracking | `src/services/email.js` — uses `TRACKING_BASE_URL` for pixel URLs |
| Step 9: cPanel Integration | `src/relay/server.js` — `/relay/send`, `/relay/bulk`, `/relay/queue` |
| Step 10: DuoCircle | `src/services/email.js` — `createDuoCircleTransport()`, `src/config/credentials.js` — `getDuoCirclePassword()` |
| Step 11: GCE VM | `app.js`, `.env.example` → `.env`, `package.json` (npm scripts) |
| Step 12: Verify | `src/relay/server.js` (`/health`), `src/webhooks/server.js` (`/tracking/open/:id`) |

---

## Step 1: GCP Project Setup

```bash
# Project details:
#   Name:   gmail-bulk-sending
#   Number: 895054114655
#   ID:     gmail-bulk-sending-389112
export PROJECT_ID="gmail-bulk-sending-389112"

# Authenticate
gcloud auth login
gcloud config set project $PROJECT_ID

# Enable required APIs
gcloud services enable \
  gmail.googleapis.com \
  secretmanager.googleapis.com \
  cloudfunctions.googleapis.com \
  run.googleapis.com \
  firebase.googleapis.com \
  firebasedatabase.googleapis.com \
  cloudbuild.googleapis.com
```

---

## Step 2: Create 3 OAuth2 Clients ("Wristbands")

Go to [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials).

### 2a. Configure OAuth Consent Screen (one-time)

1. Click **OAuth consent screen** → select **External** → **Create**
2. Fill in:
   - App name: `gmail-bulk-sending`
   - User support email: `director@cfored.com`
   - Developer contact: `director@cfored.com`
3. **Scopes** → Add:
   - `https://mail.google.com/`
   - `https://www.googleapis.com/auth/gmail.send`
4. **Test users** → Add all sender emails (director@, team@, noreply@)
5. Click **Publish App** when ready for production

### 2b. Create 3 OAuth Client IDs

Repeat for each profile:

| Client Name | Sender Email |
|---|---|
| `gmail-bulk-sending-1` (General) | `noreply@cfored.com` |
| `gmail-bulk-sending-2` (Director) | `director@cfored.com` |
| `gmail-bulk-sending-3` (Team) | `team@cfored.com` |

For each:

1. **Credentials** → **Create Credentials** → **OAuth Client ID**
2. Application type: **Web application**
3. Name: `gmail-bulk-sending-1` (or 2, or 3)
4. Authorized redirect URIs: `https://developers.google.com/oauthplayground`
5. Click **Create** → save the **Client ID** and **Client Secret**

### 2c. Generate Refresh Tokens

For each of the 3 clients:

1. Go to [OAuth Playground](https://developers.google.com/oauthplayground/)
2. Click the ⚙️ gear icon (top right)
3. Check **Use your own OAuth credentials**
4. Paste Client ID and Client Secret for that client
5. In the left panel, find **Gmail API v1** → select `https://mail.google.com/`
6. Click **Authorize APIs**
7. Sign in with the corresponding sender email (director@, team@, etc.)
8. Click **Exchange authorization code for tokens**
9. Copy the **Refresh Token**

You should now have 9 values (3 clients × 3 values each):

```
Client 1: GENERAL_CLIENT_ID, GENERAL_CLIENT_SECRET, GENERAL_REFRESH_TOKEN
Client 2: DIRECTOR_CLIENT_ID, DIRECTOR_CLIENT_SECRET, DIRECTOR_REFRESH_TOKEN
Client 3: TEAM_CLIENT_ID, TEAM_CLIENT_SECRET, TEAM_REFRESH_TOKEN
```

---

## Step 3: Store Secrets in Google Secret Manager

```bash
# Store each secret (repeat for all 6 sensitive values)
# Client secrets
echo -n "YOUR_GENERAL_CLIENT_SECRET" | \
  gcloud secrets create oauth-secret-client1 --data-file=-

echo -n "YOUR_DIRECTOR_CLIENT_SECRET" | \
  gcloud secrets create oauth-secret-client2 --data-file=-

echo -n "YOUR_TEAM_CLIENT_SECRET" | \
  gcloud secrets create oauth-secret-client3 --data-file=-

# Refresh tokens
echo -n "YOUR_GENERAL_REFRESH_TOKEN" | \
  gcloud secrets create oauth-refresh-general --data-file=-

echo -n "YOUR_DIRECTOR_REFRESH_TOKEN" | \
  gcloud secrets create oauth-refresh-director --data-file=-

echo -n "YOUR_TEAM_REFRESH_TOKEN" | \
  gcloud secrets create oauth-refresh-team --data-file=-
```

Verify they were created:

```bash
gcloud secrets list
```

---

## Step 4: Set Up Firebase Realtime Database

### 4a. Create the database

```bash
# Install Firebase CLI if not present
npm install -g firebase-tools

# Login
firebase login

# Initialize project (select Realtime Database + Functions)
firebase use $PROJECT_ID
```

Or via Console:

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click **Add project** → select your existing GCP project
3. **Build** → **Realtime Database** → **Create Database**
4. Location: `us-central1`
5. Start in **locked mode** (we'll deploy rules next)

### 4b. Deploy database rules

```bash
# From the project root
firebase deploy --only database
```

This deploys `database.rules.json` which creates indexes on all collections.

### 4c. Create a service account key (for local dev and cPanel)

```bash
# Create service account
gcloud iam service-accounts create gmail-relay \
  --display-name="Gmail Relay Service Account"

# Grant permissions
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:gmail-relay@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/firebase.admin"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:gmail-relay@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

# Download key file
gcloud iam service-accounts keys create service-account-key.json \
  --iam-account="gmail-relay@${PROJECT_ID}.iam.gserviceaccount.com"
```

> **IMPORTANT**: Keep `service-account-key.json` safe. Never commit it to git.

---

## Step 5: Deploy Cloud Functions (Orange Airplane)

### 5a. Install function dependencies

```bash
cd functions
npm init -y
npm install firebase-functions firebase-admin
cd ..
```

### 5b. Deploy

```bash
firebase deploy --only functions
```

This deploys:
- `processEmailQueue` — triggered on new `/queue` writes
- `weeklyReport` — runs every Monday 9:00 AM CST

Verify:

```bash
firebase functions:list
```

---

## Step 6: Deploy Blue Truck to Cloud Run

### 6a. Build and push Docker image

```bash
# Build
gcloud builds submit --tag gcr.io/$PROJECT_ID/gmail-relay

# Or build locally
docker build -t gcr.io/$PROJECT_ID/gmail-relay .
docker push gcr.io/$PROJECT_ID/gmail-relay
```

### 6b. Deploy to Cloud Run

```bash
gcloud run deploy gmail-relay \
  --image gcr.io/$PROJECT_ID/gmail-relay \
  --region us-central1 \
  --platform managed \
  --memory 512Mi \
  --min-instances 0 \
  --max-instances 3 \
  --port 3000 \
  --set-env-vars "\
USE_SECRET_MANAGER=true,\
GCP_PROJECT_ID=$PROJECT_ID,\
FIREBASE_DATABASE_URL=https://${PROJECT_ID}-default-rtdb.firebaseio.com,\
GENERAL_CLIENT_ID=YOUR_GENERAL_CLIENT_ID,\
DIRECTOR_CLIENT_ID=YOUR_DIRECTOR_CLIENT_ID,\
TEAM_CLIENT_ID=YOUR_TEAM_CLIENT_ID,\
GENERAL_SENDER_EMAIL=noreply@cfored.com,\
GENERAL_SENDER_NAME=cfored.com,\
DIRECTOR_SENDER_EMAIL=director@cfored.com,\
DIRECTOR_SENDER_NAME=Director,\
TEAM_SENDER_EMAIL=team@cfored.com,\
TEAM_SENDER_NAME=Team cfored,\
MAUTIC_BASE_URL=https://mautic.cfored.com,\
TRACKING_BASE_URL=https://mautic.cfored.com,\
DOMAIN=cfored.com,\
RELAY_PORT=3000,\
WEBHOOK_PORT=3001,\
REPORT_RECIPIENT=director@cfored.com" \
  --service-account="gmail-relay@${PROJECT_ID}.iam.gserviceaccount.com" \
  --allow-unauthenticated
```

> Note: Client IDs are NOT secrets. Client Secrets and Refresh Tokens are loaded from Secret Manager at runtime (`USE_SECRET_MANAGER=true`).

Get the deployed URL:

```bash
gcloud run services describe gmail-relay --region us-central1 --format='value(status.url)'
# Example output: https://gmail-relay-xxxxx-uc.a.run.app
```

### 6c. Deploy webhook server (separate Cloud Run service)

```bash
gcloud run deploy gmail-webhooks \
  --image gcr.io/$PROJECT_ID/gmail-relay \
  --region us-central1 \
  --platform managed \
  --memory 256Mi \
  --port 3001 \
  --command "node" \
  --args "src/webhooks/server.js" \
  --set-env-vars "\
USE_SECRET_MANAGER=true,\
GCP_PROJECT_ID=$PROJECT_ID,\
FIREBASE_DATABASE_URL=https://${PROJECT_ID}-default-rtdb.firebaseio.com,\
MAUTIC_BASE_URL=https://mautic.cfored.com,\
WEBHOOK_PORT=3001" \
  --service-account="gmail-relay@${PROJECT_ID}.iam.gserviceaccount.com" \
  --allow-unauthenticated
```

Get webhook URL:

```bash
WEBHOOK_URL=$(gcloud run services describe gmail-webhooks --region us-central1 --format='value(status.url)')
echo "Webhook URL: $WEBHOOK_URL"
```

---

## Step 7: Configure Mautic Webhooks

In your Mautic instance (`https://mautic.cfored.com`):

1. Go to **Settings** → **Webhooks** → **New**
2. Name: `Gmail Tracking Callbacks`
3. Webhook POST URL: `https://gmail-webhooks-xxxxx-uc.a.run.app/mailer/callback`
4. Events to send:
   - Email bounced
   - Email unsubscribed
   - Email marked as spam
5. Save

---

## Step 8: Configure DNS for Open Tracking

If you want the tracking pixel served from your domain instead of Cloud Run:

```
# Add a CNAME record
tracking.cfored.com  →  gmail-webhooks-xxxxx-uc.a.run.app
```

Then update `TRACKING_BASE_URL` in your Cloud Run env vars:

```bash
gcloud run services update gmail-relay \
  --region us-central1 \
  --update-env-vars "TRACKING_BASE_URL=https://tracking.cfored.com"
```

---

## Step 9: Connect cPanel (Exim) to Blue Truck

On your cPanel server, configure Exim to relay outbound mail through the Blue Truck API.

### Option A: cURL from a PHP/Node script

```php
<?php
// send-via-relay.php — called by your application
$relay_url = 'https://gmail-relay-xxxxx-uc.a.run.app/relay/send';

$payload = json_encode([
    'to'      => 'recipient@example.com',
    'subject' => 'Hello from cfored.com',
    'html'    => '<h1>Welcome!</h1><p>This is a tracked email.</p>',
    'profile' => 'director',
]);

$ch = curl_init($relay_url);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
$response = curl_exec($ch);
curl_close($ch);

echo $response;
// Output: {"success":true,"trackingId":"abc-123-...","messageId":"<xxx@gmail.com>"}
```

### Option B: Node.js from cPanel

```javascript
// send-via-relay.js — run on cPanel server
const https = require('https');

const data = JSON.stringify({
  to: 'recipient@example.com',
  subject: 'Hello from cfored.com',
  html: '<h1>Welcome!</h1><p>This is a tracked email.</p>',
  profile: 'team',
});

const url = new URL('https://gmail-relay-xxxxx-uc.a.run.app/relay/send');

const req = https.request({
  hostname: url.hostname,
  path: url.pathname,
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': data.length },
}, (res) => {
  let body = '';
  res.on('data', (chunk) => { body += chunk; });
  res.on('end', () => { console.log(JSON.parse(body)); });
});

req.write(data);
req.end();
```

### Option C: Queue emails for async sending

```bash
# From cPanel or any server — queue an email
curl -X POST https://gmail-relay-xxxxx-uc.a.run.app/relay/queue \
  -H "Content-Type: application/json" \
  -d '{
    "to": "recipient@example.com",
    "subject": "Queued email",
    "html": "<p>This will be sent by the Orange Airplane worker.</p>",
    "profile": "team"
  }'

# Response: {"success":true,"queued":true,"queueId":"-NxAbC123"}
```

### Option D: Bulk send

```bash
curl -X POST https://gmail-relay-xxxxx-uc.a.run.app/relay/bulk \
  -H "Content-Type: application/json" \
  -d '{
    "recipients": [
      "user1@example.com",
      "user2@example.com",
      "user3@example.com"
    ],
    "subject": "Newsletter #42",
    "html": "<h1>Latest news</h1><p>Content here...</p>",
    "profile": "director"
  }'

# Response:
# {
#   "success": true,
#   "total": 3,
#   "sent": 2,
#   "skipped": 1,   ← was on DNC list
#   "failed": 0,
#   "results": [...]
# }
```

---

## Step 10: DuoCircle SMTP Relay (Alternative Transport)

If you hit Gmail API sending limits (2,000/day per workspace user) or want a dedicated SMTP relay for higher volume, [DuoCircle](https://www.duocircle.com/) is a plug-in alternative. Emails still flow through the Blue Truck API, but the transport switches from Gmail OAuth2 to DuoCircle SMTP.

### 10a. Create a DuoCircle account

1. Sign up at [duocircle.com](https://www.duocircle.com/outbound-smtp)
2. Add your sending domain (`cfored.com`) and verify ownership
3. Note your SMTP credentials from the DuoCircle dashboard:
   - **SMTP Host**: `smtp.duocircle.com`
   - **Port**: `587` (STARTTLS) or `465` (SSL)
   - **Username**: your DuoCircle username (usually your email)
   - **Password**: your DuoCircle SMTP password

### 10b. Configure DNS records for DuoCircle

Add these DNS records for `cfored.com` to authorize DuoCircle as a sender:

```
# SPF — add DuoCircle to your existing SPF record
cfored.com  TXT  "v=spf1 include:_spf.google.com include:spf.duocircle.com ~all"

# DKIM — DuoCircle provides a DKIM key during domain setup
duocircle._domainkey.cfored.com  TXT  "v=DKIM1; k=rsa; p=<key-from-duocircle-dashboard>"

# DMARC — if not already set
_dmarc.cfored.com  TXT  "v=DMARC1; p=quarantine; rua=mailto:dmarc@cfored.com"
```

Verify propagation:

```bash
dig TXT cfored.com +short        # Check SPF
dig TXT duocircle._domainkey.cfored.com +short  # Check DKIM
```

### 10c. Add DuoCircle env vars

Add the following to your `.env` (or Cloud Run env vars):

```bash
# DuoCircle SMTP relay (alternative transport)
DUOCIRCLE_HOST=smtp.duocircle.com
DUOCIRCLE_PORT=587
DUOCIRCLE_USER=your-duocircle-username
DUOCIRCLE_PASS=your-duocircle-password
DUOCIRCLE_SECURE=false
# Set to 'duocircle' to route all email through DuoCircle instead of Gmail
# Set to 'gmail' (default) to keep using Gmail OAuth2
EMAIL_TRANSPORT=gmail
```

For Cloud Run, store the password in Secret Manager:

```bash
echo -n "YOUR_DUOCIRCLE_PASSWORD" | \
  gcloud secrets create duocircle-smtp-password --data-file=-

gcloud run services update gmail-relay \
  --region us-central1 \
  --update-env-vars "\
DUOCIRCLE_HOST=smtp.duocircle.com,\
DUOCIRCLE_PORT=587,\
DUOCIRCLE_USER=your-duocircle-username,\
DUOCIRCLE_SECURE=false,\
EMAIL_TRANSPORT=duocircle"
```

### 10d. Add DuoCircle transport to the email service

In `src/services/email.js`, add a DuoCircle transport factory alongside the existing Gmail one:

```javascript
/**
 * Build a Nodemailer transport for DuoCircle SMTP relay.
 */
function createDuoCircleTransport(profileName = 'director') {
  const creds = PROFILES[profileName] || PROFILES.director;
  return nodemailer.createTransport({
    host: process.env.DUOCIRCLE_HOST || 'smtp.duocircle.com',
    port: parseInt(process.env.DUOCIRCLE_PORT || '587', 10),
    secure: process.env.DUOCIRCLE_SECURE === 'true',
    auth: {
      user: process.env.DUOCIRCLE_USER,
      pass: process.env.DUOCIRCLE_PASS,
    },
  });
}
```

Update the `createTransport()` function to check `EMAIL_TRANSPORT`:

```javascript
async function createTransport(profileName = 'director') {
  if (process.env.EMAIL_TRANSPORT === 'duocircle') {
    return createDuoCircleTransport(profileName);
  }

  // Default: Gmail OAuth2
  const creds = await getOAuthClient(profileName);
  const { token } = await creds.oAuth2Client.getAccessToken();
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      type: 'OAuth2',
      user: creds.senderEmail,
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
      refreshToken: creds.refreshToken,
      accessToken: token,
    },
  });
}
```

### 10e. Route cPanel Exim through DuoCircle directly (optional)

If you want cPanel's Exim to use DuoCircle as a smarthost for **all** outbound mail (bypassing the Blue Truck API entirely for non-tracked emails):

1. In WHM, go to **Exim Configuration Manager** → **Basic Editor**
2. Under **Smart Host**, set:
   - **Smart Host**: `smtp.duocircle.com`
   - **SMTP Port**: `587`
3. Under **Advanced Editor** → `POSTMAILCOUNT` section, add authentication:

```
# /etc/exim.conf custom router (via WHM Advanced Editor)
duocircle_smarthost:
  driver = manualroute
  domains = ! +local_domains
  transport = duocircle_smtp
  route_list = * smtp.duocircle.com::587
  no_more

# Transport
duocircle_smtp:
  driver = smtp
  hosts_require_auth = smtp.duocircle.com
  hosts_require_tls = smtp.duocircle.com
```

4. Add SMTP authentication in `/etc/exim/smtp_auth`:

```
smtp.duocircle.com:your-duocircle-username:your-duocircle-password
```

5. Restart Exim:

```bash
systemctl restart exim
```

6. Test:

```bash
echo "Test via DuoCircle" | mail -s "Smarthost test" test@example.com
tail -f /var/log/exim_mainlog
# Should show relay through smtp.duocircle.com
```

### When to use DuoCircle vs Gmail API

| Factor | Gmail API (OAuth2) | DuoCircle SMTP |
|---|---|---|
| Daily limit | 2,000/user (Workspace) | Based on plan (10k–1M+) |
| Authentication | OAuth2 tokens | Username/password |
| Deliverability | Good (Gmail reputation) | Good (dedicated IP available) |
| Setup complexity | Higher (OAuth flow) | Lower (SMTP credentials) |
| Cost | Free (within limits) | Paid plan |
| Tracking | Built-in via this system | Built-in via this system |
| Best for | Low-to-medium volume, Gmail domain | High volume, custom domain |

> **Tip**: You can run both transports simultaneously. Use `profile` to select Gmail OAuth2 for personal emails and set `EMAIL_TRANSPORT=duocircle` as the default for bulk sends.

---

## Step 11: Install on a GCE VM (Alternative to Cloud Run)

If you prefer running on a Compute Engine VM instead of Cloud Run:

```bash
# SSH into your VM
gcloud compute ssh your-vm-name --zone us-central1-a

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Clone the repo
git clone https://github.com/DevCEDTeam/gmail-api.git
cd gmail-api

# Install dependencies
npm install

# Copy the service account key
# (scp from your local machine first)
export GOOGLE_APPLICATION_CREDENTIALS=/home/you/gmail-api/service-account-key.json

# Create .env file
cp .env.example .env
nano .env   # Fill in all values

# Test it
node app.js

# Install PM2 for process management
sudo npm install -g pm2

# Start all services with PM2
pm2 start app.js --name gmail-relay
pm2 startup   # Auto-start on boot
pm2 save

# Verify
pm2 status
pm2 logs gmail-relay
```

### Set up Nginx reverse proxy (on GCE VM)

```bash
sudo apt-get install -y nginx

sudo tee /etc/nginx/sites-available/gmail-relay > /dev/null <<'NGINX'
server {
    listen 80;
    server_name relay.cfored.com;

    location /relay/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location /mailer/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /tracking/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /email/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
NGINX

sudo ln -s /etc/nginx/sites-available/gmail-relay /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# Add SSL with Let's Encrypt
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d relay.cfored.com
```

### Set up weekly report cron (on GCE VM)

```bash
# Add cron job — every Monday at 9:00 AM
(crontab -l 2>/dev/null; echo "0 9 * * 1 cd /home/you/gmail-api && node src/reports/generate.js >> /var/log/email-report.log 2>&1") | crontab -
```

---

## Step 12: Verify Everything Works

### Test 1: Health check

```bash
RELAY_URL="https://gmail-relay-xxxxx-uc.a.run.app"

curl $RELAY_URL/health
# {"status":"ok","service":"gmail-bulk-sending-relay","role":"blue-truck"}
```

### Test 2: Send a test email

```bash
curl -X POST $RELAY_URL/relay/send \
  -H "Content-Type: application/json" \
  -d '{
    "to": "your-test-email@gmail.com",
    "subject": "Test from GCP",
    "html": "<h1>It works!</h1><p>Sent via Blue Truck relay on GCP.</p>",
    "profile": "director"
  }'
```

### Test 3: Check open tracking

Open the email → view source → find the tracking pixel URL → visit it:

```bash
curl -v "https://gmail-webhooks-xxxxx-uc.a.run.app/tracking/open/YOUR_TRACKING_ID"
# Should return a 1x1 GIF
```

### Test 4: Simulate a bounce callback

```bash
WEBHOOK_URL="https://gmail-webhooks-xxxxx-uc.a.run.app"

curl -X POST $WEBHOOK_URL/mailer/callback \
  -H "Content-Type: application/json" \
  -d '{
    "type": "hard_bounce",
    "email": "bad-address@example.com",
    "reason": "Mailbox does not exist"
  }'
# {"received":true,"processed":1}
```

### Test 5: Check stats

```bash
curl "$RELAY_URL/relay/stats"
# {
#   "period": {"since":"...","until":"..."},
#   "deliveries": 1,
#   "opens": 1,
#   "openRate": "100.0%",
#   "bounces": {"total":1,"hard":1,"soft":0},
#   ...
# }
```

### Test 6: Verify suppression worked

```bash
# Try sending to the bounced address — should be skipped
curl -X POST $RELAY_URL/relay/send \
  -H "Content-Type: application/json" \
  -d '{
    "to": "bad-address@example.com",
    "subject": "This should be skipped",
    "html": "<p>Should not send</p>",
    "profile": "director"
  }'
# {"skipped":true,"reason":"suppressed","to":"bad-address@example.com"}
```

---

## Architecture Diagram

```
                  ┌──────────────┐
                  │   cPanel     │
                  │   (Exim)     │
                  └──────┬───────┘
                         │ HTTP POST
                         ▼
              ┌──────────────────────┐
              │   Blue Truck 🚚      │
              │   (Cloud Run)        │
              │                      │
              │  /relay/send         │  ← Single email
              │  /relay/bulk         │  ← Bulk email
              │  /relay/queue        │  ← Async queue
              │  /relay/stats        │  ← Stats API
              └──────────┬───────────┘
                         │
           ┌─────────────┼─────────────┐
           │             │             │
           ▼             ▼             ▼
  ┌────────────────┐ ┌─────────┐ ┌─────────────────┐
  │  Gmail API     │ │DuoCircle│ │  Firebase RTDB   │
  │  (3 OAuth2     │ │  SMTP   │ │                  │
  │   clients)     │ │  Relay  │ │  /queue          │
  │                │ │         │ │  /deliveries     │
  │  general@      │ │  High   │ │  /bounces        │
  │  director@     │ │  volume │ │  /spam           │
  │  team@         │ │  sends  │ │  /opens          │
  └────────────────┘ └─────────┘ │  /suppressions   │
                                  └────────┬─────────┘
                                           │ trigger
                                           ▼
                                ┌─────────────────────┐
                                │  Orange Airplane ✈️   │
                                │  (Cloud Function)    │
                                │                      │
                                │  Processes /queue     │
                                │  items async          │
                                └─────────────────────┘

     ┌──────────────────────────────────────────┐
     │  Webhook Server (Cloud Run)               │
     │                                           │
     │  POST /mailer/callback  ← Mautic/ESP      │
     │  GET  /tracking/open/:id ← Open pixel     │
     │  GET  /email/unsubscribe/:id               │
     │  GET  /email/dnc/:id                       │
     └──────────────────────────────────────────┘
```

---

## Troubleshooting

| Problem | Solution |
|---|---|
| `invalid_grant` on OAuth | Refresh token expired. Regenerate at OAuth Playground (Step 2c) and update Secret Manager |
| `PERMISSION_DENIED` on Secret Manager | Ensure service account has `roles/secretmanager.secretAccessor` |
| Firebase `PERMISSION_DENIED` | Ensure service account has `roles/firebase.admin` and rules are deployed |
| Emails landing in spam | Set up SPF, DKIM, and DMARC for your domain; warm up the sending volume gradually |
| Cloud Run cold starts | Set `--min-instances 1` for the relay service |
| Open tracking not recording | Check that `TRACKING_BASE_URL` matches the webhook server's public URL |
| Weekly report not sending | Check Cloud Function logs: `firebase functions:log --only weeklyReport` |
| DuoCircle `ECONNREFUSED` | Check `DUOCIRCLE_PORT` (587 for STARTTLS, 465 for SSL) and ensure `DUOCIRCLE_SECURE` matches |
| DuoCircle `535 Authentication failed` | Verify SMTP username/password in DuoCircle dashboard; ensure account is active |
| DuoCircle emails rejected by recipient | Add SPF `include:spf.duocircle.com` and configure DKIM in your DNS (Step 10b) |
