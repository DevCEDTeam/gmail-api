# Gmail API Setup Guide

Step-by-step instructions to configure OAuth2 credentials for the **gmail-bulk-sending** GCP project (`gmail-bulk-sending-389112`).

---

## Prerequisites

- A Google account with Gmail
- Access to [Google Cloud Console](https://console.cloud.google.com)
- Node.js v18+ installed locally

---

## Step 1: Enable the Gmail API

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Select project **gmail-bulk-sending** from the project dropdown
3. Navigate to **APIs & Services > Library**
4. Search for **Gmail API**
5. Click **Gmail API** and then click **Enable**

---

## Step 2: Configure the OAuth Consent Screen

1. Navigate to **APIs & Services > OAuth consent screen**
2. Select **External** user type (or **Internal** if using Google Workspace) and click **Create**
3. Fill in the required fields:
   - **App name:** `gmail-bulk-sending`
   - **User support email:** your Gmail address
   - **Developer contact email:** your Gmail address
4. Click **Save and Continue**
5. On the **Scopes** page, click **Add or Remove Scopes**
6. Search for and add: `https://mail.google.com/`
7. Click **Save and Continue**
8. On the **Test users** page, click **Add Users**
9. Enter your Gmail address and click **Save and Continue**
10. Review and click **Back to Dashboard**

---

## Step 3: Create OAuth2 Credentials

1. Navigate to **APIs & Services > Credentials**
2. Click **+ Create Credentials > OAuth client ID**
3. Set **Application type** to **Web application**
4. Set **Name** to `gmail-bulk-sending`
5. Under **Authorized redirect URIs**, click **+ Add URI**
6. Enter: `https://developers.google.com/oauthplayground`
7. Click **Create**
8. A dialog will appear with your **Client ID** and **Client Secret** — copy both

---

## Step 4: Generate a Refresh Token

1. Go to [OAuth 2.0 Playground](https://developers.google.com/oauthplayground)
2. Click the **gear icon** (Settings) in the top right
3. Check **Use your own OAuth credentials**
4. Enter the **Client ID** and **Client Secret** from Step 3
5. Close the settings panel
6. In the left panel under **Select & authorize APIs**, find **Gmail API v1**
7. Select the scope: `https://mail.google.com/`
8. Click **Authorize APIs**
9. Sign in with your Gmail account and grant permissions
10. On the next screen, click **Exchange authorization code for tokens**
11. Copy the **Refresh token** from the response

---

## Step 5: Configure Environment Variables

1. In the project root, copy the example env file:

   ```bash
   cp .env.example .env
   ```

2. Open `.env` and fill in your values:

   ```env
   CLIENT_ID=123456789-xxxxxxxxxx.apps.googleusercontent.com
   CLIENT_SECRET=GOCSPX-xxxxxxxxxx
   REDIRECT_URI=https://developers.google.com/oauthplayground
   REFRESH_TOKEN=1//0xxxxxxxxxx

   SENDER_EMAIL=you@gmail.com
   SENDER_NAME=Your Name

   RECIPIENT_EMAIL=recipient@example.com
   ```

---

## Step 6: Install Dependencies and Run

```bash
npm install
node app.js
```

If successful, you should see:

```
Email sent... { accepted: ['recipient@example.com'], ... }
```

---

## Troubleshooting

### "invalid_grant" error
- Your refresh token may have expired. Repeat **Step 4** to generate a new one.
- Ensure the Gmail account used in Step 4 is listed as a **Test user** in Step 2.

### "unauthorized_client" error
- Verify that `https://developers.google.com/oauthplayground` is listed as an **Authorized redirect URI** in Step 3.
- Double-check that Client ID and Client Secret match exactly.

### "Mail sending failed" or timeout
- Confirm the Gmail API is **enabled** (Step 1).
- Ensure the sender email in `.env` matches the account used to generate the refresh token.

### "Insufficient Permission" error
- Make sure you selected the scope `https://mail.google.com/` in both Step 2 (consent screen) and Step 4 (playground).

### App is in "Testing" mode (limited to 100 users)
- For production use, submit your app for **Google verification** under **APIs & Services > OAuth consent screen > Publish App**.
- While in testing mode, only emails listed as **Test users** can authenticate.

---

## Security Best Practices

- **Never commit `.env`** — it is already in `.gitignore`
- **Rotate credentials** periodically via GCP Console
- **Use a service account** for production/server-to-server use cases
- **Restrict API key scopes** to only what is needed
