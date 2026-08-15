// TwiML handed to Twilio when a conference leg connects.
//
// WHY THIS ONE STAYS OPEN
// Twilio's servers fetch it, from their own IP ranges, with no credential we
// issued. It returns a fixed instruction document: no patient data, no secret,
// and no cost to serve. There is nothing here worth authenticating.
//
// The room name is escaped because it is the one caller-controlled value that
// reaches the XML. Unescaped, a crafted `room` could close the <Conference>
// element early and append instructions of its own — dialling out, say — and
// Twilio would carry them out as though the hospital had asked.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { withRoute } from './_middleware.js';

const escapeXml = (value: string) =>
  value.replace(/[<>&'"]/g, (c) => (
    { '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c] as string
  ));

export default withRoute(
  {
    auth: 'public',
    why: 'Twilio fetches this during a call and cannot present a credential. It returns a fixed TwiML document containing no patient data and no secret.',
    methods: ['GET', 'POST'],
    rateLimit: { perMinute: 60, perHour: 1000 },
  },
  (req: VercelRequest, res: VercelResponse) => {
    const raw = typeof req.query.room === 'string' ? req.query.room : 'HopeConference';
    // Conference names are ours: alphanumerics, dash and underscore. Anything
    // else is not a room we created.
    const room = escapeXml(/^[A-Za-z0-9_-]{1,64}$/.test(raw) ? raw : 'HopeConference');

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Connecting you to the Hope Hospital conference call. Please wait.</Say>
  <Dial>
    <Conference
      startConferenceOnEnter="true"
      endConferenceOnExit="false"
      waitUrl="http://twimlets.com/holdmusic?Bucket=com.twilio.music.classical"
    >${room}</Conference>
  </Dial>
</Response>`;

    res.setHeader('Content-Type', 'text/xml');
    res.send(twiml);
  },
);
