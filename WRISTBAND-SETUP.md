# Wristband Setup — Three OAuth2 Clients (gmail-bulk-sending-1/2/3)

Builds the three-profile sending architecture the codebase expects. Current state
per the Credentials console (Aug 2026): only one auto-created "Web client" exists —
the three named clients do not. This runbook creates them and mints tokens
**without OAuth Playground** (no secrets pasted into web pages).

**Project:** gmail-bulk-sending · **ID:** `gmail-bulk-sending-389112` · **Number:** `895054114655`

| Wristband | OAuth Client Name | Sender Account | Env Prefix |
|-----------|------------------|----------------|------------|
| 1 General | `gmail-bulk-sending-1` | noreply@cfored.com | `GENERAL_` |
| 2 Director | `gmail-bulk-sending-2` | director@cfored.com | `DIRECTOR_` |
| 3 Team | `gmail-bulk-sending-3` | team@cfored.com | `TEAM_` |

---

## Step 0 — Rotate the exposed client secret (do this first)

The auto-created "Web client" secret (`895054114655-75sa…`) was exposed in an
OAuth Playground screenshot. In [Credentials](https://console.cloud.google.com/apis/credentials?project=gmail-bulk-sending-389112):
open **Web client** → **Reset secret**. (That client can be left as-is or deleted
once the three named clients below are working — nothing in this repo uses it.)

## Step 1 — Consent screen prerequisites (one-time)

[OAuth consent screen](https://console.cloud.google.com/apis/credentials/consent?project=gmail-bulk-sending-389112):

1. Scopes include `https://mail.google.com/`
2. **Test users** include all three sender accounts: noreply@cfored.com,
   director@cfored.com, team@cfored.com
3. ⚠ While the app is in **Testing** status, refresh tokens expire after **7 days**.
   For durable tokens, click **Publish app** (External + sensitive scope may show an
   unverified-app warning during consent — acceptable for internal senders).

## Step 2 — Create the three OAuth clients (console, ~2 min each)

For each of `gmail-bulk-sending-1`, `-2`, `-3`:

1. **Credentials → + Create credentials → OAuth client ID**
2. Application type: **Web application**
3. Name: `gmail-bulk-sending-1` (then `-2`, `-3`)
4. **Authorized redirect URIs → Add URI:** `http://localhost:53682/oauth2callback`
5. **Create** → copy the **Client ID** and **Client secret** (download the JSON or
   keep the dialog open — you'll paste them into the mint command next)

## Step 3 — Mint refresh tokens locally (one run per wristband)

On your machine, in the repo (Node 20+ installed, `npm install` done):

```powershell
node scripts\setup-wristband.js --profile general  --client-id <ID-1> --client-secret <SECRET-1>
node scripts\setup-wristband.js --profile director --client-id <ID-2> --client-secret <SECRET-2>
node scripts\setup-wristband.js --profile team     --client-id <ID-3> --client-secret <SECRET-3>
```

Each run prints a Google URL — open it and **sign in as that wristband's sender
account** (the tool pre-hints the right one). On success it prints five
ready-to-paste `.env` lines for that profile. Append all fifteen lines to `.env`.

## Step 4 — Verify (read-only, sends nothing)

```powershell
node scripts\verify-wristbands.js
```

Expected: `✓ general / director / team  OK  <sender email>` for each configured
profile. `MISMATCH` means you signed in with the wrong account during minting —
re-run that profile's mint. `invalid_grant` means the token was revoked or expired
(7-day testing mode) — publish the app (Step 1.3) and remint.

## Step 5 — Production: Secret Manager

```bash
echo -n "SECRET_1" | gcloud secrets create oauth-secret-client1 --data-file=- --project gmail-bulk-sending-389112
echo -n "SECRET_2" | gcloud secrets create oauth-secret-client2 --data-file=-
echo -n "SECRET_3" | gcloud secrets create oauth-secret-client3 --data-file=-
echo -n "REFRESH_GENERAL"  | gcloud secrets create oauth-refresh-general  --data-file=-
echo -n "REFRESH_DIRECTOR" | gcloud secrets create oauth-refresh-director --data-file=-
echo -n "REFRESH_TEAM"     | gcloud secrets create oauth-refresh-team     --data-file=-
```

(If a secret already exists, use `gcloud secrets versions add <name> --data-file=-`
instead.) Cloud Run services read these when `USE_SECRET_MANAGER=true`; restart
services after adding versions — credentials are cached in-process.

## Step 6 — Send test (one email per wristband)

```powershell
npm run relay        # separate terminal, or npm start
```

```powershell
Invoke-RestMethod -Method Post -Uri "http://localhost:3000/relay/send" -ContentType "application/json" -Body (@{
  to = "director@cfored.com"; subject = "Wristband test — general"; html = "<p>general OK</p>"; profile = "general"
} | ConvertTo-Json)
```

Repeat with `profile = "director"` and `"team"`. Each lands from its own sender
address with tracking recorded in Firebase.

---

## Notes

- **Why three clients instead of one client + three tokens:** per-client secret
  rotation and quota isolation — revoking one wristband never touches the others.
  The code works either way; this is the designed architecture.
- The old OAuth Playground flow (GCP-INSTALL.md Step 2c) still works but is
  deprecated for this project — `setup-wristband.js` keeps secrets off web pages.
- Never commit `.env`; live secrets go only in `.env` (local) or Secret Manager.
