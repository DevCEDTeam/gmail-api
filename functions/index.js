/**
 * Firebase Cloud Functions — Orange Airplane ✈️
 *
 * Deploys the queue worker as a Cloud Function triggered by
 * new writes to /queue in Firebase Realtime Database.
 *
 * Deploy:
 *   firebase deploy --only functions
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();

const { processQueueItem } = require('../src/queue/worker');

/**
 * Triggered when a new email job is added to /queue/{queueId}.
 * Only processes items with status === 'pending'.
 */
exports.processEmailQueue = functions.database
  .ref('/queue/{queueId}')
  .onCreate(async (snapshot, context) => {
    const data = snapshot.val();
    if (data.status !== 'pending') return null;

    const item = { id: context.params.queueId, ...data };
    await processQueueItem(item);
    return null;
  });

/**
 * Scheduled weekly report — every Monday at 9:00 AM CST.
 */
exports.weeklyReport = functions.pubsub
  .schedule('0 9 * * 1')
  .timeZone('America/Chicago')
  .onRun(async () => {
    const { sendReport } = require('../src/reports/generate');
    await sendReport();
    return null;
  });
