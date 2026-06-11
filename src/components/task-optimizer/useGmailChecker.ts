import { useState } from 'react';
import { supabaseAdmin } from '@/integrations/supabase/adminClient';
import { geminiFetch, geminiGenerateContentUrl, GEMINI_MODEL, hasValidGeminiKey } from '@/lib/gemini';

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1';

export interface CheckMailResult {
  saved: number;
  skipped: number;
}

// A raw inbox message as shown in the "Get Mails" section — fetched read-only
// from Gmail (no classification, no Supabase write, no draft creation).
export interface InboxMail {
  id: string;
  fromName: string;
  fromEmail: string;
  subject: string;
  snippet: string;
  receivedAt: string | null;
  unread: boolean;
}

async function getGmailAccessToken(): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     import.meta.env.VITE_GMAIL_CLIENT_ID as string,
      client_secret: import.meta.env.VITE_GMAIL_CLIENT_SECRET as string,
      refresh_token: import.meta.env.VITE_GMAIL_REFRESH_TOKEN as string,
      grant_type:    'refresh_token',
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(data.error_description ?? 'Gmail token exchange failed');
  return data.access_token as string;
}

function decodeBase64Url(data: string): string {
  try {
    const binary = atob(data.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    return '';
  }
}

// Encode a UTF-8 string to base64url (for Gmail raw message)
function encodeToBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  bytes.forEach(b => { binary += String.fromCharCode(b); });
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function getHeader(headers: Array<{ name: string; value: string }>, name: string): string {
  return headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}

// Find the first body of a given MIME type anywhere in the (possibly nested)
// MIME tree. Real emails routinely nest text/plain inside multipart/alternative
// inside multipart/mixed, so this must recurse rather than scan one level —
// otherwise the body comes back empty.
function findMimePart(node: Record<string, unknown>, mime: string): string {
  if (node.mimeType === mime) {
    const b = node.body as { data?: string } | undefined;
    if (b?.data) return decodeBase64Url(b.data);
  }
  const parts = node.parts as Array<Record<string, unknown>> | undefined;
  if (parts) {
    for (const part of parts) {
      const found = findMimePart(part, mime);
      if (found) return found;
    }
  }
  return '';
}

function extractTextBody(payload: Record<string, unknown>): string {
  // Prefer text/plain anywhere in the tree; fall back to stripped text/html.
  const plain = findMimePart(payload, 'text/plain');
  if (plain) return plain;

  const html = findMimePart(payload, 'text/html');
  if (html) return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  // Last resort: a non-multipart message whose body sits directly on payload.
  const body = payload.body as { data?: string } | undefined;
  return body?.data ? decodeBase64Url(body.data) : '';
}

function classifyEmail(subject: string, body: string): { category: string; urgency: string } {
  const text = `${subject} ${body}`.toLowerCase();
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

type ReplyStyle = 'standard' | 'formal' | 'brief' | 'friendly';

const REPLY_STYLES: ReplyStyle[] = ['standard', 'formal', 'brief', 'friendly'];
const STYLE_LABELS: Record<ReplyStyle, string> = {
  standard: 'Standard',
  formal:   'Formal',
  brief:    'Brief',
  friendly: 'Friendly',
};

function buildDraftReply(fromName: string, subject: string, category: string, style: ReplyStyle = 'standard'): string {
  const name    = fromName || 'Sir/Madam';
  const closing = `\n\nWarm regards,\nHope Hospital Billing Team\ninfo@hopehospital.com`;

  if (style === 'brief') {
    return `Dear ${name},\n\nThank you for your email on "${subject}". We have received your query and will respond within 1 business day.${closing}`;
  }

  if (style === 'formal') {
    const formalBodies: Record<string, string> = {
      tpa:       `\n\nThis is to acknowledge receipt of your correspondence dated regarding the subject matter: "${subject}".\n\nYour TPA/insurance documentation request has been duly registered and forwarded to the concerned department. A formal response shall be provided within one working day.\n\nKindly quote this reference in all future correspondence.`,
      corporate: `\n\nThis is to acknowledge receipt of your email regarding "${subject}".\n\nYour query has been registered and assigned to the Corporate Billing Department for necessary action. You shall receive a formal response within one working day.`,
      billing:   `\n\nThis is to acknowledge receipt of your billing inquiry pertaining to "${subject}".\n\nYour account has been flagged for review by our Billing Department. A detailed response, along with the relevant documentation, shall be furnished within 24 working hours.`,
      urgent:    `\n\nThis is to acknowledge your urgent communication regarding "${subject}".\n\nThe matter has been escalated to the Billing Manager on priority. You may expect a response within the shortest possible time frame.`,
      general:   `\n\nThis is to acknowledge receipt of your communication regarding "${subject}".\n\nThe matter has been duly noted and shall be addressed within one working day.`,
    };
    return `Dear ${name},` + (formalBodies[category] ?? formalBodies.general) + closing;
  }

  if (style === 'friendly') {
    const friendlyBodies: Record<string, string> = {
      tpa:       `\n\nThank you so much for reaching out about "${subject}"! 😊\n\nWe've got your TPA/insurance query and our team is on it. We'll process the documents and come back to you by tomorrow. In the meantime, if you need anything urgently, please don't hesitate to call us directly.`,
      corporate: `\n\nGreat to hear from you regarding "${subject}"! 😊\n\nOur corporate billing team has noted your query and will reach out with all the details you need within a day. We really value your partnership with Hope Hospital.`,
      billing:   `\n\nThank you for writing to us about "${subject}"! 😊\n\nWe've received your billing query and our team will review your account right away. You'll hear back from us with full details within 24 hours. Please feel free to reach out if you have any other questions!`,
      urgent:    `\n\nThank you for flagging this — we completely understand the urgency regarding "${subject}".\n\nWe've immediately escalated this to our billing manager and someone will be in touch with you very shortly. We sincerely apologise for any inconvenience caused.`,
      general:   `\n\nThank you so much for your email about "${subject}"! 😊\n\nWe've received your message and will get back to you within 1 business day. We appreciate you reaching out to Hope Hospital!`,
    };
    return `Dear ${name},` + (friendlyBodies[category] ?? friendlyBodies.general) + closing;
  }

  // Standard style
  const bodies: Record<string, string> = {
    tpa:       `\n\nThank you for your email regarding "${subject}".\n\nWe have received your TPA/insurance query and our billing team is reviewing it. We will process the required documents and get back to you within 1 business day.\n\nIf you need immediate assistance, please call our billing helpdesk.`,
    corporate: `\n\nThank you for reaching out regarding "${subject}".\n\nWe have noted your query and our corporate billing team will follow up with you within 1 business day with the required information.\n\nPlease feel free to contact us if you need anything in the meantime.`,
    billing:   `\n\nThank you for your email regarding "${subject}".\n\nWe have received your billing query and will review your account. Our team will respond with the relevant details within 24 hours.\n\nFor urgent billing concerns, please contact our billing helpdesk directly.`,
    urgent:    `\n\nThank you for your email regarding "${subject}".\n\nWe understand this is an urgent matter and have escalated it to our billing manager for immediate attention. We will revert to you shortly.`,
    general:   `\n\nThank you for your email regarding "${subject}".\n\nWe have received your message and will respond within 1 business day.\n\nThank you for choosing Hope Hospital.`,
  };
  return `Dear ${name},` + (bodies[category] ?? bodies.general) + closing;
}

export { REPLY_STYLES, STYLE_LABELS };
export type { ReplyStyle };

// VPS sidecar that performs AI re-phrase/regenerate server-side, so no LLM key
// is bundled into the frontend. Configured via VITE_REPHRASE_SIDECAR_URL; when
// unset, the caller falls back to direct Gemini (if keyed) or local templates.
const SIDECAR_URL = import.meta.env.VITE_REPHRASE_SIDECAR_URL as string | undefined;
const SIDECAR_KEY = import.meta.env.VITE_REPHRASE_SIDECAR_KEY as string | undefined;

// POST a payload to the sidecar and return its `{ text }` reply. Throws on any
// non-2xx / empty response so callers can fall back to the local template.
async function sidecarCall(path: string, payload: unknown): Promise<string> {
  const res = await fetch(`${SIDECAR_URL!.replace(/\/$/, '')}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(SIDECAR_KEY ? { 'x-sidecar-key': SIDECAR_KEY } : {}),
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Sidecar ${path} error ${res.status}`);
  const data = await res.json();
  const text = (data?.text ?? '').trim();
  if (!text) throw new Error('Sidecar returned empty response');
  return text;
}

// Create a draft reply directly inside Gmail — appears in the Drafts folder
async function createGmailDraft(
  token: string,
  toEmail: string,
  subject: string,
  replyBody: string,
  threadId: string,
  messageId: string,
): Promise<void> {
  const replySubject = /^re:/i.test(subject) ? subject : `Re: ${subject}`;

  const raw = [
    `From: Hope Hospital Billing <${import.meta.env.VITE_GMAIL_USER_EMAIL ?? 'info@hopehospital.com'}>`,
    `To: ${toEmail}`,
    `Subject: ${replySubject}`,
    messageId ? `In-Reply-To: ${messageId}` : '',
    messageId ? `References: ${messageId}` : '',
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=UTF-8`,
    ``,
    replyBody,
  ].filter(Boolean).join('\r\n');

  await fetch(`${GMAIL_API}/users/me/drafts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        raw: encodeToBase64Url(raw),
        threadId: threadId || undefined,
      },
    }),
  });
}

