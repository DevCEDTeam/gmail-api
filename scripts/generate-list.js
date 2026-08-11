/**
 * Crunchbase list generator — litigation finance firm candidates.
 *
 * Queries the Crunchbase v4 Search API with the description-keyword recipe
 * (the load-bearing filter) and writes candidates to data/candidates.csv.
 * No funding-round filter — litigation funders deploy capital, they don't raise it.
 *
 * Usage:
 *   CRUNCHBASE_API_KEY=xxx node scripts/generate-list.js
 *   node scripts/generate-list.js            # reads key from .env
 *
 * Requires a Crunchbase plan with Search API access.
 * Output is gitignored (data/) — recipient data never gets committed.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const API_KEY = process.env.CRUNCHBASE_API_KEY;
const OUT_DIR = path.join(__dirname, '..', 'data');
const OUT_FILE = path.join(OUT_DIR, 'candidates.csv');

const KEYWORDS = [
  'litigation finance',
  'litigation funding',
  'legal finance',
  'lawsuit funding',
  'legal assets',
  'third-party funding',
  'judgment enforcement',
  'claims monetization',
];

const PAGE_LIMIT = 50; // Crunchbase max per request

function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function searchPage(afterId) {
  const body = {
    field_ids: [
      'identifier',
      'name',
      'short_description',
      'website_url',
      'location_identifiers',
      'categories',
      'operating_status',
      'rank_org',
    ],
    query: [
      {
        type: 'predicate',
        field_id: 'short_description',
        operator_id: 'contains',
        values: KEYWORDS,
      },
      {
        type: 'predicate',
        field_id: 'operating_status',
        operator_id: 'eq',
        values: ['active'],
      },
    ],
    order: [{ field_id: 'rank_org', sort: 'asc' }],
    limit: PAGE_LIMIT,
  };
  if (afterId) body.after_id = afterId;

  const res = await fetch(
    `https://api.crunchbase.com/api/v4/searches/organizations?user_key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Crunchbase API ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

async function main() {
  if (!API_KEY) {
    console.error('[generate-list] CRUNCHBASE_API_KEY not set (add to .env — gitignored).');
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const rows = [];
  let afterId = null;
  let page = 0;

  do {
    page++;
    const data = await searchPage(afterId);
    const entities = data.entities || [];
    console.log(`[generate-list] Page ${page}: ${entities.length} results`);

    for (const e of entities) {
      const p = e.properties || {};
      const locations = (p.location_identifiers || []).map((l) => l.value).join('; ');
      const categories = (p.categories || []).map((c) => c.value).join('; ');
      rows.push({
        name: p.name || '',
        description: p.short_description || '',
        website: p.website_url || '',
        locations,
        categories,
        cbUuid: e.uuid || '',
      });
    }

    afterId = entities.length === PAGE_LIMIT ? entities[entities.length - 1].uuid : null;
  } while (afterId);

  const header = 'name,description,website,locations,categories,cb_uuid';
  const lines = rows.map((r) =>
    [r.name, r.description, r.website, r.locations, r.categories, r.cbUuid]
      .map(csvEscape)
      .join(','),
  );
  fs.writeFileSync(OUT_FILE, [header, ...lines].join('\n') + '\n');

  console.log(`[generate-list] Wrote ${rows.length} candidates → ${OUT_FILE}`);
  console.log('[generate-list] Next: node scripts/validate-list.js');
}

main().catch((err) => {
  console.error('[generate-list] Fatal:', err.message);
  process.exit(1);
});
