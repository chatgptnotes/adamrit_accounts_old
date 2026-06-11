// One-time backfill: import ALL incoming Gmail (last 60 days) into email_inbox.
// Mirrors useGmailChecker.checkMail but never creates Gmail drafts — backfilling
// history must not spam the Drafts folder. Safe to re-run (dedup by gmail id).
require('dotenv').config();

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1';
const SB = process.env.VITE_SUPABASE_URL;
const SB_KEY = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

async function getToken() {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.VITE_GMAIL_CLIENT_ID,
      client_secret: process.env.VITE_GMAIL_CLIENT_SECRET,
      refresh_token: process.env.VITE_GMAIL_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('token exchange failed: ' + JSON.stringify(data));
  return data.access_token;
}

const getHeader = (headers, name) =>
  (headers.find((h) => h.name.toLowerCase() === name.toLowerCase()) || {}).value || '';

function decodeB64Url(data) {
  try { return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8'); }
  catch { return ''; }
}

function findMimePart(node, mime) {
  if (node.mimeType === mime && node.body && node.body.data) return decodeB64Url(node.body.data);
  for (const p of node.parts || []) {
    const found = findMimePart(p, mime);
    if (found) return found;
  }
  return '';
}

function extractTextBody(payload) {
  const plain = findMimePart(payload, 'text/plain');
  if (plain) return plain;
  const html = findMimePart(payload, 'text/html');
  if (html) return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return payload.body && payload.body.data ? decodeB64Url(payload.body.data) : '';
}

function classifyEmail(subject, body) {
  const text = (subject + ' ' + body).toLowerCase();
  let category = 'general';
  if (/tpa|third.party|insurance|claim|cashless|mediclaim|echs|cghs|esic/.test(text)) category = 'tpa';
  else if (/corporate|company|organization|tie.?up|empanelled/.test(text)) category = 'corporate';
  else if (/bill|invoice|payment|amount|dues|outstanding|receipt|discharge/.test(text)) category = 'billing';
  else if (/urgent|immediate|asap|emergency|critical/.test(text)) category = 'urgent';
  let urgency = 'low';
  if (/urgent|immediate|asap|emergency|critical|today/.test(text)) urgency = 'high';
  else if (/soon|reminder|follow.?up|pending|awaiting/.test(text)) urgency = 'medium';
  return { category, urgency };
}

function buildDraftReply(fromName, subject) {
  const name = fromName || 'Sir/Madam';
  return `Dear ${name},\n\nThank you for your email regarding "${subject}".\n\nWe have received your message and will respond within 1 business day.\n\nThank you for choosing Hope Hospital.\n\nWarm regards,\nHope Hospital Billing Team\ninfo@hopehospital.com`;
}

async function main() {
  const token = await getToken();
  const auth = { Authorization: 'Bearer ' + token };

  // Already-imported gmail ids (paged — PostgREST caps a single response)
  const known = new Set();
  for (let off = 0; ; off += 1000) {
    const r = await fetch(
      `${SB}/rest/v1/email_inbox?select=approved_by&approved_by=like.gmailid:*&limit=1000&offset=${off}`,
      { headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY } },
    );
    const rows = await r.json();
    if (!Array.isArray(rows) || rows.length === 0) break;
    rows.forEach((x) => known.add(x.approved_by));
    if (rows.length < 1000) break;
  }
  console.log('known imported ids:', known.size);

  // List all incoming mail ids (last 60 days)
  const q = encodeURIComponent('newer_than:60d -in:sent -in:draft -in:chats');
  const ids = [];
  let pageToken;
  do {
    const url = `${GMAIL_API}/users/me/messages?maxResults=100&q=${q}${pageToken ? '&pageToken=' + pageToken : ''}`;
    const d = await (await fetch(url, { headers: auth })).json();
    ids.push(...(d.messages || []).map((m) => m.id));
    pageToken = d.nextPageToken;
  } while (pageToken && ids.length < 5000);

  const newIds = ids.filter((id) => !known.has('gmailid:' + id));
  console.log(`gmail incoming (60d): ${ids.length}, new to import: ${newIds.length}`);

  const today = new Date().toISOString().split('T')[0];
  let saved = 0, failed = 0;

  const processOne = async (id) => {
    const r = await fetch(`${GMAIL_API}/users/me/messages/${id}?format=full`, { headers: auth });
    if (!r.ok) { failed++; return; }
    const msg = await r.json();
    const headers = (msg.payload && msg.payload.headers) || [];
    const subject = getHeader(headers, 'Subject') || '(no subject)';
    const fromHeader = getHeader(headers, 'From');
    const fromEmail = (fromHeader.match(/<([^>]+)>/) || [])[1] || fromHeader.trim();
    const fromName = ((fromHeader.match(/^([^<]+)/) || [])[1] || fromEmail).trim();
    const body = extractTextBody(msg.payload || {});
    const internalMs = Number(msg.internalDate);
    const receivedAt = Number.isFinite(internalMs) && internalMs > 0 ? new Date(internalMs).toISOString() : null;
    const { category, urgency } = classifyEmail(subject, body);

    const ins = await fetch(`${SB}/rest/v1/email_inbox`, {
      method: 'POST',
      headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({
        from_email: fromEmail,
        from_name: fromName,
        subject,
        body_preview: body,
        category,
        urgency,
        draft_reply: buildDraftReply(fromName, subject),
        status: 'pending',
        check_date: today,
        received_at: receivedAt,
        approved_by: 'gmailid:' + id,
      }),
    });
    if (ins.ok) saved++;
    else { failed++; console.log('insert failed', ins.status, (await ins.text()).slice(0, 150)); }
  };

  for (let i = 0; i < newIds.length; i += 10) {
    await Promise.all(newIds.slice(i, i + 10).map(processOne));
    if ((i / 10) % 5 === 0) console.log(`progress: ${Math.min(i + 10, newIds.length)}/${newIds.length}`);
  }
  console.log(`DONE — imported ${saved}, failed ${failed}, skipped ${ids.length - newIds.length} already present`);
}

main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
