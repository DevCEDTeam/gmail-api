# Maintenance Guide — Gmail Bulk Sending System

Routine operational tasks to keep the system healthy.

**Project:** gmail-bulk-sending · **Number:** 895054114655 · **ID:** `gmail-bulk-sending-389112`

---

## Maintenance Schedule at a Glance

| Frequency | Task | Section |
|-----------|------|---------|
| Weekly | Review the automated weekly report | [1](#1-weekly-report-review) |
| Weekly | Check queue for stuck/failed items | [2](#2-queue-health) |
| Monthly | Review suppression list growth | [3](#3-suppression-list-review) |
| Monthly | Check Cloud Run / Cloud Function logs for errors | [4](#4-log-review) |
| Quarterly | Rotate OAuth2 refresh tokens | [5](#5-credential-rotation) |
| Quarterly | Update npm dependencies | [6](#6-dependency-updates) |
| Quarterly | Prune old Firebase tracking data | [7](#7-firebase-data-pruning) |
| Yearly | Review DNS records (SPF/DKIM/DMARC) | [8](#8-dns--deliverability-audit) |
| As needed | Handle `invalid_grant` errors | [9](#9-troubleshooting-runbook) |

---

## 1. Weekly Report Review

The `weeklyReport` Cloud Function emails a report card to `REPORT_RECIPIENT` (director@cfored.com) every Monday 9:00 AM CST.

**What to watch:**

| Metric | Healthy | Investigate |
|--------|---------|-------------|
| Open rate | ≥ 20% | < 10% — check tracking pixel reachability, list quality |
| Bounce rate | ≤ 2% | > 5% — clean the recipient list, verify addresses before import |
| Spam rate | ≤ 0.05% | > 0.1% — pause campaigns, review content and list consent |
| Unsub rate | ≤ 0.5% | > 1% — review sending frequency and relevance |

If the report doesn't arrive, run it manually and check logs:

```bash
npm run report                                  # Manual run (local, needs .env)
firebase functions:log --only weeklyReport      # Cloud Function logs
```

## 2. Queue Health

Queue items should move through `pending → processing → sent` within seconds. Items stuck in `processing` or accumulating in `failed` indicate a problem.

```bash
# Count items by status (requires service account key)
node -e "
require('dotenv').config();
const { initFirebase, getDatabase } = require('./src/config/firebase');
initFirebase();
getDatabase().ref('queue').once('value').then((snap) => {
  const counts = {};
  snap.forEach((c) => { const s = c.val().status; counts[s] = (counts[s] || 0) + 1; });
  console.log(counts);
  process.exit(0);
});
"
```

**Recovery actions:**
- Items stuck in `processing` — the worker likely crashed mid-send. Verify whether the email was actually delivered (check `/deliveries` for the recipient) before resetting the item to `pending`, otherwise you risk a duplicate send.
- Items in `failed` — read the `error` field. `invalid_grant` means expired credentials (see [Section 9](#9-troubleshooting-runbook)); transient SMTP errors can be retried by setting status back to `pending`.
- Backlog draining: `node src/queue/worker.js --once` processes up to 200 pending items and exits.

## 3. Suppression List Review

The `/suppressions` collection only grows — hard bounces, spam complaints, and unsubscribes are added automatically and never expire.

**Do not remove** entries for `spam_complaint`, `unsubscribed`, or `dnc_all_channels` — re-contacting these addresses risks legal exposure (CAN-SPAM) and reputation damage.

**Safe to review:** `soft_bounce_limit` entries may be temporary conditions (full mailbox). If a contact asks to be re-added:

```bash
node -e "
require('dotenv').config();
const { initFirebase } = require('./src/config/firebase');
const db = require('./src/services/database');
initFirebase();
db.removeSuppression('user@example.com').then(() => { console.log('removed'); process.exit(0); });
"
```

## 4. Log Review

All services log with bracketed prefixes — grep for errors by component:

```bash
# Cloud Run
gcloud run services logs read gmail-relay --region us-central1 --limit 200 | grep -E '\[(relay|email)\].*(fail|error)' -i
gcloud run services logs read gmail-webhooks --region us-central1 --limit 200 | grep -E 'error' -i

# Cloud Functions
firebase functions:log --only processEmailQueue
firebase functions:log --only weeklyReport
```

**Patterns to act on:**
- Repeated `[email] Failed to send` — credential or transport problem
- `[callback] Event missing email` spikes — Mautic webhook payload format changed
- `[open-tracking] Error recording open` — Firebase connectivity or rules issue (tracking degrades gracefully but data is being lost)

## 5. Credential Rotation

OAuth2 refresh tokens can be revoked or expire (especially if the OAuth consent screen is still in "Testing" mode — tokens then expire after 7 days; publish the app to avoid this).

**Rotate a profile's refresh token:**

1. Go to [OAuth Playground](https://developers.google.com/oauthplayground/)
2. Gear icon → **Use your own OAuth credentials** → paste that profile's Client ID + Secret
3. Authorize `https://mail.google.com/` signed in as the profile's sender address
4. Exchange authorization code for tokens → copy the new **Refresh Token**
5. Update Secret Manager (production):

```bash
echo -n "NEW_REFRESH_TOKEN" | \
  gcloud secrets versions add oauth-refresh-director --data-file=-
# Secret IDs: oauth-refresh-general | oauth-refresh-director | oauth-refresh-team
```

6. Restart the Cloud Run services so the in-process credential cache (`clientCache` Map) is dropped:

```bash
gcloud run services update gmail-relay --region us-central1 --no-traffic --tag rotate && \
gcloud run services update-traffic gmail-relay --region us-central1 --to-latest
```

For local dev, update the `{PREFIX}_REFRESH_TOKEN` value in `.env` and restart the process.

**DuoCircle password rotation:** change it in the DuoCircle dashboard, then:

```bash
echo -n "NEW_PASSWORD" | gcloud secrets versions add duocircle-smtp-password --data-file=-
```

## 6. Dependency Updates

```bash
npm outdated                # Check what's stale
npm update                  # Patch/minor bumps within semver ranges
npm audit                   # Known vulnerabilities
npm audit fix               # Auto-fix where possible
```

There is no test suite, so after updating verify manually:

```bash
node --check app.js && node --check src/services/email.js   # Syntax
npm start                                                    # Boots all 3 services
curl localhost:3000/health && curl localhost:3001/health    # Health checks
```

Watch for majors in `googleapis` (OAuth2 client API changes), `firebase-admin` (init/database API changes), and `express` (v5 changes middleware error handling). Remember `functions/` has its own dependencies — update those separately:

```bash
cd functions && npm outdated && npm update && cd ..
```

## 7. Firebase Data Pruning

Tracking collections grow unbounded. The weekly report only reads the last 7 days, so older data in `/opens`, `/clicks`, `/deliveries`, and `/bounces` is dead weight that slows `getStats()` (it reads entire collections into memory).

**Retention recommendation:** keep 90 days of tracking data; keep `/suppressions` forever.

```bash
# Prune records older than 90 days from a collection
node -e "
require('dotenv').config();
const { initFirebase, getDatabase } = require('./src/config/firebase');
initFirebase();
const db = getDatabase();
const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
const COLLECTION = 'deliveries';           // also run for: bounces, spam
const TS_FIELD = 'deliveredAt';            // bounces: bouncedAt, spam: reportedAt
db.ref(COLLECTION).once('value').then(async (snap) => {
  let removed = 0;
  const deletions = [];
  snap.forEach((child) => {
    if ((child.val()[TS_FIELD] || 0) < cutoff) {
      deletions.push(db.ref(\`\${COLLECTION}/\${child.key}\`).remove());
      removed++;
    }
  });
  await Promise.all(deletions);
  console.log(\`Removed \${removed} from \${COLLECTION}\`);
  process.exit(0);
});
"
```

Note: `/opens` and `/clicks` are nested (`/{trackingId}/{pushKey}`), so prune them by iterating tracking IDs and checking the nested `openedAt`/`clickedAt` fields. Back up first:

```bash
# Export a collection before pruning
curl -s "https://gmail-bulk-sending-389112-default-rtdb.firebaseio.com/deliveries.json?access_token=$(gcloud auth print-access-token)" > deliveries-backup-$(date +%Y%m%d).json
```

## 8. DNS & Deliverability Audit

Verify yearly (or after any DNS provider change):

```bash
dig TXT cfored.com +short                               # SPF — must include senders in use
dig TXT _dmarc.cfored.com +short                        # DMARC policy present
dig TXT duocircle._domainkey.cfored.com +short          # DKIM (if using DuoCircle)
```

Expected SPF when both transports are in use:
```
v=spf1 include:_spf.google.com include:spf.duocircle.com ~all
```

Also confirm the tracking CNAME still resolves if configured:
```bash
dig CNAME tracking.cfored.com +short    # → gmail-webhooks-*.a.run.app
```

## 9. Troubleshooting Runbook

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| `invalid_grant` on sends | Refresh token expired/revoked | Rotate token ([Section 5](#5-credential-rotation)) |
| All sends failing, one profile | That profile's credentials only | Rotate just that wristband's token |
| `PERMISSION_DENIED` (Secret Manager) | Service account missing role | `gcloud projects add-iam-policy-binding gmail-bulk-sending-389112 --member="serviceAccount:gmail-relay@gmail-bulk-sending-389112.iam.gserviceaccount.com" --role="roles/secretmanager.secretAccessor"` |
| `PERMISSION_DENIED` (Firebase) | Missing role or rules not deployed | Grant `roles/firebase.admin`; `firebase deploy --only database` |
| Opens/clicks not recording | `TRACKING_BASE_URL` mismatch | Must equal the webhook server's public URL |
| Queue items never processed | Cloud Function not deployed/crashed | `firebase functions:list`; redeploy if missing |
| Weekly report missing | Function schedule failed | `firebase functions:log --only weeklyReport` |
| DuoCircle `535 Auth failed` | Password rotated/expired | Update secret ([Section 5](#5-credential-rotation)) |
| Emails landing in spam | DNS records / list quality | Audit ([Section 8](#8-dns--deliverability-audit)); slow the send volume |
| Suppressed contact still emailed | Key encoding mismatch | Verify email is lowercased before base64 in both write and check paths (`src/services/database.js`) |

## Related Documentation

- `CLAUDE.md` — architecture and conventions
- `GCP-INSTALL.md` — full deployment guide (12 steps)
- `SETUP.md` — OAuth2 credential setup walkthrough
