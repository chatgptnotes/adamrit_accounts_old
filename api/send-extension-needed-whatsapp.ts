import type { VercelRequest, VercelResponse } from '@vercel/node';
import { withRoute } from './_middleware.js';

const DOUBLETICK_URL = 'https://public.doubletick.io/whatsapp/message/template';
const TEMPLATE_NAME = 'extension_needed_patients_v1';
const LANGUAGE = 'en';

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

// Staff-only. Fires a WhatsApp template to the extension-alert recipient; open
// to the world it was a way to spam that number from the hospital's own sender.
export default withRoute({ auth: 'session', methods: ['POST'], rateLimit: { perMinute: 6, perHour: 60 } },
  async (req: VercelRequest, res: VercelResponse) => {
  const apiKey = process.env.DOUBLETICK_API_KEY || '';
  const from = process.env.DOUBLETICK_PHONE || '';
  const to = process.env.DOUBLETICK_EXTENSION_ALERT_TO || '';

  if (!apiKey || !from || !to) {
    return res.status(500).json({
      error: 'doubletick_not_configured',
      keys: {
        apiKey: Boolean(apiKey),
        from: Boolean(from),
        to: Boolean(to),
      },
    });
  }

  const reportDate = text(req.body?.reportDate);
  const patientList = text(req.body?.patientList);
  const extensionCount = Number(req.body?.extensionCount);

  if (!reportDate) {
    return res.status(400).json({ error: 'reportDate required' });
  }

  if (!patientList) {
    return res.status(400).json({ error: 'patientList required' });
  }

  if (!Number.isFinite(extensionCount) || extensionCount <= 0) {
    return res.status(400).json({ error: 'extensionCount must be greater than zero' });
  }

  const payload = {
    messages: [
      {
        to,
        from,
        content: {
          templateName: TEMPLATE_NAME,
          language: LANGUAGE,
          templateData: {
            header: { type: 'TEXT' },
            body: {
              placeholders: [
                'Billing Team',
                reportDate,
                patientList,
                String(extensionCount),
              ],
            },
          },
        },
      },
    ],
  };

  try {
    const upstream = await fetch(DOUBLETICK_URL, {
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
});
