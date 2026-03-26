/**
 * Firebase Realtime Database service layer.
 *
 * Manages the following collections:
 *   /queue          – outbound email jobs
 *   /deliveries     – delivery confirmations
 *   /bounces        – hard & soft bounce records
 *   /spam           – spam complaint records
 *   /suppressions   – unsubscribed / DNC contacts
 *   /opens          – open-tracking events
 *   /clicks         – click-tracking events
 */

const { getDatabase } = require('../config/firebase');

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

async function enqueueEmail(emailData) {
  const db = getDatabase();
  const ref = db.ref('queue').push();
  await ref.set({
    ...emailData,
    status: 'pending',
    createdAt: Date.now(),
  });
  return ref.key;
}

async function updateQueueItem(id, data) {
  const db = getDatabase();
  await db.ref(`queue/${id}`).update(data);
}

async function getPendingEmails(limit = 50) {
  const db = getDatabase();
  const snap = await db
    .ref('queue')
    .orderByChild('status')
    .equalTo('pending')
    .limitToFirst(limit)
    .once('value');
  const items = [];
  snap.forEach((child) => {
    items.push({ id: child.key, ...child.val() });
  });
  return items;
}

// ---------------------------------------------------------------------------
// Deliveries
// ---------------------------------------------------------------------------

async function recordDelivery(deliveryData) {
  const db = getDatabase();
  const ref = db.ref('deliveries').push();
  await ref.set({
    ...deliveryData,
    deliveredAt: Date.now(),
  });
  return ref.key;
}

// ---------------------------------------------------------------------------
// Bounces
// ---------------------------------------------------------------------------

async function recordBounce(bounceData) {
  const db = getDatabase();
  const ref = db.ref('bounces').push();
  await ref.set({
    ...bounceData,
    bouncedAt: Date.now(),
  });
  return ref.key;
}

async function getSoftBounceCount(email) {
  const db = getDatabase();
  const snap = await db
    .ref('bounces')
    .orderByChild('email')
    .equalTo(email)
    .once('value');
  let count = 0;
  snap.forEach((child) => {
    if (child.val().type === 'soft') count++;
  });
  return count;
}

// ---------------------------------------------------------------------------
// Spam complaints
// ---------------------------------------------------------------------------

async function recordSpam(spamData) {
  const db = getDatabase();
  const ref = db.ref(`spam/${Date.now()}`);
  await ref.set({
    ...spamData,
    reportedAt: Date.now(),
  });
  return ref.key;
}

// ---------------------------------------------------------------------------
// Opens
// ---------------------------------------------------------------------------

async function recordOpen(trackingId, metadata = {}) {
  const db = getDatabase();
  const ref = db.ref(`opens/${trackingId}`).push();
  await ref.set({
    openedAt: Date.now(),
    ...metadata,
  });
}

async function getOpenCount(trackingId) {
  const db = getDatabase();
  const snap = await db.ref(`opens/${trackingId}`).once('value');
  return snap.numChildren();
}

// ---------------------------------------------------------------------------
// Clicks
// ---------------------------------------------------------------------------

async function recordClick(trackingId, linkId, metadata = {}) {
  const db = getDatabase();
  const ref = db.ref(`clicks/${trackingId}`).push();
  await ref.set({
    linkId,
    clickedAt: Date.now(),
    ...metadata,
  });
}

async function getClickCount(trackingId) {
  const db = getDatabase();
  const snap = await db.ref(`clicks/${trackingId}`).once('value');
  return snap.numChildren();
}

// ---------------------------------------------------------------------------
// Suppressions (DNC list)
// ---------------------------------------------------------------------------

async function addSuppression(email, reason) {
  const db = getDatabase();
  const key = Buffer.from(email.toLowerCase()).toString('base64').replace(/[.#$/[\]]/g, '_');
  await db.ref(`suppressions/${key}`).set({
    email: email.toLowerCase(),
    reason,
    suppressedAt: Date.now(),
  });
}

async function isSuppressed(email) {
  const db = getDatabase();
  const key = Buffer.from(email.toLowerCase()).toString('base64').replace(/[.#$/[\]]/g, '_');
  const snap = await db.ref(`suppressions/${key}`).once('value');
  return snap.exists();
}

async function removeSuppression(email) {
  const db = getDatabase();
  const key = Buffer.from(email.toLowerCase()).toString('base64').replace(/[.#$/[\]]/g, '_');
  await db.ref(`suppressions/${key}`).remove();
}

// ---------------------------------------------------------------------------
// Stats helpers (for reports)
// ---------------------------------------------------------------------------

async function getStats(collection, since) {
  const db = getDatabase();
  const snap = await db.ref(collection).once('value');
  const items = [];
  snap.forEach((child) => {
    const val = child.val();
    // Flatten nested push-key structures (e.g. /opens/trackingId/pushKey)
    if (typeof val === 'object' && !val.email && !val.to) {
      Object.values(val).forEach((nested) => {
        if (nested && typeof nested === 'object') items.push(nested);
      });
    } else {
      items.push(val);
    }
  });
  if (!since) return items;
  const sinceMs = typeof since === 'number' ? since : new Date(since).getTime();
  return items.filter((item) => {
    const ts =
      item.deliveredAt || item.bouncedAt || item.reportedAt ||
      item.openedAt || item.suppressedAt || item.createdAt || 0;
    return ts >= sinceMs;
  });
}

module.exports = {
  // Queue
  enqueueEmail,
  updateQueueItem,
  getPendingEmails,
  // Deliveries
  recordDelivery,
  // Bounces
  recordBounce,
  getSoftBounceCount,
  // Spam
  recordSpam,
  // Opens
  recordOpen,
  getOpenCount,
  // Clicks
  recordClick,
  getClickCount,
  // Suppressions
  addSuppression,
  isSuppressed,
  removeSuppression,
  // Stats
  getStats,
};
