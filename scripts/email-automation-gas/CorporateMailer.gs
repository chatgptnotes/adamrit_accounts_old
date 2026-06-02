// ═══════════════════════════════════════════════════════════════════════════════
// CORPORATE EMAIL AUTOMATION — Hope Hospital
// Uses Gmail directly via Google Apps Script — NO external API key needed.
//
// HOW TO SET UP (one time, 5 minutes):
// ─────────────────────────────────────
// 1. Go to https://script.google.com → Open existing project (or create new)
// 2. Copy-paste this file into the project (File → New → Script file → CorporateMailer)
// 3. Update SUPABASE_URL and SUPABASE_ANON_KEY below with your actual values
// 4. Update FROM_NAME and REPLY_TO with the hospital email
// 5. Click Run → sendMonthlyCorporateSummary once to test (check Execution Log)
// 6. Authorize Gmail permissions when prompted
//
// HOW TO SCHEDULE (automatic sending):
// ──────────────────────────────────────
// Triggers → + Add Trigger:
//   Function: sendMonthlyCorporateSummary
//   Event: Time-driven → Month timer → Day 1 of month → 9:00–10:00 AM
//
//   Function: sendWeeklyPaymentReminder
//   Event: Time-driven → Week timer → Every Friday → 10:00–11:00 AM
//
// WHAT IT DOES:
// ─────────────
// • Fetches corporate company list live from your Supabase database
// • Sends a professional HTML email to each company that has an email on file
// • Monthly: Billing Summary email on 1st of every month
// • Weekly:  Payment Reminder email every Friday
// • Logs results to Execution Logs (View → Executions)
// ═══════════════════════════════════════════════════════════════════════════════

// ── CONFIG — update these values ─────────────────────────────────────────────
var SUPABASE_URL      = 'https://xvkxccqaopbnkvwgyfjv.supabase.co';
var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh2a3hjY3Fhb3Bibmt2d2d5Zmp2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDc4MjMwMTIsImV4cCI6MjA2MzM5OTAxMn0.z9UkKHDm4RPMs_2IIzEPEYzd3-sbQSF6XpxaQg3vZhU';
var FROM_NAME         = 'Hope Hospital – Billing Team';
var REPLY_TO          = 'billing@hopehospital.com';
var HOSPITAL_NAME     = 'Hope Hospital';

// ── SCHEDULED ENTRY POINTS ───────────────────────────────────────────────────
// Attach these to Time-driven triggers in the GAS editor.

function sendMonthlyCorporateSummary() {
  var month = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'MMMM yyyy');
  Logger.log('=== Monthly Billing Summary → ' + month + ' ===');
  sendCorporateEmails_('billing_summary', month);
}

function sendWeeklyPaymentReminder() {
  Logger.log('=== Weekly Payment Reminder ===');
  sendCorporateEmails_('payment_reminder', null);
}

// Manual test — run this once to verify everything works before setting up triggers
function testSendToFirst() {
  var corps = fetchCorporatesFromSupabase_();
  if (!corps.length) { Logger.log('No corporates found.'); return; }
  var corp = corps[0];
  if (!corp.email) { Logger.log('First corporate has no email: ' + corp.name); return; }
  var month = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'MMMM yyyy');
  GmailApp.sendEmail(corp.email, 'TEST: Billing Summary – ' + month, '', {
    htmlBody: buildBillingSummaryHtml_(corp, month),
    name: FROM_NAME,
    replyTo: REPLY_TO,
  });
  Logger.log('Test email sent to ' + corp.name + ' <' + corp.email + '>');
}

// ── MAIN SEND PIPELINE ───────────────────────────────────────────────────────

