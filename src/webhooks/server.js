/**
 * Webhook server for email event callbacks.
 *
 * Endpoints:
 *   POST /mailer/callback           – Mautic / ESP bounce & spam callbacks
 *   GET  /tracking/open/:trackingId – Open-tracking pixel
 *   GET  /email/unsubscribe/:id     – Unsubscribe preference page
 *   POST /email/unsubscribe/:id     – Process unsubscribe (RFC 8058 one-click)
 *   GET  /email/dnc/:id             – Full Do-Not-Contact opt-out
 *   GET  /health                    – Health check
 */

require('dotenv').config();
const express = require('express');
const db = require('../services/database');
const { TRACKING_PIXEL } = require('../services/email');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const SOFT_BOUNCE_THRESHOLD = 5;

// -------------------------------------------------------------------------
// Health check
// -------------------------------------------------------------------------

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'gmail-bulk-sending-webhooks' });
});

// -------------------------------------------------------------------------
// Open tracking pixel
// -------------------------------------------------------------------------

app.get('/tracking/open/:trackingId', async (req, res) => {
  const { trackingId } = req.params;
  try {
    await db.recordOpen(trackingId, {
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });
  } catch (err) {
    console.error(`[open-tracking] Error recording open: ${err.message}`);
  }
  // Always return the pixel regardless of DB errors
  res.set({
    'Content-Type': 'image/gif',
    'Content-Length': TRACKING_PIXEL.length,
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    Pragma: 'no-cache',
    Expires: '0',
  });
  res.end(TRACKING_PIXEL);
});

// -------------------------------------------------------------------------
// Mautic / ESP webhook callback
// -------------------------------------------------------------------------

app.post('/mailer/callback', async (req, res) => {
  const events = Array.isArray(req.body) ? req.body : [req.body];

  for (const event of events) {
    try {
      const type = (event.type || event.event || '').toLowerCase();
      const email = event.email || event.recipient || event.contact?.email || '';

      if (!email) {
        console.warn('[callback] Event missing email:', JSON.stringify(event));
        continue;
      }

      switch (type) {
        // ----- Bounces -----
        case 'bounce':
        case 'hard_bounce':
        case 'soft_bounce': {
          const bounceType = type === 'soft_bounce' ? 'soft' : 'hard';
          await db.recordBounce({
            email,
            type: bounceType,
            reason: event.reason || event.description || '',
            messageId: event.messageId || event.message_id || '',
          });

          if (bounceType === 'hard') {
            await db.addSuppression(email, 'hard_bounce');
            console.log(`[callback] Hard bounce → DNC: ${email}`);
          } else {
            const count = await db.getSoftBounceCount(email);
            if (count >= SOFT_BOUNCE_THRESHOLD) {
              await db.addSuppression(email, 'soft_bounce_limit');
              console.log(`[callback] Soft bounce limit reached → DNC: ${email}`);
            }
          }
          break;
        }

        // ----- Spam complaints -----
        case 'spam':
        case 'complaint':
        case 'spam_complaint': {
          await db.recordSpam({
            email,
            messageId: event.messageId || event.message_id || '',
            feedbackType: event.feedbackType || 'abuse',
          });
          await db.addSuppression(email, 'spam_complaint');
          console.log(`[callback] Spam complaint → DNC: ${email}`);
          break;
        }

        // ----- Unsubscribes via ESP callback -----
        case 'unsubscribe':
        case 'unsub': {
          await db.addSuppression(email, 'unsubscribed');
          console.log(`[callback] Unsubscribe → DNC: ${email}`);
          break;
        }

        default:
          console.log(`[callback] Unhandled event type: ${type}`);
      }
    } catch (err) {
      console.error(`[callback] Error processing event: ${err.message}`);
    }
  }

  res.json({ received: true, processed: events.length });
});

// -------------------------------------------------------------------------
// Unsubscribe page (GET shows form, POST processes)
// -------------------------------------------------------------------------

