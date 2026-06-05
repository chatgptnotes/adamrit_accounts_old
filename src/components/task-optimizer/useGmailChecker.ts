import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { supabaseAdmin } from '@/integrations/supabase/adminClient';
import { geminiFetch, geminiGenerateContentUrl, GEMINI_MODEL } from '@/lib/gemini';

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
      `${GMAIL_API}/users/me/messages?maxResults=50`,
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
      const gmailMsgId = msg.id; // Gmail's internal unique ID — permanent dedup key
      const threadId   = (msgData as Record<string, unknown>).threadId as string ?? '';
      const body       = extractTextBody(msgData.payload as Record<string, unknown>);

      // Check if this Gmail message was already saved (using gmail message ID stored in approved_by)
      const { data: existing } = await supabaseAdmin
        .from('email_inbox')
        .select('id, body_preview')
        .eq('approved_by', `gmailid:${gmailMsgId}`)
        .single();

      if (existing) {
        // Already saved — update body if it was previously truncated
        if (!existing.body_preview || existing.body_preview.length < body.length) {
          await supabaseAdmin
            .from('email_inbox')
            .update({ body_preview: body })
            .eq('id', existing.id);
        }
        skipped++;
        continue;
      }

      const { category, urgency } = classifyEmail(subject, body);
      const draftReply = buildDraftReply(fromName, subject, category);

      // 1. Create draft reply directly in Gmail Drafts folder
      await createGmailDraft(token, fromEmail, subject, draftReply, threadId, messageId);

      // 2. Save to Supabase (approved_by stores gmail message ID for permanent dedup)
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
        approved_by:  `gmailid:${gmailMsgId}`,
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

    const url = geminiGenerateContentUrl(import.meta.env.VITE_GEMINI_API_KEY as string, GEMINI_MODEL);
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

  return { checkMail, regenerateDraft, rephraseDraft };
}
