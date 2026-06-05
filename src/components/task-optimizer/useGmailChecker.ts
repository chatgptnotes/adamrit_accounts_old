import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1';

export interface CheckMailResult {
  saved: number;
  skipped: number;
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

function extractTextBody(payload: Record<string, unknown>): string {
  const body = payload.body as { data?: string } | undefined;
  if (body?.data) return decodeBase64Url(body.data);

  const parts = payload.parts as Array<Record<string, unknown>> | undefined;
  if (!parts) return '';

  for (const part of parts) {
    if (part.mimeType === 'text/plain') {
      const pb = part.body as { data?: string } | undefined;
      if (pb?.data) return decodeBase64Url(pb.data);
    }
  }
  for (const part of parts) {
    if (part.mimeType === 'text/html') {
      const pb = part.body as { data?: string } | undefined;
      if (pb?.data) return decodeBase64Url(pb.data).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }
  }
  return '';
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

function buildDraftReply(fromName: string, subject: string, category: string): string {
  const greeting = `Dear ${fromName || 'Sir/Madam'},`;
  const closing  = `\n\nWarm regards,\nHope Hospital Billing Team\ninfo@hopehospital.com`;

  const bodies: Record<string, string> = {
    tpa:       `\n\nThank you for your email regarding "${subject}".\n\nWe have received your TPA/insurance query and our billing team is reviewing it. We will process the required documents and get back to you within 1 business day.\n\nIf you need immediate assistance, please call our billing helpdesk.`,
    corporate: `\n\nThank you for reaching out regarding "${subject}".\n\nWe have noted your query and our corporate billing team will follow up with you within 1 business day with the required information.\n\nPlease feel free to contact us if you need anything in the meantime.`,
    billing:   `\n\nThank you for your email regarding "${subject}".\n\nWe have received your billing query and will review your account. Our team will respond with the relevant details within 24 hours.\n\nFor urgent billing concerns, please contact our billing helpdesk directly.`,
    urgent:    `\n\nThank you for your email regarding "${subject}".\n\nWe understand this is an urgent matter and have escalated it to our billing manager for immediate attention. We will revert to you shortly.`,
    general:   `\n\nThank you for your email regarding "${subject}".\n\nWe have received your message and will respond within 1 business day.\n\nThank you for choosing Hope Hospital.`,
  };

  return greeting + (bodies[category] ?? bodies.general) + closing;
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

  const checkMail = async (): Promise<CheckMailResult> => {
    const token = await getToken();

    const listRes = await fetch(
      `${GMAIL_API}/users/me/messages?q=is:unread&maxResults=20`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!listRes.ok) {
      if (listRes.status === 401) setCachedToken(null);
      throw new Error(`Gmail fetch failed (${listRes.status})`);
    }
    const listData = await listRes.json();
    const messages: Array<{ id: string }> = listData.messages ?? [];

    const today = new Date().toISOString().split('T')[0];
    let saved = 0;
    let skipped = 0;

    for (const msg of messages) {
      const msgRes = await fetch(
        `${GMAIL_API}/users/me/messages/${msg.id}?format=full`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!msgRes.ok) continue;
      const msgData = await msgRes.json();

      const headers: Array<{ name: string; value: string }> =
        (msgData.payload as Record<string, unknown>)?.headers as Array<{ name: string; value: string }> ?? [];

      const subject    = getHeader(headers, 'Subject') || '(no subject)';
      const fromHeader = getHeader(headers, 'From');
      const fromEmail  = fromHeader.match(/<(.+)>/)?.[1] ?? fromHeader.trim();
      const fromName   = fromHeader.match(/^([^<]+)/)?.[1]?.trim() ?? fromEmail;
      const messageId  = getHeader(headers, 'Message-ID');
      const threadId   = (msgData as Record<string, unknown>).threadId as string ?? '';
      const body       = extractTextBody(msgData.payload as Record<string, unknown>);

      // Dedup: skip if already processed today
      const { count } = await supabase
        .from('email_inbox')
        .select('id', { count: 'exact', head: true })
        .eq('from_email', fromEmail)
        .eq('subject', subject)
        .eq('check_date', today);
      if ((count ?? 0) > 0) { skipped++; continue; }

      const { category, urgency } = classifyEmail(subject, body);
      const draftReply = buildDraftReply(fromName, subject, category);

      // 1. Create draft reply directly in Gmail Drafts folder
      await createGmailDraft(token, fromEmail, subject, draftReply, threadId, messageId);

      // 2. Save to Supabase for app UI display
      const { error: insertError } = await supabase.from('email_inbox').insert({
        from_email:   fromEmail,
        from_name:    fromName,
        subject,
        body_preview: body.slice(0, 400),
        category,
        urgency,
        draft_reply:  draftReply,
        status:       'pending',
        check_date:   today,
      });

      if (insertError) {
        console.warn('email_inbox insert failed:', insertError.message, insertError.code);
      }

      saved++;
    }

    return { saved, skipped };
  };

  const regenerateDraft = async (emailId: string, feedback?: string): Promise<string> => {
    const { data: email } = await supabase
      .from('email_inbox')
      .select('from_name, from_email, subject, category')
      .eq('id', emailId)
      .single();

    if (!email) throw new Error('Email not found');

    let newDraft = buildDraftReply(email.from_name ?? email.from_email, email.subject ?? '', email.category ?? 'general');
    if (feedback?.trim()) newDraft = `[Note: ${feedback.trim()}]\n\n${newDraft}`;

    await supabase.from('email_inbox').update({ draft_reply: newDraft }).eq('id', emailId);
    return newDraft;
  };

  return { checkMail, regenerateDraft };
}
