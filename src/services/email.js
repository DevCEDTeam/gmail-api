/**
 * Email sending service with full tracking support.
 *
 * Features:
 *   - Open tracking via 1×1 transparent pixel
 *   - List-Unsubscribe + One-Click Unsubscribe (RFC 8058) headers
 *   - Suppression list check before every send
 *   - Delivery recording to Firebase
 *   - Supports multiple sender profiles (general / director / team)
 */

const nodemailer = require('nodemailer');
const { v4: uuidv4 } = require('uuid');
const { getOAuthClient, getDuoCirclePassword } = require('../config/credentials');
const db = require('./database');

const MAUTIC_BASE_URL = process.env.MAUTIC_BASE_URL || 'https://mautic.cfored.com';
const TRACKING_BASE_URL = process.env.TRACKING_BASE_URL || MAUTIC_BASE_URL;

// 1×1 transparent GIF (43 bytes)
const TRACKING_PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
);

/**
 * Build a Nodemailer transport for DuoCircle SMTP relay.
 */
async function createDuoCircleTransport() {
  const password = await getDuoCirclePassword();
  if (!password) {
    throw new Error('DuoCircle password not configured. Set DUOCIRCLE_PASS or add duocircle-smtp-password to Secret Manager.');
  }

  return nodemailer.createTransport({
    host: process.env.DUOCIRCLE_HOST || 'smtp.duocircle.com',
    port: parseInt(process.env.DUOCIRCLE_PORT || '587', 10),
    secure: process.env.DUOCIRCLE_SECURE === 'true',
    auth: {
      user: process.env.DUOCIRCLE_USER,
      pass: password,
    },
  });
}

/**
 * Build a Nodemailer transport for Gmail OAuth2.
 */
async function createGmailTransport(profileName = 'director') {
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

/**
 * Build a Nodemailer transport for the given profile.
 * Switches between Gmail OAuth2 and DuoCircle based on EMAIL_TRANSPORT env var.
 */
async function createTransport(profileName = 'director') {
  if (process.env.EMAIL_TRANSPORT === 'duocircle') {
    return createDuoCircleTransport();
  }
  return createGmailTransport(profileName);
}

/**
 * Generate the tracking pixel <img> tag for an email.
 */
function trackingPixelTag(trackingId) {
  const url = `${TRACKING_BASE_URL}/tracking/open/${trackingId}`;
  return `<img src="${url}" width="1" height="1" alt="" style="display:none" />`;
}

/**
 * Build RFC 8058 List-Unsubscribe headers.
 */
function unsubscribeHeaders(recipientEmail, trackingId) {
  const unsubUrl = `${MAUTIC_BASE_URL}/email/unsubscribe/${trackingId}`;
  const dncUrl = `${MAUTIC_BASE_URL}/email/dnc/${trackingId}`;
  return {
    'List-Unsubscribe': `<${unsubUrl}>, <mailto:unsubscribe@cfored.com?subject=unsubscribe-${trackingId}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    'X-DNC-URL': dncUrl,
  };
}

/**
 * Send a single email with full tracking.
 *
 * @param {Object} options
 * @param {string}   options.to           Recipient email
 * @param {string}   options.subject      Email subject
 * @param {string}   options.text         Plain-text body
 * @param {string}   options.html         HTML body (tracking pixel appended automatically)
 * @param {'general'|'director'|'team'} [options.profile='director'] Sender profile
 * @param {string}  [options.queueId]     Firebase queue item ID (if sent via queue)
 * @returns {Promise<Object>} Send result with trackingId
 */
async function sendEmail({ to, subject, text, html, profile = 'director', queueId }) {
  // 1. Check suppression list
  const suppressed = await db.isSuppressed(to);
  if (suppressed) {
    console.log(`[email] Skipped suppressed contact: ${to}`);
    if (queueId) {
      await db.updateQueueItem(queueId, { status: 'skipped_suppressed', updatedAt: Date.now() });
    }
    return { skipped: true, reason: 'suppressed', to };
  }

  // 2. Generate tracking ID
  const trackingId = uuidv4();

  // 3. Append tracking pixel to HTML body
  const htmlWithTracking = html
    ? `${html}\n${trackingPixelTag(trackingId)}`
    : `<p>${text || ''}</p>\n${trackingPixelTag(trackingId)}`;

  // 4. Build transport
  const transport = await createTransport(profile);

  // 5. Resolve sender identity
  let fromAddress;
  if (process.env.EMAIL_TRANSPORT === 'duocircle') {
    const profileMap = {
      general: { email: process.env.GENERAL_SENDER_EMAIL, name: process.env.GENERAL_SENDER_NAME },
      director: { email: process.env.DIRECTOR_SENDER_EMAIL, name: process.env.DIRECTOR_SENDER_NAME },
      team: { email: process.env.TEAM_SENDER_EMAIL, name: process.env.TEAM_SENDER_NAME },
    };
    const sender = profileMap[profile] || profileMap.director;
    fromAddress = `${sender.name || sender.email} <${sender.email}>`;
  } else {
    const creds = await getOAuthClient(profile);
    fromAddress = `${creds.senderName} <${creds.senderEmail}>`;
  }

  // 6. Compose mail with unsubscribe headers
  const mailOptions = {
    from: fromAddress,
    to,
    subject,
    text: text || '',
    html: htmlWithTracking,
    headers: unsubscribeHeaders(to, trackingId),
  };

  // 7. Send
  const result = await transport.sendMail(mailOptions);

  // 8. Record delivery in Firebase
  const transportType = process.env.EMAIL_TRANSPORT || 'gmail';
  await db.recordDelivery({
    trackingId,
    to,
    subject,
    from: fromAddress,
    profile,
    status: 'delivered',
    messageId: result.messageId,
    sentVia: transportType === 'duocircle' ? 'duocircle' : (profile === 'general' ? 'docker-relay' : 'gmail-api'),
    queueId: queueId || null,
  });

  // 9. Update queue item if applicable
  if (queueId) {
    await db.updateQueueItem(queueId, {
      status: 'sent',
      trackingId,
      sentAt: Date.now(),
    });
  }

  console.log(`[email] Sent to ${to} (trackingId: ${trackingId})`);
  return { ...result, trackingId };
}

/**
 * Send bulk emails (used by the Blue Truck relay).
 */
async function sendBulk(recipients, { subject, text, html, profile = 'director' }) {
  const results = [];
  for (const to of recipients) {
    try {
      const result = await sendEmail({ to, subject, text, html, profile });
      results.push(result);
    } catch (err) {
      console.error(`[email] Failed to send to ${to}: ${err.message}`);
      results.push({ to, error: err.message });
    }
  }
  return results;
}

module.exports = {
  sendEmail,
  sendBulk,
  createTransport,
  TRACKING_PIXEL,
};