app.get('/email/unsubscribe/:trackingId', (req, res) => {
  const { trackingId } = req.params;
  res.send(`<!DOCTYPE html>
<html>
<head><title>Unsubscribe</title>
<style>
  body { font-family: sans-serif; max-width: 480px; margin: 60px auto; text-align: center; }
  button { padding: 12px 32px; font-size: 16px; cursor: pointer; border: none; border-radius: 6px; }
  .unsub { background: #e74c3c; color: #fff; margin-right: 12px; }
  .cancel { background: #95a5a6; color: #fff; }
</style>
</head>
<body>
  <h2>Unsubscribe</h2>
  <p>Are you sure you want to stop receiving emails from cfored.com?</p>
  <form method="POST" action="/email/unsubscribe/${trackingId}">
    <button type="submit" class="unsub">Yes, unsubscribe me</button>
    <a href="https://cfored.com"><button type="button" class="cancel">Cancel</button></a>
  </form>
</body>
</html>`);
});

app.post('/email/unsubscribe/:trackingId', async (req, res) => {
  const { trackingId } = req.params;
  const email = req.body?.email || req.body?.['List-Unsubscribe'] || '';

  // For one-click (RFC 8058) the email may not be in the body;
  // we look it up from the delivery record.
  try {
    const { getDatabase } = require('../config/firebase');
    const dbRef = getDatabase();
    const snap = await dbRef
      .ref('deliveries')
      .orderByChild('trackingId')
      .equalTo(trackingId)
      .limitToFirst(1)
      .once('value');

    let recipientEmail = email;
    snap.forEach((child) => {
      recipientEmail = recipientEmail || child.val().to;
    });

    if (recipientEmail) {
      await db.addSuppression(recipientEmail, 'unsubscribed');
      console.log(`[unsubscribe] ${recipientEmail} unsubscribed (tracking: ${trackingId})`);
    }
  } catch (err) {
    console.error(`[unsubscribe] Error: ${err.message}`);
  }

  res.send(`<!DOCTYPE html>
<html>
<head><title>Unsubscribed</title>
<style>body{font-family:sans-serif;max-width:480px;margin:60px auto;text-align:center;}</style>
</head>
<body>
  <h2>You have been unsubscribed</h2>
  <p>You will no longer receive emails from cfored.com.</p>
  <p>If this was a mistake, please contact <a href="mailto:team@cfored.com">team@cfored.com</a>.</p>
</body>
</html>`);
});

// -------------------------------------------------------------------------
// Full DNC (Do-Not-Contact on ALL channels)
// -------------------------------------------------------------------------

app.get('/email/dnc/:trackingId', async (req, res) => {
  const { trackingId } = req.params;

  try {
    const { getDatabase } = require('../config/firebase');
    const dbRef = getDatabase();
    const snap = await dbRef
      .ref('deliveries')
      .orderByChild('trackingId')
      .equalTo(trackingId)
      .limitToFirst(1)
      .once('value');

    let recipientEmail = '';
    snap.forEach((child) => {
      recipientEmail = child.val().to;
    });

    if (recipientEmail) {
      await db.addSuppression(recipientEmail, 'dnc_all_channels');
      console.log(`[dnc] ${recipientEmail} added to full DNC (tracking: ${trackingId})`);
    }
  } catch (err) {
    console.error(`[dnc] Error: ${err.message}`);
  }

  res.send(`<!DOCTYPE html>
<html>
<head><title>Do Not Contact</title>
<style>body{font-family:sans-serif;max-width:480px;margin:60px auto;text-align:center;}</style>
</head>
<body>
  <h2>You have been removed</h2>
  <p>You will no longer be contacted on any channel by cfored.com.</p>
</body>
</html>`);
});

// -------------------------------------------------------------------------
// Start server
// -------------------------------------------------------------------------

const PORT = process.env.WEBHOOK_PORT || 3001;

if (require.main === module) {
  const { initFirebase } = require('../config/firebase');
  initFirebase();
  app.listen(PORT, () => {
    console.log(`[webhooks] Listening on port ${PORT}`);
    console.log(`[webhooks] Callback URL: POST /mailer/callback`);
    console.log(`[webhooks] Open pixel:   GET  /tracking/open/:trackingId`);
    console.log(`[webhooks] Unsubscribe:  GET  /email/unsubscribe/:trackingId`);
    console.log(`[webhooks] DNC:          GET  /email/dnc/:trackingId`);
  });
}

module.exports = app;
