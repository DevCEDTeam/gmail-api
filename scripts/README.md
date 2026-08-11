# Outreach Pipeline Scripts

List generation → validation → ActiveCampaign staging for NCC litigation finance
outreach. **No script in this directory sends email.** The campaign is built in the
ActiveCampaign UI from `templates/nda-first-outreach.html` and sent by a human —
only after securities counsel approves the template text.

```
Crunchbase (UI export or API) ──→ data/candidates.csv        (gitignored)
                                        │
              validate-list.js ─────────┤  gates: litigation keyword, no banks,
                                        │  US → wave1 / non-US → wave2,
                                        │  generic-inbox flags
                                        ▼
                          data/wave1.csv + wave2.csv + rejected.csv
                                        │
                                 HUMAN REVIEW  (source named contacts,
                                        │       clear flags)
                                        ▼
        sync-activecampaign.js ──→ AC contacts + tags + list  (dry-run default)
                                        │
                                 COUNSEL GATE
                                        ▼
                    Campaign built + sent by a human in the AC UI
```

## Scripts

| Script | Purpose | Needs |
|--------|---------|-------|
| `generate-list.js` | Crunchbase v4 Search API → `data/candidates.csv`. Description-keyword recipe, active US firms, **no funding-round filter** | `CRUNCHBASE_API_KEY` (Search API plan) |
| `validate-list.js` | Screens any CSV (API output or Crunchbase UI export) against the compliance gates → `wave1/wave2/rejected.csv` | nothing |
| `sync-activecampaign.js` | Upserts reviewed wave rows into AC with tags (`litigation-finance-wave1`, `nda-outreach-pending`); optional list subscribe. **Dry-run by default**; `--execute` to write | `AC_API_URL`, `AC_API_KEY`, optional `AC_LIST_ID` |

The Crunchbase **web UI export** works without an API key: Discover → Add Filters →
Description Keywords (`litigation finance`, `litigation funding`, `legal finance`,
`lawsuit funding`, `third-party funding`) + HQ United States + Active + For Profit +
exclude Banking/Payments/InsurTech/Crowdfunding/Crypto — **no funding-type filter** —
then Export and run `validate-list.js path/to/export.csv`.

## Rules

- `data/` is gitignored — recipient lists, exports, and contact data never get committed
- API keys live in `.env` (gitignored) or Secret Manager — never in code, docs, or commits
- Rows flagged by the validator (generic inbox / missing email) are skipped by the AC
  sync until a named contact is sourced
- Compliance gates in `templates/README.md` apply to every send without exception