function sendCorporateEmails_(type, month) {
  var corporates = fetchCorporatesFromSupabase_();

  if (!corporates || corporates.length === 0) {
    Logger.log('ERROR: No corporates found in Supabase. Check SUPABASE_URL and SUPABASE_ANON_KEY.');
    return;
  }

  var sent = 0, skipped = 0, failed = 0;

  for (var i = 0; i < corporates.length; i++) {
    var corp = corporates[i];

    if (!corp.email) {
      Logger.log('SKIP  ' + corp.name + ' — no email on file');
      skipped++;
      continue;
    }

    var subject = '';
    var htmlBody = '';

    if (type === 'billing_summary') {
      subject  = 'Monthly Billing Summary – ' + month + ' | ' + HOSPITAL_NAME;
      htmlBody = buildBillingSummaryHtml_(corp, month);
    } else {
      subject  = 'Payment Reminder – Outstanding Dues | ' + corp.name;
      htmlBody = buildPaymentReminderHtml_(corp);
    }

    try {
      GmailApp.sendEmail(corp.email, subject, stripHtml_(htmlBody), {
        htmlBody: htmlBody,
        name: FROM_NAME,
        replyTo: REPLY_TO,
      });
      sent++;
      Logger.log('SENT  ' + corp.name + ' <' + corp.email + '>');
    } catch (e) {
      failed++;
      Logger.log('FAIL  ' + corp.name + ' — ' + e.message);
    }

    // Small delay to avoid Gmail rate limits
    Utilities.sleep(500);
  }

  Logger.log('');
  Logger.log('══════════════════════════════════════════');
  Logger.log('  Type    : ' + type);
  Logger.log('  Total   : ' + corporates.length);
  Logger.log('  Sent    : ' + sent);
  Logger.log('  Skipped : ' + skipped + ' (no email)');
  Logger.log('  Failed  : ' + failed);
  Logger.log('══════════════════════════════════════════');
}

// ── SUPABASE FETCH ────────────────────────────────────────────────────────────
// Reads corporate list from your Supabase database.
// Uses the public anon key — same as the frontend app uses.

function fetchCorporatesFromSupabase_() {
  var url = SUPABASE_URL + '/rest/v1/corporate?select=id,name,email,contact_person,phone&order=name.asc';

  try {
    var response = UrlFetchApp.fetch(url, {
      method: 'GET',
      headers: {
        'apikey':        SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
        'Content-Type':  'application/json',
      },
      muteHttpExceptions: true,
    });

    var code = response.getResponseCode();
    if (code !== 200) {
      Logger.log('Supabase returned HTTP ' + code + ': ' + response.getContentText());
      return [];
    }

    var data = JSON.parse(response.getContentText());
    Logger.log('Fetched ' + data.length + ' corporates from Supabase.');
    return data;

  } catch (e) {
    Logger.log('Failed to fetch from Supabase: ' + e.message);
    return [];
  }
}

// ── HTML EMAIL TEMPLATES ──────────────────────────────────────────────────────

