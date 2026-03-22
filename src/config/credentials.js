/**
 * Multi-credential OAuth2 manager.
 *
 * Supports three OAuth2 clients ("wristbands"):
 *   1. General   (gmail-bulk-sending-1)
 *   2. Director  (gmail-bulk-sending-2 — director@cfored.com)
 *   3. Team      (gmail-bulk-sending-3 — team@cfored.com)
 *
 * In production credentials are loaded from Google Secret Manager.
 * In development they come from environment variables.
 */

const { google } = require('googleapis');

const PROFILES = {
  general: {
    clientIdEnv: 'GENERAL_CLIENT_ID',
    clientSecretEnv: 'GENERAL_CLIENT_SECRET',
    refreshTokenEnv: 'GENERAL_REFRESH_TOKEN',
    senderEmailEnv: 'GENERAL_SENDER_EMAIL',
    senderNameEnv: 'GENERAL_SENDER_NAME',
    secretIds: {
      clientSecret: 'oauth-secret-client1',
      refreshToken: 'oauth-refresh-general',
    },
  },
  director: {
    clientIdEnv: 'DIRECTOR_CLIENT_ID',
    clientSecretEnv: 'DIRECTOR_CLIENT_SECRET',
    refreshTokenEnv: 'DIRECTOR_REFRESH_TOKEN',
    senderEmailEnv: 'DIRECTOR_SENDER_EMAIL',
    senderNameEnv: 'DIRECTOR_SENDER_NAME',
    secretIds: {
      clientSecret: 'oauth-secret-client2',
      refreshToken: 'oauth-refresh-director',
    },
  },
  team: {
    clientIdEnv: 'TEAM_CLIENT_ID',
    clientSecretEnv: 'TEAM_CLIENT_SECRET',
    refreshTokenEnv: 'TEAM_REFRESH_TOKEN',
    senderEmailEnv: 'TEAM_SENDER_EMAIL',
    senderNameEnv: 'TEAM_SENDER_NAME',
    secretIds: {
      clientSecret: 'oauth-secret-client3',
      refreshToken: 'oauth-refresh-team',
    },
  },
};

const REDIRECT_URI =
  process.env.REDIRECT_URI || 'https://developers.google.com/oauthplayground';

// Cache OAuth2 clients so tokens are reused across calls.
const clientCache = new Map();

/**
 * Try to load a secret from Google Secret Manager.
 * Returns null when Secret Manager is unavailable (local dev).
 */
async function loadFromSecretManager(secretId) {
  try {
    const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
    const client = new SecretManagerServiceClient();
    const projectId = process.env.GCP_PROJECT_ID || 'gmail-bulk-sending-389112';
    const name = `projects/${projectId}/secrets/${secretId}/versions/latest`;
    const [version] = await client.accessSecretVersion({ name });
    return version.payload.data.toString('utf8');
  } catch {
    return null;
  }
}

/**
 * Resolve a credential value: Secret Manager first, then env var fallback.
 */
async function resolveSecret(secretId, envVar) {
  if (process.env.USE_SECRET_MANAGER === 'true') {
    const value = await loadFromSecretManager(secretId);
    if (value) return value;
  }
  return process.env[envVar] || null;
}

/**
 * Build or retrieve a cached OAuth2 client for the given profile.
 *
 * @param {'general'|'director'|'team'} profileName
 * @returns {Promise<{oAuth2Client: google.auth.OAuth2, senderEmail: string, senderName: string}>}
 */
async function getOAuthClient(profileName = 'director') {
  if (clientCache.has(profileName)) {
    return clientCache.get(profileName);
  }

  const profile = PROFILES[profileName];
  if (!profile) {
    throw new Error(`Unknown credential profile: ${profileName}`);
  }

  const clientId = process.env[profile.clientIdEnv];
  const clientSecret = await resolveSecret(
    profile.secretIds.clientSecret,
    profile.clientSecretEnv,
  );
  const refreshToken = await resolveSecret(
    profile.secretIds.refreshToken,
    profile.refreshTokenEnv,
  );

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      `Missing credentials for profile "${profileName}". ` +
      `Ensure ${profile.clientIdEnv}, ${profile.clientSecretEnv}, and ${profile.refreshTokenEnv} are set.`,
    );
  }

  const oAuth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);
  oAuth2Client.setCredentials({ refresh_token: refreshToken });

  const senderEmail = process.env[profile.senderEmailEnv];
  const senderName = process.env[profile.senderNameEnv] || senderEmail;

  const entry = { oAuth2Client, clientId, clientSecret, refreshToken, senderEmail, senderName };
  clientCache.set(profileName, entry);
  return entry;
}

/**
 * Get a fresh access token for the given profile.
 */
async function getAccessToken(profileName = 'director') {
  const { oAuth2Client } = await getOAuthClient(profileName);
  const { token } = await oAuth2Client.getAccessToken();
  return token;
}

/**
 * Resolve DuoCircle SMTP password from Secret Manager or env var.
 */
async function getDuoCirclePassword() {
  return resolveSecret('duocircle-smtp-password', 'DUOCIRCLE_PASS');
}

module.exports = {
  PROFILES,
  getOAuthClient,
  getAccessToken,
  getDuoCirclePassword,
};
