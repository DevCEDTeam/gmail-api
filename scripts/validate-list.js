/**
 * List validator — screens candidates against the outreach compliance gates
 * BEFORE anything reaches ActiveCampaign or the relay.
 *
 * Gates enforced (templates/README.md):
 *   - Litigation-finance keyword must appear in the description (else reject)
 *   - Bank / depository indicators → reject (counsel rule: no banks)
 *   - US headquarters → wave 1; non-US → wave 2 (NDA-first, offshore sequencing)
 *   - Generic inbox (info@/support@/hello@...) → flagged; named contact required
 *
 * Usage:
 *   node scripts/validate-list.js                       # reads data/candidates.csv
 *   node scripts/validate-list.js data/other.csv        # custom input
 *
 * Outputs (all gitignored):
 *   data/wave1.csv      US candidates passing all gates
 *   data/wave2.csv      Non-US candidates passing all other gates
 *   data/rejected.csv   Failures, with reason column
 *
 * THIS SCRIPT DOES NOT SEND ANYTHING. Human review of wave1/wave2 output and
 * counsel approval of the template are still required before any outreach.
 */

const fs = require('fs');
const path = require('path');

const IN_FILE = process.argv[2] || path.join(__dirname, '..', 'data', 'candidates.csv');
const OUT_DIR = path.join(__dirname, '..', 'data');

const LIT_KEYWORDS = /litigation (finance|funding)|legal (finance|assets?|claims?)|lawsuit funding|third.?party funding|judgment enforcement|claims? monetiz/i;
const BANK_INDICATORS = /\bbank(ing)?\b|depository|credit union|neobank|bank holding/i;
const GENERIC_INBOX = /^(info|support|hello|contact|sales|press|pr|media|admin|help|team|office|enquiries|inquiries|customercare|service)@/i;
const US_LOCATION = /united states/i;

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

function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function writeCsv(file, header, rows) {
  fs.writeFileSync(file, [header.join(','), ...rows.map((r) => r.map(csvEscape).join(','))].join('\n') + '\n');
}

function main() {
  if (!fs.existsSync(IN_FILE)) {
    console.error(`[validate-list] Input not found: ${IN_FILE}`);
    console.error('[validate-list] Run scripts/generate-list.js first, or pass a CSV path.');
    process.exit(1);
  }

  const rows = parseCsv(fs.readFileSync(IN_FILE, 'utf8'));
  const header = rows.shift().map((h) => h.trim().toLowerCase());
  const col = (name) => header.findIndex((h) => h.includes(name));

  const iName = col('name');
  const iDesc = col('desc');
  const iLoc = Math.max(col('location'), col('headquarters'));
  const iEmail = col('email');
  const iCat = Math.max(col('categor'), col('industr'));

  const wave1 = [], wave2 = [], rejected = [];

  for (const r of rows) {
    const name = r[iName] || '';
    const desc = r[iDesc] || '';
    const loc = iLoc >= 0 ? r[iLoc] || '' : '';
    const email = iEmail >= 0 ? (r[iEmail] || '').trim() : '';
    const cats = iCat >= 0 ? r[iCat] || '' : '';
    const haystack = `${desc} ${cats}`;

    if (!LIT_KEYWORDS.test(haystack)) {
      rejected.push([name, loc, email, 'no litigation-finance keyword in description']);
      continue;
    }
    if (BANK_INDICATORS.test(`${name} ${haystack}`)) {
      rejected.push([name, loc, email, 'bank indicator — excluded per counsel rule']);
      continue;
    }

    const flags = [];
    if (email && GENERIC_INBOX.test(email)) flags.push('generic inbox — source a named contact');
    if (!email) flags.push('no contact email — source a named contact');

    const out = [name, loc, email, desc.slice(0, 160), flags.join(' | ')];
    (US_LOCATION.test(loc) ? wave1 : wave2).push(out);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outHeader = ['name', 'location', 'email', 'description', 'flags'];
  writeCsv(path.join(OUT_DIR, 'wave1.csv'), outHeader, wave1);
  writeCsv(path.join(OUT_DIR, 'wave2.csv'), outHeader, wave2);
  writeCsv(path.join(OUT_DIR, 'rejected.csv'), ['name', 'location', 'email', 'reason'], rejected);

  console.log(`[validate-list] Input rows:  ${rows.length}`);
  console.log(`[validate-list] Wave 1 (US): ${wave1.length}  → data/wave1.csv`);
  console.log(`[validate-list] Wave 2:      ${wave2.length}  → data/wave2.csv`);
  console.log(`[validate-list] Rejected:    ${rejected.length}  → data/rejected.csv`);
  const flagged = [...wave1, ...wave2].filter((r) => r[4]).length;
  if (flagged) console.log(`[validate-list] ⚠ ${flagged} rows flagged (named contact needed) — review before sync.`);
  console.log('[validate-list] Human review required. Next: node scripts/sync-activecampaign.js --dry-run');
}

main();
