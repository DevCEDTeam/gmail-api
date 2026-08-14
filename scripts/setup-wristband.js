/**
 * Wristband token minter — generates a Gmail OAuth2 refresh token locally.
 *
 * Replaces the OAuth Playground flow: no pasting client secrets into web
 * pages, nothing to screenshot. Runs a temporary local callback server,
 * opens the Google consent URL, captures the code, exchanges it, and
 * prints ready-to-paste .env lines.
 *
 * Usage (run on your own machine, one run per wristband):
 *   node scripts/setup-wristband.js --profile director \
 *     --client-id 8950...apps.googleusercontent.com --client-secret GOCSPX-...
 *
 *   Then sign in AS THE SENDER ACCOUNT for that profile when the browser opens
 *   (general → noreply@cfored.com, director → director@cfored.com,
 *    team → team@cfored.com).
 *
 * The OAuth client must list http://localhost:53682/oauth2callback as an
 * authorized redirect URI (see WRISTBAND-SETUP.md, console step 3).
 */

const http = require('http');
const { URL } = require('url');

const args = process.argv.slice(2);
function arg(name) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : null;
}

const PROFILE = (arg('profile') || 'director').toLowerCase();
const CLIENT_ID = arg('client-id') || process.env.MINT_CLIENT_ID;
const CLIENT_SECRET = arg('client-secret') || process.env.MINT_CLIENT_SECRET;
const PORT = parseInt(arg('port') || '53682', 10);
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;
const SCOPE = 'https://mail.google.com/';

const SENDERS = {
  general: 'noreply@cfored.com',
  director: 'director@cfored.com',
  team: 'team@cfored.com',
};

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Usage: node scripts/setup-wristband.js --profile <general|director|team> --client-id <id> --client-secret <secret>');
  process.exit(1);
}
if (!SENDERS[PROFILE]) {
  console.error(`Unknown profile "${PROFILE}" — use general, director, or team.`);
  process.exit(1);
}

const authUrl =
  'https://accounts.google.com/o/oauth2/v2/auth' +
  `?client_id=${encodeURIComponent(CLIENT_ID)}` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
  '&response_type=code' +
  `&scope=${encodeURIComponent(SCOPE)}` +
  '&access_type=offline' +
  '&prompt=consent' +
  `&login_hint=${encodeURIComponent(SENDERS[PROFILE])}`;

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  if (u.pathname !== '/oauth2callback') { res.writeHead(404); res.end(); return; }

  const code = u.searchParams.get('code');
  const err = u.searchParams.get('error');
  if (err || !code) {
    res.writeHead(400, { 'Content-Type': 'text/html' });
    res.end(`<h2>Authorization failed: ${err || 'no code returned'}</h2>`);
    console.error(`[mint] Authorization failed: ${err || 'no code'}`);
    server.close(); process.exit(1);
  }

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    });
    const tokens = await tokenRes.json();
    if (!tokens.refresh_token) {
      throw new Error(`No refresh_token in response: ${JSON.stringify(tokens).slice(0, 300)}`);
    }

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<h2>✓ Token minted — return to your terminal. You can close this tab.</h2>');

    const P = PROFILE.toUpperCase();
    console.log('\n[mint] SUCCESS — add these lines to your .env (and Secret Manager for prod):\n');
    console.log(`${P}_CLIENT_ID=${CLIENT_ID}`);
    console.log(`${P}_CLIENT_SECRET=${CLIENT_SECRET}`);
    console.log(`${P}_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log(`${P}_SENDER_EMAIL=${SENDERS[PROFILE]}`);
    console.log(`${P}_SENDER_NAME=${PROFILE === 'general' ? 'cfored.com' : PROFILE === 'director' ? 'Director' : 'Team cfored'}`);
    console.log('\n[mint] Verify all wristbands with: node scripts/verify-wristbands.js');
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/html' });
    res.end(`<h2>Token exchange failed</h2><pre>${e.message}</pre>`);
    console.error(`[mint] Token exchange failed: ${e.message}`);
  } finally {
    server.close();
  }
});

server.listen(PORT, () => {
  console.log(`[mint] Profile: ${PROFILE} → sign in as ${SENDERS[PROFILE]}`);
  console.log(`[mint] Listening on ${REDIRECT_URI}`);
  console.log('[mint] Open this URL in your browser (sign in as the sender account above):\n');
  console.log(authUrl + '\n');
});
