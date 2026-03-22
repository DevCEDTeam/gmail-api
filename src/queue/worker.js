/**
 * Queue worker — the "Orange Airplane" ✈️
 *
 * Watches the Firebase /queue for new email jobs and processes them.
 * Each job is checked against the suppression list before sending.
 *
 * Can run as:
 *   - A standalone Node process (npm run worker)
 *   - Deployed as a Cloud Function triggered by /queue writes
 *
 * Usage:
 *   node src/queue/worker.js              # Continuous listener
 *   node src/queue/worker.js --once       # Process pending items and exit
 */

require('dotenv').config();
const { initFirebase, getDatabase } = require('../config/firebase');
const { sendEmail } = require('../services/email');
const db = require('../services/database');

const CONCURRENCY = parseInt(process.env.QUEUE_CONCURRENCY || '5', 10);

/**
 * Process a single queue item.
 */
async function processQueueItem(item) {
  const { id, to, subject, text, html, profile } = item;

  try {
    // Mark as processing
    await db.updateQueueItem(id, { status: 'processing', startedAt: Date.now() });

    // Send (suppression check happens inside sendEmail)
    const result = await sendEmail({
      to,
      subject,
      text,
      html,
      profile: profile || 'team',
      queueId: id,
    });

    if (result.skipped) {
      console.log(`[worker] Skipped ${to}: ${result.reason}`);
    } else {
      console.log(`[worker] Sent to ${to} (trackingId: ${result.trackingId})`);
    }
  } catch (err) {
    console.error(`[worker] Failed to process ${id} (${to}): ${err.message}`);
    await db.updateQueueItem(id, {
      status: 'failed',
      error: err.message,
      failedAt: Date.now(),
    });
  }
}

/**
 * Process a batch of pending items with limited concurrency.
 */
async function processBatch(items) {
  // Process in chunks of CONCURRENCY
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const chunk = items.slice(i, i + CONCURRENCY);
    await Promise.all(chunk.map(processQueueItem));
  }
}

/**
 * One-shot: process all pending items and exit.
 */
async function processOnce() {
  const items = await db.getPendingEmails(200);
  if (items.length === 0) {
    console.log('[worker] No pending items in queue.');
    return;
  }
  console.log(`[worker] Processing ${items.length} pending items...`);
  await processBatch(items);
  console.log('[worker] Batch complete.');
}

/**
 * Continuous: listen for new items added to /queue.
 */
function startListener() {
  const dbRef = getDatabase();
  console.log('[worker] Listening for new queue items...');

  dbRef
    .ref('queue')
    .orderByChild('status')
    .equalTo('pending')
    .on('child_added', async (snap) => {
      const item = { id: snap.key, ...snap.val() };
      console.log(`[worker] New item: ${item.id} → ${item.to}`);
      await processQueueItem(item);
    });
}

// -------------------------------------------------------------------------
// Cloud Function export (Orange Airplane as a Firebase Cloud Function)
// -------------------------------------------------------------------------

/**
 * Firebase Cloud Function handler.
 * Triggered when a new child is written to /queue.
 *
 * Deploy with:
 *   firebase deploy --only functions
 */
async function onQueueWrite(snapshot, context) {
  const item = { id: context.params.queueId, ...snapshot.val() };
  if (item.status !== 'pending') return;
  await processQueueItem(item);
}

// -------------------------------------------------------------------------
// Main
// -------------------------------------------------------------------------

if (require.main === module) {
  initFirebase();

  const runOnce = process.argv.includes('--once');
  if (runOnce) {
    processOnce()
      .then(() => process.exit(0))
      .catch((err) => {
        console.error('[worker] Fatal:', err);
        process.exit(1);
      });
  } else {
    // First drain any backlog, then listen for new items
    processOnce().then(() => startListener());
  }
}

module.exports = { processQueueItem, processOnce, onQueueWrite };
