import type { VercelRequest, VercelResponse } from '@vercel/node';
import { withRoute } from './_middleware.js';

const SUPABASE_URL = 'https://xvkxccqaopbnkvwgyfjv.supabase.co';
const TWIML_URL = 'https://adamrit.com/api/twilio-twiml';
const WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886';

// Staff-only: this dials two real phone numbers and bridges them, billed to the
// hospital. It was previously open to anyone who knew the path.
export default withRoute({ auth: 'session', methods: ['POST'], rateLimit: { perMinute: 6, perHour: 60 } },
  async (req: VercelRequest, res: VercelResponse) => {
  try {
    const {
      visitId,
      patientName,
      referringDoctorName,
      referringDoctorPhone,
      ourDoctorName,
      ourDoctorPhone,
      delayMinutes = 0,
    } = (req.body as any) || {};

    if (!referringDoctorPhone || !ourDoctorPhone) {
      return res.status(400).json({ error: 'Both doctor phone numbers are required' });
    }

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const twilioPhone = process.env.TWILIO_PHONE_NUMBER;

    if (!accountSid || !authToken || !twilioPhone) {
      return res.status(500).json({ error: 'Twilio credentials not configured', keys: { accountSid: !!accountSid, authToken: !!authToken, twilioPhone: !!twilioPhone } });
    }

    const twilioLib = await import('twilio');
    const twilio = twilioLib.default;
    const client = twilio(accountSid, authToken);

    const conferenceRoom = `HopeConf-${Date.now()}`;
    const fmt = (phone: string) => phone.startsWith('+') ? phone : `+91${phone.replace(/\D/g, '')}`;
    const refPhone = fmt(referringDoctorPhone);
    const ourPhone = fmt(ourDoctorPhone);
    const twimlUrl = `${TWIML_URL}?room=${encodeURIComponent(conferenceRoom)}`;

    // WhatsApp notify (non-fatal)
    let whatsappSent = false;
    try {
      const msg = delayMinutes > 0
        ? `Hello ${ourDoctorName}, conference call with Dr. ${referringDoctorName} re: ${patientName || 'patient'} in ${delayMinutes} min(s). Please be available. - Hope Hospital`
        : `Hello ${ourDoctorName}, connecting conference call with Dr. ${referringDoctorName} re: ${patientName || 'patient'} now. Please pick up. - Hope Hospital`;
      await client.messages.create({ from: WHATSAPP_FROM, to: `whatsapp:${ourPhone}`, body: msg });
      whatsappSent = true;
    } catch (e: any) {
      console.error('WhatsApp failed (non-fatal):', e.message);
    }

    // Initiate calls
    let call1: any, call2: any;
    try {
      call1 = await client.calls.create({ url: twimlUrl, to: refPhone, from: twilioPhone });
      call2 = await client.calls.create({ url: twimlUrl, to: ourPhone, from: twilioPhone });
    } catch (e: any) {
      return res.status(500).json({ error: 'Twilio call failed', detail: e.message, code: e.code });
    }

    // Log to Supabase (non-fatal)
    try {
      const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (sbKey) {
        const { createClient } = await import('@supabase/supabase-js');
        const sb = createClient(SUPABASE_URL, sbKey);
        await sb.from('call_logs').insert({
          visit_id: visitId || null,
          patient_name: patientName || null,
          referring_doctor_name: referringDoctorName,
          referring_doctor_phone: refPhone,
          our_doctor_name: ourDoctorName,
          our_doctor_phone: ourPhone,
          conference_room: conferenceRoom,
          delay_minutes: delayMinutes,
          status: 'initiated',
          whatsapp_notified: whatsappSent,
        });
      }
    } catch (e: any) {
      console.error('Supabase log failed (non-fatal):', e.message);
    }

    return res.json({
      success: true,
      conferenceRoom,
      callSids: [call1.sid, call2.sid],
      whatsappNotified: whatsappSent,
      message: `Conference call initiated between ${ourDoctorName} and Dr. ${referringDoctorName}`,
    });

  } catch (e: any) {
    // The stack trace used to be returned to the caller, which named internal
    // paths and env vars. It is logged instead; withRoute puts a request id on
    // the response so a report can still be traced to the exact invocation.
    console.error('[twilio-conference]', e?.stack || e?.message);
    return res.status(500).json({ error: 'conference_failed', detail: e?.message });
  }
});
