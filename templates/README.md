# Outreach Templates — NCC Litigation Financing

Email templates for NCC investor outreach, formatted for this relay's send pipeline
(`POST /relay/send`, `/relay/bulk`, or `/relay/queue` — the pipeline auto-appends the
tracking pixel, wraps links for click tracking, and adds RFC 8058 List-Unsubscribe
headers; suppression is checked before every send).

---

## Template Sequence (two-touch flow)

| Order | File | When | Contains |
|-------|------|------|----------|
| **1 — Primary** | `nda-first-outreach.{html,txt}` | First contact with every firm | NDA inquiry only — **no terms, no amounts, no documents** |
| **2 — On request** | `litigation-finance-outreach.{html,txt}` | Only if a firm asks for context before signing the NDA | Non-confidential Preliminary Summary terms (Venture_III framing) |

The NDA-first template is the **authorized final version** (template.docx,
Aug 11 2026), mirrored here verbatim: counsel-approved body, official CED signature
block (full address, phone x1, fax, web), CED confidentiality notice, and the
not-an-offer disclaimer. Counsel's standing directives:
- Never represent an exemption as established fact — the "structured to rely on …
  Regulation D … and, where appropriate, Regulation S" phrasing stands; never
  characterize recipient firms with a "(Reg. D)" parenthetical in any correspondence
- First touch stays limited to the NDA and general introductory matters — no
  offering, litigation, or confidential materials before an executed **mutual** NDA
- **BAoHC reference permitted (counsel, Aug 13 2026):** the BAoHC website and a
  description of BAoHC as a **proposed agentic AI banking standard** may be included
  in initial communications, provided the description remains clearly qualified as
  proposed and does not suggest BAoHC has been validated, deployed, or adopted by
  any financial institution. Implemented as a clearly-marked OPTIONAL paragraph in
  both template files (include or delete whole; fill `{{BAOHC_URL}}` before sending —
  the sentence wording is drafted to counsel's guardrails but was not itself
  reviewed verbatim)

**Do not reword any part of the template without counsel sign-off.**

Why NDA-first is the right sequence:
- It contains no offering details, so a first touch to a non-US firm does not
  trip the "no materials to non-US persons before NDA" rule
- It filters for genuine interest before anything substantive leaves NCC
- It matches the message already sent to the first two contacted firms,
  keeping all outreach consistent

## ⚠ COMPLIANCE GATES — DO NOT SEND UNTIL ALL PASS

1. **Counsel approval of the template text** — ✅ CLEARED (Aug 2026): approved;
   authorized final version received as template.docx (Aug 11, 2026) and mirrored
   in `nda-first-outreach.{html,txt}` verbatim. Never use a "(Reg. D)" parenthetical
   when characterizing recipient firms in any correspondence
2. **Counsel engagement model** — ✅ CONFIRMED by counsel (Aug 11, 2026): Harold
   proceeds with initial outreach independently using the revised template; counsel
   engaged when a recipient is prepared to proceed with an NDA, or if a substantive
   legal issue arises before that stage — separate hourly arrangement at $200/hr
   covering NDA preparation/negotiation and subsequent securities-law advice
3. **Recipient verification** — each contact must be an actual litigation finance /
   legal-asset investment firm with a named investment or origination contact.
   **The 8/10/2026 CSV (72 firms) fails this check — see List Hygiene below**
4. **No banks** — bank holding companies and depository institutions are excluded
5. **No attorney or law firm names** in any outreach material
6. **No Joint Stipulation / SRO references** in outreach
7. **NDA executed before any additional detail** — PPM, term sheet, case dossiers only
   after NDA + accreditation verification
8. **Delaware board documents executed** — confirmed before outreach

## Recommended Path

```
Stage 1  VERIFY LIST      Replace/clean the CSV: actual litigation funders only,
                          named contacts, no banks. US-domiciled firms first wave;
                          offshore firms second wave (NDA-first covers them, but
                          sequencing US-first is cleaner while counsel confirms).
   │
Stage 2  COUNSEL GATE     ✅ Template approved (Aug 2026, with guidance). Fee
                          compromise proposed: no per-send review; counsel joins
                          at the NDA stage under separate terms.
   │
Stage 3  FIRST TOUCH      Send nda-first-outreach via /relay/send, profile
                          "director", one merge-personalized send per contact.
                          Opens/clicks tracked automatically per recipient.
   │
Stage 4  TRIAGE           ├─ Willing to sign NDA    → ENGAGE COUNSEL (Stage 6)
         RESPONSES        ├─ Wants context first    → send Preliminary Summary
         (legal questions │                           (litigation-finance-outreach)
          held for counsel)
                          └─ No response in 10-14d  → one follow-up nudge, then close
   │
Stage 5  FOLLOW-UP        Previously contacted firms (see Outreach Log): one short
                          follow-up referencing the original NDA request (counsel-
                          approved wording), then mark unresponsive and move on.
   │
Stage 6  NDA EXECUTED     Counsel delivers PPM, form of subscription, case dossiers.
                          506(c) accreditation verification (CPA/attorney letter or
                          third-party verifier) + KYC/AML + OFAC before subscription.
   │
Stage 7  RECORD           /relay/stats for open+click engagement per wave;
                          forward full correspondence trail to counsel; Form D
                          within 15 days of first sale.
```

## Outreach Log

Tracked outside the repo — keep counterparty names and correspondence out of
committed files. Slots below are anonymous placeholders only.

| Slot | First Touch | Status | Next Action |
|------|------------|--------|-------------|
| Firm A | pre-8/2026 (NDA request) | No response | Counsel-approved follow-up, then close if silent |
| Firm B | pre-8/2026 (NDA request) | No response | Counsel-approved follow-up, then close if silent |
| — remaining list — | — | Blocked | Pending counsel template approval + list verification |

## List Hygiene — 8/10/2026 CSV

The uploaded `litigationfinance8102026.csv` (72 rows) is a Crunchbase Series D
fintech export, **not** a litigation finance list: zero litigation funders present,
several banks included, ~half the rows are non-US operating companies, and contacts
are generic inboxes (`support@`, `hello@`). Do not send to it as-is.

Rebuild the list from: the pipeline's category-iii targets (Burford Capital,
Omni Bridgeway, Therium Capital, Longford Capital) plus verified litigation funders
with named contacts (e.g. Parabellum Capital, Bench Walk Advisors, Curiam Capital,
Pravati Capital, Statera Capital, Delta Capital Partners — verify each before adding).
Keep working contact data in the send-time payload, not committed to this repo.

## Merge & Send

Merge fields: `{{firstName}}` (both templates), `{{firmName}}` (Preliminary Summary
template only). Replace per recipient before sending.

```bash
# First touch — NDA-first, director profile, tracked
curl -X POST $RELAY_URL/relay/send \
  -H "Content-Type: application/json" \
  -d @- <<'JSON'
{
  "to": "RECIPIENT",
  "subject": "Request to Discuss NDA — New Capital Committee (NCC)",
  "html": "<merged nda-first-outreach.html>",
  "text": "<merged nda-first-outreach.txt>",
  "profile": "director"
}
JSON
```
