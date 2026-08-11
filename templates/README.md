# Outreach Templates

Email templates for NCC investor outreach, formatted for this relay's send pipeline
(`POST /relay/send`, `/relay/bulk`, or `/relay/queue` — the pipeline auto-appends the
tracking pixel, wraps links for click tracking, and adds RFC 8058 List-Unsubscribe headers).

---

## ⚠ COMPLIANCE GATES — DO NOT SEND UNTIL ALL PASS

Per securities counsel (Venture_II/Venture_III, April 2026) and the NCC investor pipeline:

1. **Delaware board documents executed** (April 9, 2026 board meeting) — confirmed before any outreach
2. **Counsel review** — all outreach routes through securities counsel before materials are sent
3. **Stage 2 pre-qualification complete** for each recipient (accredited/institutional screen)
4. **First contact carries ONLY the non-confidential Preliminary Summary** — no PPM, no term sheet, no financials, no wire details
5. **NDA required** before any additional detail (Stage 3a)
6. **No banks** — litigation finance firms qualify (non-bank institutional investors)
7. **No individual attorney names or law firm names** in any outreach material
8. **No Joint Stipulation / SRO references** in first-touch email (requires "Proposed" framing + counsel review — omitted entirely here)

## Templates

| File | Purpose |
|------|---------|
| `litigation-finance-outreach.html` | HTML body for litigation finance firm first contact |
| `litigation-finance-outreach.txt` | Plain-text alternative (sendEmail `text` field) |

**Merge fields:** `{{firstName}}`, `{{firmName}}` — replace per recipient before sending.
**Attachment:** the Preliminary Summary (.docx or PDF per `teaser` skill output formats)
accompanies this email. The email body summarizes; the document is the deliverable.

## Target List — Litigation Finance Specialists (pipeline category iii)

| Firm | Domicile | Contact | Stage |
|------|----------|---------|-------|
| Burford Capital | US/UK (NYSE: BUR) | _fill after Stage 1–2_ | Identify |
| Omni Bridgeway | Australia (ASX: OBL) | _fill after Stage 1–2_ | Identify |
| Therium Capital Management | UK | _fill after Stage 1–2_ | Identify |
| Longford Capital Management | US (Chicago) | _fill after Stage 1–2_ | Identify |

Do not add contact emails to this file until pre-qualification is complete; keep working
contact data out of the repo (use the send-time payload instead).

## Send Example (after all gates pass)

```bash
# Single send with tracking, director profile
curl -X POST $RELAY_URL/relay/send \
  -H "Content-Type: application/json" \
  -d @- <<'JSON'
{
  "to": "RECIPIENT",
  "subject": "Litigation Financing Opportunity — Senior Secured Notes / Preferred Equity (up to $10M)",
  "html": "<merged HTML from litigation-finance-outreach.html>",
  "text": "<merged text from litigation-finance-outreach.txt>",
  "profile": "director"
}
JSON
```

Suppression is checked automatically before every send; opens and clicks are recorded
per recipient via the tracking pixel and wrapped links.
