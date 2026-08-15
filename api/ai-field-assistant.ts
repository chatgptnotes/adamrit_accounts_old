// Extract structured visit notes from a marketing field report.
//
// WAS COMPLETELY OPEN. Unauthenticated, unmetered, and it forwards whatever it
// is given to OpenAI on the hospital's OPENAI_API_KEY — a free GPT endpoint for
// anyone who found the URL, billed here. Now staff-only and capped.
//
// NOTE: no page in src/ calls this route. It may be dead; it is protected
// rather than deleted because that is not a decision to take by inference.
// Renamed from .js so it is covered by tsconfig.api.json like everything else.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { withRoute } from './_middleware.js';

export default withRoute({ auth: 'session', methods: ['POST'], rateLimit: { perMinute: 10, perHour: 100 } },
  async (req: VercelRequest, res: VercelResponse) => {
  const { message, photos } = req.body || {};
  if (typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'message required' });
  }
  
  const systemPrompt = `You are an AI field assistant for hospital marketing. Extract structured JSON from visit descriptions.

Structure:
- corporate: The organization/company name (WCL, ESIC, CGHS, ECHS, Central Railway, SECR, MPKAY, PM-JAY, MP Police, etc.)
- area: The geographical area/location/city (Chandrapur, Nagpur, Ballarpur, etc.)
- contactName: Name of person met (Dr. Sharma, CMO, etc.)
- designation: Their role/position
- conversation: Summary of what was discussed
- actionItems: Follow-up actions needed
- followUpDate: Next meeting date if mentioned (YYYY-MM-DD)
- followUpNeeded: true/false
- marketingStaff: Name of marketing person who visited (if mentioned)
- meetingDate: Date of visit (default today)

Return JSON:
{"corporate":null,"area":null,"contactName":null,"designation":null,"conversation":"","actionItems":null,"followUpDate":null,"followUpNeeded":false,"marketingStaff":null,"meetingDate":"${new Date().toISOString().split('T')[0]}","photoDescriptions":[]}

Known corporates: ESIC, WCL (Western Coalfields Limited), CGHS, ECHS, Central Railway, SECR, MPKAY, PM-JAY, MP Police.
Return ONLY valid JSON.`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: photos?.length ? `[${photos.length} photos attached] ${message}` : message }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3
      })
    });
    
    const data = await response.json() as {
      error?: { message?: string };
      choices?: { message?: { content?: string } }[];
    };
    
    if (data.error) {
      return res.status(500).json({ error: data.error.message });
    }
    
    const extracted = JSON.parse(data.choices[0].message.content);
    return res.json(extracted);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to process request' });
  }
});
