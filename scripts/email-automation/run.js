'use strict';

const path = require('path');
const fs = require('fs');

// Load .env from project root (run this script from adamrit/ directory)
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const { getUnreadEmails, applyLabel, createDraft } = require('./gmail-client');
const { classifyEmail, draftReply } = require('./ai-processor');

const LAST_RUN_FILE = path.join(__dirname, 'last-run.json');

function readLastRunTimestamp() {
  try {
    const data = JSON.parse(fs.readFileSync(LAST_RUN_FILE, 'utf-8'));
    return data.lastRunAt ? new Date(data.lastRunAt).getTime() : null;
  } catch {
    return null;
  }
}

function writeLastRunTimestamp() {
  fs.writeFileSync(LAST_RUN_FILE, JSON.stringify({ lastRunAt: new Date().toISOString() }, null, 2));
}

function printSummary(results) {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  HOPE HOSPITAL — EMAIL DIGEST');
  console.log(`  Run time: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`);
  console.log('═══════════════════════════════════════════════════════');

  if (results.length === 0) {
    console.log('  ✅ No new emails — inbox clear.');
    console.log('═══════════════════════════════════════════════════════\n');
    return;
  }

  console.log(`  ${results.length} email(s) processed:\n`);
  console.log('  From                     Category          Urgency  Draft');
  console.log('  ─────────────────────────────────────────────────────────');

  for (const r of results) {
    const from = r.from.replace(/<.*>/, '').trim().slice(0, 24).padEnd(24);
    const category = r.category.padEnd(17);
    const urgency = r.urgency.padEnd(8);
    const draftStatus = r.draftCreated ? '✓' : '✗ failed';
    console.log(`  ${from} ${category} ${urgency} ${draftStatus}`);
  }

  const high = results.filter(r => r.urgency === 'high').length;
  if (high > 0) {
    console.log(`\n  ⚠️  ${high} high-urgency email(s) — check Gmail Drafts first.`);
  }

  console.log('\n  👉 Open Gmail Drafts → review → click Send when ready.');
  console.log('═══════════════════════════════════════════════════════\n');
}

async function main() {
  console.log('🔍 Hope Hospital Email Automation — starting run...');

  // Validate env
  const required = ['GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN', 'GMAIL_USER_EMAIL', 'ANTHROPIC_API_KEY'];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length > 0) {
    console.error(`❌ Missing env vars: ${missing.join(', ')}`);
    console.error('   Copy .env.example values into adamrit/.env and run setup-oauth.js first.');
    process.exit(1);
  }

  const sinceTimestamp = readLastRunTimestamp();
  if (sinceTimestamp) {
    console.log(`📅 Fetching emails since ${new Date(sinceTimestamp).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`);
  } else {
    console.log('📅 First run — fetching all unread emails in inbox');
  }

  const emails = await getUnreadEmails(sinceTimestamp, 20);
  console.log(`📬 Found ${emails.length} unread email(s)`);

  if (emails.length === 0) {
    writeLastRunTimestamp();
    printSummary([]);
    return;
  }

  const results = [];

  for (const email of emails) {
    process.stdout.write(`  ↳ Processing: "${email.subject.slice(0, 50)}" ... `);

    try {
      const classification = await classifyEmail(email.subject, email.body);
      const replyText = await draftReply(email, classification);

      await applyLabel(email.id, `HH/${classification.category}`);
      await createDraft(email, replyText);

      process.stdout.write(`✓ [${classification.category}]\n`);

      results.push({
        from: email.from,
        subject: email.subject,
        category: classification.category,
        urgency: classification.urgency,
        summary: classification.summary,
        draftCreated: true
      });
    } catch (err) {
      process.stdout.write(`✗ error: ${err.message}\n`);
      results.push({
        from: email.from,
        subject: email.subject,
        category: 'error',
        urgency: 'low',
        summary: err.message,
        draftCreated: false
      });
    }
  }

  writeLastRunTimestamp();
  printSummary(results);
}

main().catch((err) => {
  console.error('❌ Fatal error:', err.message);
  process.exit(1);
});
