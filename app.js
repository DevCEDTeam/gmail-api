/**
 * Gmail Bulk Sending — Main Application
 *
 * Starts all services:
 *   - Blue Truck relay server   (HTTP API for sending emails)
 *   - Webhook server            (bounce/spam/unsubscribe callbacks + open tracking)
 *   - Orange Airplane worker    (queue processor)
 *
 * In production each service runs independently (Cloud Run, Cloud Functions).
 * This combined entry point is for local development and testing.
 *
 * Usage:
 *   npm start           # Start all services
 *   npm run relay       # Blue Truck relay only
 *   npm run worker      # Orange Airplane worker only
 *   npm run webhooks    # Webhook server only
 *   npm run report      # Generate and send weekly report
 */

require('dotenv').config();
const { initFirebase } = require('./src/config/firebase');

const relayApp = require('./src/relay/server');
const webhookApp = require('./src/webhooks/server');
const { processOnce, onQueueWrite } = require('./src/queue/worker');
const { getDatabase } = require('./src/config/firebase');

const RELAY_PORT = process.env.RELAY_PORT || 3000;
const WEBHOOK_PORT = process.env.WEBHOOK_PORT || 3001;

async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Gmail Bulk Sending — Full Tracking System');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  // Initialise Firebase
  try {
    initFirebase();
    console.log('[init] Firebase connected');
  } catch (err) {
    console.warn(`[init] Firebase unavailable: ${err.message}`);
    console.warn('[init] Running without Firebase — tracking features disabled');
  }

  // Start Blue Truck relay
  relayApp.listen(RELAY_PORT, () => {
    console.log(`[relay]    Blue Truck 🚚  listening on :${RELAY_PORT}`);
  });

  // Start webhook/tracking server
  webhookApp.listen(WEBHOOK_PORT, () => {
    console.log(`[webhooks] Tracking   📊  listening on :${WEBHOOK_PORT}`);
  });

  // Start Orange Airplane queue listener
  try {
    const db = getDatabase();
    console.log('[worker]   Airplane   ✈️   listening for /queue items');

    // Process any backlog
    await processOnce();

    // Listen for new items
    db.ref('queue')
      .orderByChild('status')
      .equalTo('pending')
      .on('child_added', async (snap) => {
        const item = { id: snap.key, ...snap.val() };
        console.log(`[worker] New queue item: ${item.id} → ${item.to}`);
        const { processQueueItem } = require('./src/queue/worker');
        await processQueueItem(item);
      });
  } catch (err) {
    console.warn(`[worker] Queue listener unavailable: ${err.message}`);
  }

  console.log('');
  console.log('System ready. Endpoints:');
  console.log(`  POST http://localhost:${RELAY_PORT}/relay/send     — Send single email`);
  console.log(`  POST http://localhost:${RELAY_PORT}/relay/bulk     — Send bulk emails`);
  console.log(`  POST http://localhost:${RELAY_PORT}/relay/queue    — Queue for async`);
  console.log(`  GET  http://localhost:${RELAY_PORT}/relay/stats    — View stats`);
  console.log(`  POST http://localhost:${WEBHOOK_PORT}/mailer/callback  — ESP webhook`);
  console.log(`  GET  http://localhost:${WEBHOOK_PORT}/tracking/open/:id — Open pixel`);
  console.log(`  GET  http://localhost:${WEBHOOK_PORT}/email/unsubscribe/:id`);
  console.log(`  GET  http://localhost:${WEBHOOK_PORT}/email/dnc/:id`);
  console.log('');
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