export function useGmailChecker() {
  const [cachedToken, setCachedToken] = useState<string | null>(null);

  const getToken = async (): Promise<string> => {
    if (cachedToken) return cachedToken;
    const token = await getGmailAccessToken();
    setCachedToken(token);
    setTimeout(() => setCachedToken(null), 55 * 60 * 1000);
    return token;
  };

  // Read-only inbox fetch for the "Get Mails" section. Uses format=metadata
  // (headers + snippet only) so 25 mails load in one parallel burst instead of
  // 25 sequential full-body downloads. Covers ALL incoming mail (including
  // auto-archived / tab-categorized), excluding only sent, drafts and chats.
  const fetchInbox = async (max = 25): Promise<InboxMail[]> => {
    const token = await getToken();

    const listRes = await fetch(
      `${GMAIL_API}/users/me/messages?maxResults=${max}&q=${encodeURIComponent('-in:sent -in:draft -in:chats')}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!listRes.ok) {
      if (listRes.status === 401) setCachedToken(null);
      throw new Error(`Gmail fetch failed (${listRes.status})`);
    }
    const listData = await listRes.json();
    const messages: Array<{ id: string }> = listData.messages ?? [];

    const mails = await Promise.all(messages.map(async (msg): Promise<InboxMail | null> => {
      const res = await fetch(
        `${GMAIL_API}/users/me/messages/${msg.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) return null;
      const d = await res.json();

      const headers: Array<{ name: string; value: string }> =
        (d.payload as Record<string, unknown>)?.headers as Array<{ name: string; value: string }> ?? [];
      const fromHeader = getHeader(headers, 'From');
      const fromEmail  = fromHeader.match(/<([^>]+)>/)?.[1] ?? fromHeader.trim();
      const fromName   = fromHeader.match(/^([^<]+)/)?.[1]?.trim().replace(/^"|"$/g, '') ?? fromEmail;

      const internalMs = Number(d.internalDate);
      const hdrDate    = getHeader(headers, 'Date');
      let receivedAt: string | null = null;
      if (Number.isFinite(internalMs) && internalMs > 0) {
        receivedAt = new Date(internalMs).toISOString();
      } else if (hdrDate) {
        const parsed = new Date(hdrDate);
        if (!isNaN(parsed.getTime())) receivedAt = parsed.toISOString();
      }

      return {
        id: msg.id,
        fromName,
        fromEmail,
        subject: getHeader(headers, 'Subject') || '(no subject)',
        snippet: (d.snippet ?? '') as string,
        receivedAt,
        unread: ((d.labelIds ?? []) as string[]).includes('UNREAD'),
      };
    }));

    return (mails.filter(Boolean) as InboxMail[]).sort(
      (a, b) => new Date(b.receivedAt ?? 0).getTime() - new Date(a.receivedAt ?? 0).getTime(),
    );
  };

  const checkMail = async (
    onProgress?: (done: number, total: number) => void,
  ): Promise<CheckMailResult> => {
    const token = await getToken();

    // Preload every already-imported gmail ID in one query (instead of one
    // Supabase round-trip per message) so known mails are skipped without even
    // fetching them from Gmail.
    const { data: knownRows } = await supabaseAdmin
      .from('email_inbox')
      .select('approved_by')
      .like('approved_by', 'gmailid:%');
    const knownIds = new Set((knownRows ?? []).map(r => r.approved_by as string));

    // Incremental check: only ask Gmail for mail received AFTER the newest
    // mail already imported — but always re-scan at least the last 3 days
    // (knownIds dedup makes the overlap cheap) so a row with a skewed
    // received_at can never make the checker skip genuinely new mail. On a
    // fresh table (nothing imported yet) start from the last 7 days.
    const { data: newestRows } = await supabaseAdmin
      .from('email_inbox')
      .select('received_at')
      .not('received_at', 'is', null)
      .order('received_at', { ascending: false })
      .limit(1);
    const newestMs = newestRows?.[0]?.received_at ? new Date(newestRows[0].received_at).getTime() : NaN;
    const sinceMs = Math.min(
      Number.isFinite(newestMs) ? newestMs - 60 * 60 * 1000 : Date.now() - 7 * 24 * 60 * 60 * 1000,
      Date.now() - 3 * 24 * 60 * 60 * 1000,
    );

    // ALL incoming mail — not just the INBOX label. Mail that filters/scripts
    // auto-archive or tab-categorize (Updates, Promotions, HH/* labels) has no
    // INBOX label but must still be imported. SENT and DRAFT are excluded in
    // the query itself (without this, the drafts this very function creates
    // would be listed and "replied" to — a self-reply feedback loop); spam and
    // trash are excluded by the API by default. Hard cap as a runaway guard.
    const afterQuery = encodeURIComponent(
      `after:${Math.floor(sinceMs / 1000)} -in:sent -in:draft -in:chats`,
    );
    const MAX_TOTAL = 2000;
    const allIds: string[] = [];
    let pageToken: string | undefined;
    do {
      const listRes = await fetch(
        `${GMAIL_API}/users/me/messages?maxResults=100&q=${afterQuery}${pageToken ? `&pageToken=${pageToken}` : ''}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!listRes.ok) {
        if (listRes.status === 401) setCachedToken(null);
        throw new Error(`Gmail fetch failed (${listRes.status})`);
      }
      const listData = await listRes.json();
      allIds.push(...((listData.messages ?? []) as Array<{ id: string }>).map(m => m.id));
      pageToken = listData.nextPageToken as string | undefined;
    } while (pageToken && allIds.length < MAX_TOTAL);

    const newIds = allIds.filter(id => !knownIds.has(`gmailid:${id}`));
    let skipped = allIds.length - newIds.length;
    let saved = 0;
    let done = 0;
    onProgress?.(0, newIds.length);

    const today = new Date().toISOString().split('T')[0];
    // Only mails received in the last 7 days get a reply draft created in the
    // Gmail Drafts folder — bulk-importing the inbox history must not flood
    // Drafts with replies to months-old mail. (The in-app draft_reply text is
    // still generated for every mail.)
    const draftCutoffMs = Date.now() - 7 * 24 * 60 * 60 * 1000;

    const processOne = async (gmailMsgId: string): Promise<void> => {
      const msgRes = await fetch(
        `${GMAIL_API}/users/me/messages/${gmailMsgId}?format=full`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!msgRes.ok) { skipped++; return; }
      const msgData = await msgRes.json();

      const headers: Array<{ name: string; value: string }> =
        (msgData.payload as Record<string, unknown>)?.headers as Array<{ name: string; value: string }> ?? [];

      const subject    = getHeader(headers, 'Subject') || '(no subject)';
      const fromHeader = getHeader(headers, 'From');
      const fromEmail  = fromHeader.match(/<([^>]+)>/)?.[1] ?? fromHeader.trim();
      const fromName   = fromHeader.match(/^([^<]+)/)?.[1]?.trim() ?? fromEmail;
      const messageId  = getHeader(headers, 'Message-ID');
      const threadId   = (msgData as Record<string, unknown>).threadId as string ?? '';
      const body       = extractTextBody(msgData.payload as Record<string, unknown>);

      // Real received date/time of the email — prefer Gmail's internalDate
      // (epoch ms), fall back to the RFC-2822 `Date` header. Saved to
      // received_at so the inbox can show and group emails date-wise.
      const internalMs = Number((msgData as Record<string, unknown>).internalDate);
      const hdrDate    = getHeader(headers, 'Date');
      let receivedAt: string | null = null;
      if (Number.isFinite(internalMs) && internalMs > 0) {
        receivedAt = new Date(internalMs).toISOString();
      } else if (hdrDate) {
        const d = new Date(hdrDate);
        if (!isNaN(d.getTime())) receivedAt = d.toISOString();
      }

      const { category, urgency } = classifyEmail(subject, body);
      const draftReply = buildDraftReply(fromName, subject, category);

      // 1. Save to Supabase FIRST (approved_by stores the gmail message ID for
      //    permanent dedup). Doing this before any Gmail side effect means a
      //    failure here can't leave an orphan draft that the next run would
      //    duplicate — we just skip and retry cleanly.
      const { error: insertError } = await supabaseAdmin.from('email_inbox').insert({
        from_email:   fromEmail,
        from_name:    fromName,
        subject,
        body_preview: body, // full body — TEXT column has no size limit
        category,
        urgency,
        draft_reply:  draftReply,
        status:       'pending',
        check_date:   today,
        received_at:  receivedAt,
        approved_by:  `gmailid:${gmailMsgId}`,
      });

      if (insertError) {
        console.warn('email_inbox insert failed:', insertError.message, insertError.code);
        return; // do not create a Gmail draft we can't track; retry next run
      }

      // 2. Create the draft reply in Gmail Drafts — recent mail only (see
      //    draftCutoffMs above). Best-effort: the row above is the source of
      //    truth, so a draft failure must not abort the whole mail check.
      const receivedMs = receivedAt ? new Date(receivedAt).getTime() : Date.now();
      if (receivedMs >= draftCutoffMs) {
        try {
          await createGmailDraft(token, fromEmail, subject, draftReply, threadId, messageId);
        } catch (e) {
          console.warn('Gmail draft creation failed (email already saved):', e);
        }
      }

      saved++;
    };

    // Process in parallel chunks of 10 so a large inbox imports in seconds,
    // not minutes, without hammering the Gmail API.
    const CHUNK = 10;
    for (let i = 0; i < newIds.length; i += CHUNK) {
      await Promise.all(newIds.slice(i, i + CHUNK).map(processOne));
      done = Math.min(i + CHUNK, newIds.length);
      onProgress?.(done, newIds.length);
    }

    return { saved, skipped };
  };

  const regenerateDraft = async (emailId: string, feedback?: string): Promise<string> => {
    const { data: email } = await supabaseAdmin
      .from('email_inbox')
      .select('from_name, from_email, subject, category, body_preview, draft_reply')
      .eq('id', emailId)
      .single();

    if (!email) throw new Error('Email not found');

    const baseDraft = buildDraftReply(
      email.from_name ?? email.from_email,
      email.subject ?? '',
      email.category ?? 'general',
    );
    const templateFallback = feedback?.trim() ? `[Note: ${feedback.trim()}]\n\n${baseDraft}` : baseDraft;

    // Preferred path: VPS sidecar holds the LLM key and regenerates server-side.
    if (SIDECAR_URL) {
      try {
        const text = await sidecarCall('/regenerate', {
          fromName: email.from_name ?? email.from_email,
          subject: email.subject ?? '',
          category: email.category ?? 'general',
          body: email.body_preview ?? '',
          previousDraft: email.draft_reply ?? baseDraft,
          feedback: feedback?.trim() ?? '',
        });
        await supabaseAdmin.from('email_inbox').update({ draft_reply: text }).eq('id', emailId);
        return text;
      } catch (e) {
        console.warn('Sidecar regenerate failed, falling back:', e);
        // fall through to direct Gemini / local template below
      }
    }

    const apiKey = import.meta.env.VITE_GEMINI_API_KEY as string | undefined;

    // No valid Gemini key configured — fall back to the deterministic template.
    if (!hasValidGeminiKey(apiKey)) {
      await supabaseAdmin.from('email_inbox').update({ draft_reply: templateFallback }).eq('id', emailId);
      return templateFallback;
    }

    const url = geminiGenerateContentUrl(apiKey, GEMINI_MODEL);
    const res = await geminiFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `You are a professional email assistant for Hope Hospital Billing Department.
Write a fresh reply to the email below. Keep it professional, on-topic and concise.
${feedback?.trim()
  ? `Apply this instruction from the staff member: ${feedback.trim()}`
  : 'Use different wording from the previous draft while keeping the same meaning and intent.'}
Always end with this exact sign-off:
Warm regards,
Hope Hospital Billing Team
info@hopehospital.com

Return ONLY the reply text — no subject line, no explanations, no extra commentary.

Email subject: ${email.subject}
From: ${email.from_name ?? email.from_email}
Email body:
${email.body_preview ?? ''}

Previous draft reply:
${email.draft_reply ?? baseDraft}

New reply:`,
          }],
        }],
        generationConfig: { maxOutputTokens: 500, temperature: 0.9 },
      }),
    });

    const data = await res.json();
    const aiDraft = (data.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim();
    const newDraft = aiDraft || templateFallback;

    await supabaseAdmin.from('email_inbox').update({ draft_reply: newDraft }).eq('id', emailId);
    return newDraft;
  };

  const rephraseDraft = async (emailId: string, style: ReplyStyle): Promise<string> => {
    const { data: email } = await supabaseAdmin
      .from('email_inbox')
      .select('from_name, from_email, subject, category, draft_reply')
      .eq('id', emailId)
      .single();
    if (!email) throw new Error('Email not found');

    const styleInstructions: Record<ReplyStyle, string> = {
      standard: 'professional and balanced tone',
      formal:   'very formal official language, no contractions, use proper salutations',
      brief:    'extremely short — 2 to 3 sentences maximum',
      friendly: 'warm, empathetic and approachable tone with a personal touch',
    };

    const currentDraft = email.draft_reply ?? buildDraftReply(
      email.from_name ?? email.from_email,
      email.subject ?? '',
      email.category ?? 'general',
    );

    // Preferred path: VPS sidecar holds the LLM key and rephrases server-side.
    if (SIDECAR_URL) {
      try {
        const text = await sidecarCall('/rephrase', {
          fromName: email.from_name ?? email.from_email,
          subject: email.subject ?? '',
          category: email.category ?? 'general',
          draft: currentDraft,
          style,
        });
        await supabaseAdmin.from('email_inbox').update({ draft_reply: text }).eq('id', emailId);
        return text;
      } catch (e) {
        console.warn('Sidecar rephrase failed, falling back:', e);
        // fall through to direct Gemini / local template below
      }
    }

    const apiKey = import.meta.env.VITE_GEMINI_API_KEY as string | undefined;

    // No valid Gemini key — produce a free, local rephrase using the built-in
    // per-style templates instead of calling the API (which would 400).
    if (!hasValidGeminiKey(apiKey)) {
      const localRephrase = buildDraftReply(
        email.from_name ?? email.from_email,
        email.subject ?? '',
        email.category ?? 'general',
        style,
      );
      await supabaseAdmin.from('email_inbox').update({ draft_reply: localRephrase }).eq('id', emailId);
      return localRephrase;
    }

    const url = geminiGenerateContentUrl(apiKey, GEMINI_MODEL);
    const res = await geminiFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `You are a professional email assistant for Hope Hospital Billing Department.
Rephrase the following draft reply in a ${styleInstructions[style]} style.
Return ONLY the rephrased reply text — no subject line, no explanations, no extra commentary.

Original email subject: ${email.subject}
From: ${email.from_name ?? email.from_email}

Current draft reply:
${email.draft_reply ?? buildDraftReply(email.from_name ?? email.from_email, email.subject ?? '', email.category ?? 'general')}

Rephrased reply (${styleInstructions[style]}):`,
          }],
        }],
        generationConfig: { maxOutputTokens: 400, temperature: 0.7 },
      }),
    });

    const data = await res.json();
    const newDraft = (data.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim();
    if (!newDraft) throw new Error('Gemini returned empty response');

    await supabaseAdmin.from('email_inbox').update({ draft_reply: newDraft }).eq('id', emailId);
    return newDraft;
  };

  return { fetchInbox, checkMail, regenerateDraft, rephraseDraft };
}
