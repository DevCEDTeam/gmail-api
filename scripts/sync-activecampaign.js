/**
 * ActiveCampaign contact sync — pushes VALIDATED wave lists into AC.
 *
 * Reads data/wave1.csv (output of validate-list.js, after human review),
 * upserts each contact via AC's contact/sync API, tags them, and optionally
 * adds them to a list.
 *
 * THIS SCRIPT NEVER SENDS EMAIL. It stages contacts only. The campaign is
 * built in the AC UI from templates/nda-first-outreach.html and sent by a
 * human — after securities counsel approves the template text.
 *
 * Usage:
 *   node scripts/sync-activecampaign.js                # dry run (default)
 *   node scripts/sync-activecampaign.js --execute      # actually sync
 *   node scripts/sync-activecampaign.js data/wave2.csv --execute --tag litigation-finance-wave2
 *
 * .env (gitignored):
 *   AC_API_URL=https://youraccount.api-us1.com
 *   AC_API_KEY=xxx
 *   AC_LIST_ID=1            # optional — AC list to subscribe contacts to
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const EXECUTE = args.includes('--execute');
const tagFlag = args.indexOf('--tag');
const TAG = tagFlag >= 0 ? args[tagFlag + 1] : 'litigation-finance-wave1';
const IN_FILE = args.find((a) => a.endsWith('.csv')) || path.join(__dirname, '..', 'data', 'wave1.csv');

const AC_URL = (process.env.AC_API_URL || '').replace(/\/$/, '');
const AC_KEY = process.env.AC_API_KEY;
const AC_LIST_ID = process.env.AC_LIST_ID;

const PENDING_TAG = 'nda-outreach-pending';
const THROTTLE_MS = 250; // AC limit: 5 req/s

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); if (row.some((f) => f !== '')) rows.push(row); }
  return rows;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ac(method, endpoint, body) {
  const res = await fetch(`${AC_URL}/api/3/${endpoint}`, {
    method,
    headers: { 'Api-Token': AC_KEY, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 422) {
    throw new Error(`AC ${method} ${endpoint} → ${res.status}: ${JSON.stringify(json).slice(0, 200)}`);
  }
  return json;
}

async function ensureTag(name) {
  const found = await ac('GET', `tags?search=${encodeURIComponent(name)}`);
  const hit = (found.tags || []).find((t) => t.tag === name);
  if (hit) return hit.id;
  const created = await ac('POST', 'tags', { tag: { tag: name, tagType: 'contact', description: 'NCC outreach' } });
  return created.tag.id;
}

async function main() {
  if (!fs.existsSync(IN_FILE)) {
    console.error(`[ac-sync] Input not found: ${IN_FILE} — run validate-list.js first.`);
    process.exit(1);
  }

  const rows = parseCsv(fs.readFileSync(IN_FILE, 'utf8'));
  const header = rows.shift().map((h) => h.trim().toLowerCase());
  const col = (n) => header.findIndex((h) => h.includes(n));
  const iName = col('name');
  const iEmail = col('email');
  const iFlags = col('flags');
  const iContact = Math.max(col('first'), col('contact name'));

  const ready = [];
  const skipped = [];
  for (const r of rows) {
    const email = (r[iEmail] || '').trim();
    const flags = iFlags >= 0 ? (r[iFlags] || '').trim() : '';
    if (!email || flags) skipped.push([r[iName], email, flags || 'no email']);
    else ready.push({ firm: r[iName] || '', email, firstName: iContact >= 0 ? (r[iContact] || '') : '' });
  }

  console.log(`[ac-sync] Input: ${IN_FILE}`);
  console.log(`[ac-sync] Ready to sync: ${ready.length}   Skipped (flagged/no email): ${skipped.length}`);
  for (const [firm, email, why] of skipped) console.log(`[ac-sync]   ⚠ skip ${firm} <${email}> — ${why}`);

  if (!EXECUTE) {
    console.log('[ac-sync] DRY RUN — no contacts written. Re-run with --execute after review.');
    for (const c of ready) console.log(`[ac-sync]   would sync: ${c.firm} <${c.email}> tag=${TAG},${PENDING_TAG}`);
    return;
  }

  if (!AC_URL || !AC_KEY) {
    console.error('[ac-sync] AC_API_URL / AC_API_KEY not set (add to .env — gitignored).');
    process.exit(1);
  }

  const tagId = await ensureTag(TAG);
  const pendingTagId = await ensureTag(PENDING_TAG);

  let synced = 0;
  for (const c of ready) {
    const { contact } = await ac('POST', 'contact/sync', {
      contact: { email: c.email, firstName: c.firstName, lastName: c.firm },
    });
    await ac('POST', 'contactTags', { contactTag: { contact: contact.id, tag: tagId } });
    await ac('POST', 'contactTags', { contactTag: { contact: contact.id, tag: pendingTagId } });
    if (AC_LIST_ID) {
      await ac('POST', 'contactLists', { contactList: { list: AC_LIST_ID, contact: contact.id, status: 1 } });
    }
    synced++;
    console.log(`[ac-sync] ✓ ${c.firm} <${c.email}>`);
    await sleep(THROTTLE_MS);
  }

  console.log(`[ac-sync] Done — ${synced} contacts synced, tagged ${TAG} + ${PENDING_TAG}.`);
  console.log('[ac-sync] Next: build the campaign in the AC UI from templates/nda-first-outreach.html.');
  console.log('[ac-sync] SEND ONLY after counsel approves the template. The send button stays human.');
}

main().catch((err) => {
  console.error('[ac-sync] Fatal:', err.message);
  process.exit(1);
});
