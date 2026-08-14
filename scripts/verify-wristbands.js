/**
 * Wristband verifier — proves each OAuth2 profile can authenticate and that
 * the token belongs to the right sender account. Read-only: exchanges the
 * refresh token for an access token and calls gmail.users.getProfile. No
 * email is sent.
 *
 * Usage (after .env is populated for one or more profiles):
 *   node scripts/verify-wristbands.js
 */

require('dotenv').config();
const { google } = require('googleapis');
const { PROFILES } = require('../src/config/credentials');

async function verify(profileName) {
  const p = PROFILES[profileName];
  const clientId = process.env[p.clientIdEnv];
  const clientSecret = process.env[p.clientSecretEnv];
  const refreshToken = process.env[p.refreshTokenEnv];
  const expectedSender = process.env[p.senderEmailEnv];

  if (!clientId || !clientSecret || !refreshToken) {
    return { profileName, status: 'NOT CONFIGURED', detail: `missing ${[!clientId && p.clientIdEnv, !clientSecret && p.clientSecretEnv, !refreshToken && p.refreshTokenEnv].filter(Boolean).join(', ')}` };
  }

  try {
    const client = new google.auth.OAuth2(clientId, clientSecret);
    client.setCredentials({ refresh_token: refreshToken });
    const { token } = await client.getAccessToken();
    if (!token) throw new Error('no access token returned');

    const gmail = google.gmail({ version: 'v1', auth: client });
    const { data } = await gmail.users.getProfile({ userId: 'me' });

    if (expectedSender && data.emailAddress?.toLowerCase() !== expectedSender.toLowerCase()) {
      return { profileName, status: 'MISMATCH', detail: `token belongs to ${data.emailAddress}, expected ${expectedSender}` };
    }
    return { profileName, status: 'OK', detail: `${data.emailAddress} (${data.messagesTotal} messages)` };
  } catch (err) {
    const msg = err.response?.data?.error_description || err.message;
    return { profileName, status: 'FAIL', detail: msg.slice(0, 120) };
  }
}

async function main() {
  console.log('[verify] Checking wristbands (read-only, no email sent)…\n');
  let allOk = true;
  for (const name of Object.keys(PROFILES)) {
    const r = await verify(name);
    const icon = r.status === 'OK' ? '✓' : r.status === 'NOT CONFIGURED' ? '·' : '✗';
    if (r.status === 'FAIL' || r.status === 'MISMATCH') allOk = false;
    console.log(`  ${icon} ${name.padEnd(10)} ${r.status.padEnd(15)} ${r.detail}`);
  }
  console.log('');
  if (!allOk) {
    console.log('[verify] Failures above — common causes: invalid_grant = token revoked/expired');
    console.log('[verify] (remint via scripts/setup-wristband.js); mismatch = signed in with wrong account.');
    process.exit(1);
  }
  console.log('[verify] Configured wristbands are healthy.');
}

main();
