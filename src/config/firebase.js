/**
 * Firebase Admin SDK initialisation.
 *
 * Uses Application Default Credentials in GCP (Cloud Run / Cloud Functions).
 * Locally, set GOOGLE_APPLICATION_CREDENTIALS to a service-account key file
 * or provide FIREBASE_DATABASE_URL directly.
 */

const admin = require('firebase-admin');

let initialised = false;

function initFirebase() {
  if (initialised) return admin;

  const databaseURL =
    process.env.FIREBASE_DATABASE_URL ||
    'https://gmail-bulk-sending-389112-default-rtdb.firebaseio.com';

  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    databaseURL,
  });

  initialised = true;
  return admin;
}

function getDatabase() {
  initFirebase();
  return admin.database();
}

module.exports = { initFirebase, getDatabase };
