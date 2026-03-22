/**
 * SMTP relay server — the "Blue Truck" 🚚
 *
 * Receives email from cPanel's Exim MTA and relays it through Gmail
 * using OAuth2 authentication with full tracking.
 *
 * Architecture:
 *   cPanel (Exim) → SMTP relay (this) → Gmail API → Recipient
 *
 * The relay runs as an Express HTTP server that accepts email jobs.
 * For Docker deployment, see Dockerfile at project root.
 *
 * Usage:
 *   npm run relay
 *   # or
 *   node src/relay/server.js
 */

require('dotenv').config();
const express = require('express');
const { sendEmail, sendBulk } = require('../services/email');
const { initFirebase } = require('../config/firebase');
const db = require('../services/database');

const app = express();
app.use(express.json({ limit: '10mb' }));

// -------------------------------------------------------------------------
// Health check
// -------------------------------------------------------------------------

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'gmail-bulk-sending-relay', role: 'blue-truck' });
});

// -------------------------------------------------------------------------
// Single email relay
// -------------------------------------------------------------------------

app.post('/relay/send', async (req, res) => {
  const { to, subject, text, html, profile } = req.body;

  if (!to || !subject) {
    return res.status(400).json({ error: 'Missing required fields: to, subject' });
  }

  try {
    const result = await sendEmail({
      to,
      subject,
      text,
      html,
      profile: profile || 'director',
    });
    res.json({ success: true, ...result });
  } catch (err) {
    console.error(`[relay] Send failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------------------
// Bulk email relay
// -------------------------------------------------------------------------

app.post('/relay/bulk', async (req, res) => {
  const { recipients, subject, text, html, profile } = req.body;

  if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
    return res.status(400).json({ error: 'Missing required field: recipients (array)' });
  }
  if (!subject) {
    return res.status(400).json({ error: 'Missing required field: subject' });
  }

  try {
    const results = await sendBulk(recipients, {
      subject,
      text,
      html,
      profile: profile || 'director',
    });

    const sent = results.filter((r) => !r.error && !r.skipped).length;
    const skipped = results.filter((r) => r.skipped).length;
    const failed = results.filter((r) => r.error).length;

    res.json({
      success: true,
      total: recipients.length,
      sent,
      skipped,
      failed,
      results,
    });
  } catch (err) {
    console.error(`[relay] Bulk send failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------------------
// Queue email for async processing (hand off to Orange Airplane)
// -------------------------------------------------------------------------

app.post('/relay/queue', async (req, res) => {
  const { to, subject, text, html, profile } = req.body;

  if (!to || !subject) {
    return res.status(400).json({ error: 'Missing required fields: to, subject' });
  }

  try {
    const queueId = await db.enqueueEmail({
      to,
      subject,
      text,
      html,
      profile: profile || 'team',
    });
    res.json({ success: true, queued: true, queueId });
  } catch (err) {
    console.error(`[relay] Queue failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------------------
// Stats endpoint
// -------------------------------------------------------------------------

app.get('/relay/stats', async (req, res) => {
  try {
    const since = req.query.since
      ? new Date(req.query.since).getTime()
      : Date.now() - 7 * 24 * 60 * 60 * 1000; // default: last 7 days

    const [deliveries, bounces, spam, opens] = await Promise.all([
      db.getStats('deliveries', since),
      db.getStats('bounces', since),
      db.getStats('spam', since),
      db.getStats('opens', since),
    ]);

    const hardBounces = bounces.filter((b) => b.type === 'hard').length;
    const softBounces = bounces.filter((b) => b.type === 'soft').length;

    res.json({
      period: { since: new Date(since).toISOString(), until: new Date().toISOString() },
      deliveries: deliveries.length,
      opens: opens.length,
      openRate: deliveries.length > 0
        ? ((opens.length / deliveries.length) * 100).toFixed(1) + '%'
        : '0%',
      bounces: { total: bounces.length, hard: hardBounces, soft: softBounces },
      bounceRate: deliveries.length > 0
        ? ((bounces.length / deliveries.length) * 100).toFixed(1) + '%'
        : '0%',
      spamComplaints: spam.length,
      spamRate: deliveries.length > 0
        ? ((spam.length / deliveries.length) * 100).toFixed(3) + '%'
        : '0%',
    });
  } catch (err) {
    console.error(`[relay] Stats failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------------------
// Start server
// -------------------------------------------------------------------------

const PORT = process.env.RELAY_PORT || 3000;

if (require.main === module) {
  initFirebase();
  app.listen(PORT, () => {
    console.log(`[relay] Blue Truck listening on port ${PORT}`);
    console.log(`[relay] POST /relay/send    — Single email`);
    console.log(`[relay] POST /relay/bulk    — Bulk email`);
    console.log(`[relay] POST /relay/queue   — Queue for async`);
    console.log(`[relay] GET  /relay/stats   — Delivery stats`);
  });
}

module.exports = app;
