'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY;

function getCheckRun() {
  const hour = new Date().getHours();
  if (hour < 11) return 'morning';
  if (hour < 15) return 'afternoon';
  return 'evening';
}

function todayISO() {
  return new Date().toISOString().split('T')[0];
}

async function saveEmailToSupabase(email, classification, draftReplyText) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.warn('⚠️  Supabase env vars missing — skipping DB save');
    return false;
  }

  const fromName = email.from.replace(/<.*>/, '').trim() || null;
  const fromEmail = (email.from.match(/<(.+)>/) || [null, email.from])[1];

  const row = {
    from_name: fromName,
    from_email: fromEmail,
    subject: email.subject,
    body_preview: email.body.slice(0, 300),
    body_full: email.body.slice(0, 4000),
    category: classification.category,
    urgency: classification.urgency,
    draft_reply: draftReplyText,
    status: 'pending',
    check_date: todayISO(),
    check_run: getCheckRun(),
    thread_id: email.threadId || null,
    message_id: email.messageId || null,
  };

  const res = await fetch(`${SUPABASE_URL}/rest/v1/email_inbox`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify(row),
  });

  if (!res.ok) {
    const text = await res.text();
    console.warn(`⚠️  Supabase insert failed: ${res.status} ${text}`);
    return false;
  }

  return true;
}

module.exports = { saveEmailToSupabase };
