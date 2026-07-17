import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomUUID } from 'node:crypto';

const DOUBLETICK_DOCUMENT_URL = 'https://public.doubletick.io/whatsapp/message/document';

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const normalizeWhatsAppNumber = (value: string) => {
  const digits = value.replace(/\D/g, '').replace(/^0+/, '');
  if (digits.length === 10) return `91${digits}`;
  return digits;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const apiKey = process.env.DOUBLETICK_API_KEY || '';
  const from = process.env.DOUBLETICK_PHONE || '';

  if (!apiKey || !from) {
    return res.status(500).json({
      error: 'doubletick_not_configured',
      keys: {
        apiKey: Boolean(apiKey),
        from: Boolean(from),
      },
    });
  }

  const to = normalizeWhatsAppNumber(text(req.body?.to));
  const mediaUrl = text(req.body?.mediaUrl);
  const filename = text(req.body?.filename) || 'Discharge_Documents.pdf';
  const caption = text(req.body?.caption);

  if (!/^\d{10,15}$/.test(to)) {
    return res.status(400).json({ error: 'valid WhatsApp number required' });
  }

  if (!/^https?:\/\//i.test(mediaUrl)) {
    return res.status(400).json({ error: 'public mediaUrl required' });
  }

  const payload = {
    to,
    from,
    messageId: randomUUID(),
    content: {
      mediaUrl,
      caption,
      filename,
    },
  };

  try {
    const upstream = await fetch(DOUBLETICK_DOCUMENT_URL, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        Authorization: apiKey,
      },
      body: JSON.stringify(payload),
    });

    const raw = await upstream.text();
    let body: unknown = raw;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      body = raw.slice(0, 1000);
    }

    if (!upstream.ok) {
      return res.status(502).json({
        error: 'doubletick_send_failed',
        status: upstream.status,
        detail: body,
      });
    }

    return res.status(200).json({
      ok: true,
      status: upstream.status,
      response: body,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'unknown';
    return res.status(502).json({ error: 'doubletick_unreachable', detail: message });
  }
}