function buildBillingSummaryHtml_(corp, month) {
  var contact = corp.contact_person || corp.name;
  return '' +
    '<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;padding:0;background:#ffffff">' +
    // Header
    '<div style="background:#1d4ed8;padding:28px 32px">' +
    '  <h1 style="color:white;margin:0;font-size:22px;font-weight:700">' + HOSPITAL_NAME + '</h1>' +
    '  <p style="color:#bfdbfe;margin:6px 0 0;font-size:13px">Corporate Billing Department</p>' +
    '</div>' +
    // Body
    '<div style="padding:32px;background:#f8fafc">' +
    '  <p style="margin:0 0 16px;color:#374151;font-size:15px">Dear <strong>' + contact + '</strong>,</p>' +
    '  <p style="color:#374151;font-size:14px;line-height:1.6">' +
    '    Please find below the billing summary for <strong>' + corp.name + '</strong> for the month of <strong>' + month + '</strong>.' +
    '  </p>' +
    // Summary box
    '  <div style="background:white;border:1px solid #e5e7eb;border-radius:10px;padding:24px;margin:24px 0">' +
    '    <p style="margin:0 0 12px;font-weight:700;color:#111827;font-size:15px">📋 Billing Summary — ' + month + '</p>' +
    '    <table style="width:100%;border-collapse:collapse;font-size:14px">' +
    '      <tr style="background:#f9fafb">' +
    '        <td style="padding:10px 12px;color:#6b7280;border-bottom:1px solid #f3f4f6">Corporate</td>' +
    '        <td style="padding:10px 12px;font-weight:600;color:#111827;border-bottom:1px solid #f3f4f6;text-align:right">' + corp.name + '</td>' +
    '      </tr>' +
    '      <tr>' +
    '        <td style="padding:10px 12px;color:#6b7280;border-bottom:1px solid #f3f4f6">Month</td>' +
    '        <td style="padding:10px 12px;font-weight:600;color:#111827;border-bottom:1px solid #f3f4f6;text-align:right">' + month + '</td>' +
    '      </tr>' +
    '      <tr style="background:#eff6ff">' +
    '        <td style="padding:10px 12px;color:#1d4ed8;font-weight:700">Status</td>' +
    '        <td style="padding:10px 12px;color:#1d4ed8;font-weight:700;text-align:right">Please refer attached statement</td>' +
    '      </tr>' +
    '    </table>' +
    '  </div>' +
    '  <p style="color:#374151;font-size:14px;line-height:1.6">' +
    '    Kindly review and share with your HR / Accounts team. For any queries, please contact our billing desk.' +
    '  </p>' +
    '  <p style="margin-top:28px;color:#374151;font-size:14px">Warm regards,<br>' +
    '    <strong>' + HOSPITAL_NAME + ' – Corporate Billing Team</strong><br>' +
    '    <span style="color:#6b7280">' + REPLY_TO + '</span>' +
    '  </p>' +
    '</div>' +
    // Footer
    '<div style="background:#f3f4f6;padding:16px 32px;text-align:center;border-top:1px solid #e5e7eb">' +
    '  <p style="color:#9ca3af;font-size:11px;margin:0">This is an automated email from ' + HOSPITAL_NAME + '.</p>' +
    '</div>' +
    '</div>';
}

function buildPaymentReminderHtml_(corp) {
  var contact = corp.contact_person || corp.name;
  var today = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd MMMM yyyy');
  return '' +
    '<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;padding:0;background:#ffffff">' +
    // Header
    '<div style="background:#dc2626;padding:28px 32px">' +
    '  <h1 style="color:white;margin:0;font-size:22px;font-weight:700">' + HOSPITAL_NAME + '</h1>' +
    '  <p style="color:#fecaca;margin:6px 0 0;font-size:13px">Payment Reminder — ' + today + '</p>' +
    '</div>' +
    // Body
    '<div style="padding:32px;background:#f8fafc">' +
    '  <p style="margin:0 0 16px;color:#374151;font-size:15px">Dear <strong>' + contact + '</strong>,</p>' +
    '  <p style="color:#374151;font-size:14px;line-height:1.6">' +
    '    This is a gentle reminder regarding <strong>outstanding dues</strong> for <strong>' + corp.name + '</strong> with ' + HOSPITAL_NAME + '.' +
    '  </p>' +
    // Alert box
    '  <div style="background:#fff7f7;border:2px solid #fecaca;border-radius:10px;padding:20px;margin:24px 0">' +
    '    <p style="margin:0;color:#dc2626;font-weight:700;font-size:15px">⚠️ Action Required</p>' +
    '    <p style="margin:8px 0 0;color:#374151;font-size:14px">' +
    '      Kindly arrange payment of outstanding dues at the earliest to avoid any disruption in empanelled medical services.' +
    '    </p>' +
    '  </div>' +
    '  <p style="color:#374151;font-size:14px;line-height:1.6">' +
    '    Please contact our accounts team for the detailed statement or to arrange payment.' +
    '  </p>' +
    '  <p style="margin-top:28px;color:#374151;font-size:14px">Regards,<br>' +
    '    <strong>' + HOSPITAL_NAME + ' – Accounts Team</strong><br>' +
    '    <span style="color:#6b7280">' + REPLY_TO + '</span>' +
    '  </p>' +
    '</div>' +
    '<div style="background:#f3f4f6;padding:16px 32px;text-align:center;border-top:1px solid #e5e7eb">' +
    '  <p style="color:#9ca3af;font-size:11px;margin:0">This is an automated reminder from ' + HOSPITAL_NAME + '.</p>' +
    '</div>' +
    '</div>';
}

// ── HELPERS ───────────────────────────────────────────────────────────────────

function stripHtml_(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
