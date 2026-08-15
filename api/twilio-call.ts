// Place a referral follow-up call from the hospital's Twilio number.
//
// WHY THE GUARD MATTERS HERE
// This route used to accept any POST from anywhere, and answered with
// Access-Control-Allow-Origin: *, so any web page could hand it a phone number
// and Hope Hospital would dial it — billed to the hospital's Twilio account,
// and arriving at the recipient with the hospital's caller ID. It is now
// staff-only, and the number it dialled is written to call_logs against the
// person who asked for it.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { withRoute, sendError, text, type RouteContext } from './_middleware.js';

const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID || '';
const TWILIO_AUTH = process.env.TWILIO_AUTH_TOKEN || '';
const TWILIO_FROM = process.env.TWILIO_PHONE_NUMBER || '';

const GREETING = 'Hello, this is a call from Hope Hospital Nagpur. Dr Murali team is calling for a referral follow-up. Thank you for your support. Please call us back on 0712 2220000.';

export default withRoute({ auth: 'session', methods: ['POST'], rateLimit: { perMinute: 6, perHour: 60 } },
  async (req: VercelRequest, res: VercelResponse, ctx: RouteContext) => {
    if (!TWILIO_SID || !TWILIO_AUTH || !TWILIO_FROM) {
      return sendError(res, 500, 'twilio_not_configured');
    }

    const { person_id, person_name, call_type = 'manual' } = req.body || {};
    const to = text(req.body?.to);
    if (!to) return sendError(res, 400, 'phone_number_required');

    // Indian numbers, entered by staff in whatever shape they were written down.
    let toNumber = to.replace(/\s+/g, '').replace(/^0/, '');
    if (!toNumber.startsWith('+')) toNumber = '+91' + toNumber.replace(/^91/, '');
    if (!/^\+\d{10,15}$/.test(toNumber)) return sendError(res, 400, 'invalid_phone_number');

    const twilio = (await import('twilio')).default;
    const client = twilio(TWILIO_SID, TWILIO_AUTH);
    const call = await client.calls.create({
      to: toNumber,
      from: TWILIO_FROM,
      twiml: `<Response><Say voice="alice" language="en-IN">${GREETING}</Say></Response>`,
    });

    try {
      await ctx.sb.from('call_logs').insert({
        person_id,
        person_name,
        phone_number: toNumber,
        call_sid: call.sid,
        call_status: call.status,
        call_type,
        initiated_at: new Date().toISOString(),
        // Who asked for the call. Without this a disputed call has no owner.
        // handled_by is the existing text column for this; there is no
        // initiated_by on call_logs, whatever the name symmetry suggests.
        handled_by: ctx.user?.email ?? null,
      });
    } catch {
      // A call that was placed but not logged is still a call that was placed;
      // saying otherwise would have the caller dial again.
    }

    return res.status(200).json({ ok: true, call_sid: call.sid, status: call.status, to: toNumber });
  });
