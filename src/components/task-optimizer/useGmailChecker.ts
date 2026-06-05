import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1';
const OPENAI_API = 'https://api.openai.com/v1/chat/completions';

const SYSTEM_PROMPT = `You are a professional billing email assistant for Hope Hospital billing department.
Guidelines:
- Always maintain a professional, empathetic, and helpful tone.
- For document requests (bill copy, discharge summary, insurance letter): acknowledge and say it will be shared within 24 hours.
- For corporate billing queries: acknowledge receipt and say the billing team will follow up within 1 business day.
- For approval requests: say it will be reviewed by the billing manager.
- Never share other patients' information.
- Sign off as "Hope Hospital Billing Team".
- Keep replies concise — 3 to 6 sentences.`;

export interface CheckMailResult {
  saved: number;
  skipped: number;
}

// Exchange the stored refresh token for a short-lived access token.
// No OAuth popup needed — uses credentials already configured.
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
  if (!data.access_token) throw new Error(data.error_description ?? 'Failed to get Gmail access token');
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

async function fetchFormatExamples(): Promise<string> {
  const { data } = await supabase
    .from('email_inbox')
    .select('subject, draft_reply')
    .eq('status', 'approved')
    .not('draft_reply', 'is', null)
    .order('approved_at', { ascending: false })
    .limit(5);

  if (!data?.length) return '';
  return '\n\nPreviously approved reply formats — match this tone and structure:\n' +
    data.map((e, i) => `--- Example ${i + 1} ---\nSubject: ${e.subject}\nReply: ${e.draft_reply}`).join('\n\n');
}

export function useGmailChecker() {
  const [cachedToken, setCachedToken] = useState<string | null>(null);

  const getToken = async (): Promise<string> => {
    if (cachedToken) return cachedToken;
    const token = await getGmailAccessToken();
    setCachedToken(token);
    // Access tokens expire in 1 hour — clear cache after 55 min
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

    const formatSection = await fetchFormatExamples();
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

      const subject   = getHeader(headers, 'Subject') || '(no subject)';
      const fromHeader = getHeader(headers, 'From');
      const fromEmail  = fromHeader.match(/<(.+)>/)?.[1] ?? fromHeader.trim();
      const fromName   = fromHeader.match(/^([^<]+)/)?.[1]?.trim() ?? fromEmail;
      const body       = extractTextBody(msgData.payload as Record<string, unknown>);

      // Dedup: skip if already saved today for this sender+subject
      const { count } = await supabase
        .from('email_inbox')
        .select('id', { count: 'exact', head: true })
        .eq('from_email', fromEmail)
        .eq('subject', subject)
        .eq('check_date', today);
      if ((count ?? 0) > 0) { skipped++; continue; }

      // OpenAI: classify + draft in one call
      const openaiRes = await fetch(OPENAI_API, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${import.meta.env.VITE_OPENAI_API_KEY as string}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: SYSTEM_PROMPT + formatSection },
            {
              role: 'user',
              content: `Analyze this email. Return ONLY valid JSON, no markdown:
{
  "category": one of ["billing","corporate","tpa","general","urgent"],
  "urgency": one of ["high","medium","low"],
  "draft_reply": "complete reply text"
}

From: ${fromName} <${fromEmail}>
Subject: ${subject}
Message: ${body.slice(0, 1200)}`,
            },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.3,
        }),
      });

      let category   = 'general';
      let urgency    = 'low';
      let draftReply = '';

      if (openaiRes.ok) {
        const aiData = await openaiRes.json();
        try {
          const parsed = JSON.parse(aiData.choices?.[0]?.message?.content ?? '{}');
          const allowedCategories = ['billing', 'corporate', 'tpa', 'appointment', 'general', 'urgent'];
          category   = allowedCategories.includes(parsed.category) ? parsed.category : 'general';
          urgency    = ['high', 'medium', 'low'].includes(parsed.urgency) ? parsed.urgency : 'low';
          draftReply = typeof parsed.draft_reply === 'string' ? parsed.draft_reply : '';
        } catch { /* keep defaults */ }
      }

      await supabase.from('email_inbox').insert({
        from_email:   fromEmail,
        from_name:    fromName,
        subject,
        body_preview: body.slice(0, 400),
        category,
        urgency,
        draft_reply:  draftReply,
        status:       'pending',
        check_date:   today,
        // check_run intentionally NULL — manual trigger
      });
      saved++;
    }

    return { saved, skipped };
  };

  const regenerateDraft = async (emailId: string, feedback?: string): Promise<string> => {
    const { data: email } = await supabase
      .from('email_inbox')
      .select('from_name, from_email, subject, body_preview, category, urgency')
      .eq('id', emailId)
      .single();

    if (!email) throw new Error('Email not found');

    const formatSection = await fetchFormatExamples();
    const feedbackNote  = feedback?.trim() ? `\n\nHuman feedback: "${feedback.trim()}"` : '';

    const openaiRes = await fetch(OPENAI_API, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${import.meta.env.VITE_OPENAI_API_KEY as string}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT + formatSection },
          {
            role: 'user',
            content: `Draft a reply to this email. Return ONLY the reply text — no subject line, start with greeting.

Category: ${email.category ?? 'general'}
Urgency: ${email.urgency ?? 'low'}
From: ${email.from_name ?? email.from_email} <${email.from_email}>
Subject: ${email.subject}
Message preview: ${email.body_preview ?? ''}${feedbackNote}`,
          },
        ],
        temperature: 0.5,
      }),
    });

    if (!openaiRes.ok) throw new Error(`OpenAI error: ${openaiRes.status}`);
    const aiData   = await openaiRes.json();
    const newDraft = (aiData.choices?.[0]?.message?.content ?? '').trim();
    if (!newDraft) throw new Error('AI returned empty draft');

    await supabase.from('email_inbox').update({ draft_reply: newDraft }).eq('id', emailId);
    return newDraft;
  };

  return { checkMail, regenerateDraft };
}
