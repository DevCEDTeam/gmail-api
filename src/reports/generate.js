/**
 * Weekly report generator.
 *
 * Produces the "Report Card" email sent to director@cfored.com every week.
 * Aggregates opens, bounces, spam complaints, and unsubscribes from Firebase.
 *
 * Usage:
 *   npm run report                   # Generate and send report
 *   node src/reports/generate.js     # Same
 *
 * Schedule via cron:
 *   0 9 * * 1 cd /app && node src/reports/generate.js   # Every Monday 9am
 */

require('dotenv').config();
const { initFirebase, getDatabase } = require('../config/firebase');
const { sendEmail } = require('../services/email');
const db = require('../services/database');

const REPORT_RECIPIENT = process.env.REPORT_RECIPIENT || 'director@cfored.com';
const DOMAIN = process.env.DOMAIN || 'cfored.com';

function grade(value, good, warning) {
  if (value <= good) return 'GOOD ✅';
  if (value <= warning) return 'WARNING ⚠️';
  return 'DANGER ❌';
}

function gradeOpen(rate) {
  if (rate >= 20) return 'GOOD ✅';
  if (rate >= 10) return 'OKAY ⚠️';
  return 'LOW ❌';
}

async function generateReport() {
  const now = Date.now();
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

  const [deliveries, bounces, spam, opens, suppressions] = await Promise.all([
    db.getStats('deliveries', weekAgo),
    db.getStats('bounces', weekAgo),
    db.getStats('spam', weekAgo),
    db.getStats('opens', weekAgo),
    db.getStats('suppressions', weekAgo),
  ]);

  const totalSent = deliveries.length;
  const totalOpens = opens.length;
  const hardBounces = bounces.filter((b) => b.type === 'hard').length;
  const softBounces = bounces.filter((b) => b.type === 'soft').length;
  const totalBounces = bounces.length;
  const totalSpam = spam.length;
  const totalUnsubs = suppressions.filter(
    (s) => s.reason === 'unsubscribed',
  ).length;

  const openRate = totalSent > 0 ? (totalOpens / totalSent) * 100 : 0;
  const bounceRate = totalSent > 0 ? (totalBounces / totalSent) * 100 : 0;
  const spamRate = totalSent > 0 ? (totalSpam / totalSent) * 100 : 0;
  const unsubRate = totalSent > 0 ? (totalUnsubs / totalSent) * 100 : 0;

  // Count by sender profile
  const byProfile = {};
  for (const d of deliveries) {
    const p = d.sentVia || d.profile || 'unknown';
    byProfile[p] = (byProfile[p] || 0) + 1;
  }

  // Find best day
  const dayCount = {};
  for (const d of deliveries) {
    const day = new Date(d.deliveredAt).toLocaleDateString('en-US', { weekday: 'long' });
    dayCount[day] = (dayCount[day] || 0) + 1;
  }
  const bestDay = Object.entries(dayCount).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A';

  const weekStart = new Date(weekAgo).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  });
  const weekEnd = new Date(now).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  });

  const subject = `📊 Weekly Email Report — ${DOMAIN} (${weekStart})`;

  const html = `
<div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
  <h1 style="background: #2c3e50; color: #fff; padding: 20px; margin: 0; border-radius: 8px 8px 0 0;">
    📊 Weekly Email Report
  </h1>
  <div style="background: #ecf0f1; padding: 12px 20px; font-size: 14px;">
    <strong>${DOMAIN}</strong> &mdash; Week of ${weekStart} to ${weekEnd}
  </div>

  <div style="padding: 20px; background: #fff; border: 1px solid #ddd;">

    <!-- Opens -->
    <h2 style="border-bottom: 2px solid #3498db; padding-bottom: 8px;">📧 Opens</h2>
    <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
      <tr><td>Emails sent this week:</td><td style="text-align:right;"><strong>${totalSent}</strong></td></tr>
      <tr><td>Unique opens:</td><td style="text-align:right;"><strong>${totalOpens}</strong> (${openRate.toFixed(1)}% — ${gradeOpen(openRate)})</td></tr>
      <tr><td>Best day to send:</td><td style="text-align:right;">${bestDay}</td></tr>
    </table>

    <!-- Bounces -->
    <h2 style="border-bottom: 2px solid #e67e22; padding-bottom: 8px;">⚠️ Bounces</h2>
    <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
      <tr><td>Total bounces:</td><td style="text-align:right;"><strong>${totalBounces}</strong> (${bounceRate.toFixed(1)}% — ${grade(bounceRate, 2, 5)})</td></tr>
      <tr><td>Hard bounces:</td><td style="text-align:right;">${hardBounces} → Added to DNC</td></tr>
      <tr><td>Soft bounces:</td><td style="text-align:right;">${softBounces} → Will retry</td></tr>
    </table>

    <!-- Spam -->
    <h2 style="border-bottom: 2px solid #e74c3c; padding-bottom: 8px;">🚫 Spam Complaints</h2>
    <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
      <tr><td>Spam complaints:</td><td style="text-align:right;"><strong>${totalSpam}</strong> (${spamRate.toFixed(3)}% — ${grade(spamRate, 0.05, 0.1)})</td></tr>
    </table>

    <!-- Unsubscribes -->
    <h2 style="border-bottom: 2px solid #9b59b6; padding-bottom: 8px;">🙋 Unsubscribes</h2>
    <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
      <tr><td>Unsubscribes:</td><td style="text-align:right;"><strong>${totalUnsubs}</strong> (${unsubRate.toFixed(1)}% — ${grade(unsubRate, 0.5, 1)})</td></tr>
      <tr><td>Now on suppression list:</td><td style="text-align:right;">${totalUnsubs} → Will never contact again</td></tr>
    </table>

    <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;" />

    <!-- Breakdown by sender -->
    <h3>Sent by channel:</h3>
    <ul>
      ${Object.entries(byProfile)
        .map(([name, count]) => `<li><strong>${name}</strong>: ${count} emails</li>`)
        .join('\n      ')}
    </ul>

  </div>

  <div style="background: #2c3e50; color: #95a5a6; padding: 12px 20px; font-size: 12px; border-radius: 0 0 8px 8px; text-align: center;">
    Generated automatically by gmail-bulk-sending • ${new Date().toISOString()}
  </div>
</div>`;

  const text = `
Weekly Email Report — ${DOMAIN}
Week of ${weekStart} to ${weekEnd}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📧 OPENS
   Emails sent:       ${totalSent}
   Opens:             ${totalOpens} (${openRate.toFixed(1)}% — ${gradeOpen(openRate)})
   Best day:          ${bestDay}

⚠️  BOUNCES
   Total:             ${totalBounces} (${bounceRate.toFixed(1)}% — ${grade(bounceRate, 2, 5)})
   Hard bounces:      ${hardBounces} → DNC
   Soft bounces:      ${softBounces} → Retry

🚫 SPAM COMPLAINTS
   Complaints:        ${totalSpam} (${spamRate.toFixed(3)}% — ${grade(spamRate, 0.05, 0.1)})

🙋 UNSUBSCRIBES
   Unsubscribes:      ${totalUnsubs} (${unsubRate.toFixed(1)}% — ${grade(unsubRate, 0.5, 1)})

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${Object.entries(byProfile).map(([name, count]) => `${name}: ${count} emails`).join('\n')}
`;

  return { subject, html, text, stats: { totalSent, openRate, bounceRate, spamRate, unsubRate } };
}

async function sendReport() {
  const report = await generateReport();

  console.log('[report] Weekly stats:');
  console.log(`  Sent: ${report.stats.totalSent}`);
  console.log(`  Open rate: ${report.stats.openRate.toFixed(1)}%`);
  console.log(`  Bounce rate: ${report.stats.bounceRate.toFixed(1)}%`);
  console.log(`  Spam rate: ${report.stats.spamRate.toFixed(3)}%`);
  console.log(`  Unsub rate: ${report.stats.unsubRate.toFixed(1)}%`);

  await sendEmail({
    to: REPORT_RECIPIENT,
    subject: report.subject,
    text: report.text,
    html: report.html,
    profile: 'director',
  });

  console.log(`[report] Report sent to ${REPORT_RECIPIENT}`);
}

if (require.main === module) {
  initFirebase();
  sendReport()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[report] Fatal:', err);
      process.exit(1);
    });
}

module.exports = { generateReport, sendReport };
