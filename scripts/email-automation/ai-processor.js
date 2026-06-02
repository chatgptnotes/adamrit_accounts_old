'use strict';

const Anthropic = require('@anthropic-ai/sdk');
require('dotenv').config();

const client = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY });

// Cached system prompt — shared across all classify/draft calls in a single run
const SYSTEM_PROMPT = `You are a professional email assistant for Hope Hospital (info@hopehospital.com).
Your job is to help the hospital staff manage incoming emails efficiently and respond with warmth and professionalism.

Guidelines:
- Always maintain a professional, empathetic, and helpful tone.
- For medical questions or symptoms: do NOT give medical advice. Direct the sender to call the hospital or consult their doctor.
- For appointment requests: acknowledge and ask them to call reception or provide available slots if you know them.
- For billing/insurance questions: acknowledge and say the billing team will follow up.
- For lab report inquiries: acknowledge and direct them to contact the lab department.
- Never share or reference other patients' information.
- Sign off as "Hope Hospital Team".
- Keep replies concise — 3 to 6 sentences is usually enough.`;

const CATEGORIES = ['patient-inquiry', 'appointment', 'billing', 'lab-report', 'general'];

async function classifyEmail(subject, body) {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 200,
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' }
      }
    ],
    messages: [
      {
        role: 'user',
        content: `Classify this hospital email. Return ONLY a JSON object with these exact keys:
{
  "category": one of [${CATEGORIES.map(c => `"${c}"`).join(', ')}],
  "urgency": one of ["high", "medium", "low"],
  "summary": "one-sentence summary of what the sender needs"
}

Subject: ${subject}
Body: ${body.slice(0, 1000)}`
      }
    ]
  });

  try {
    const text = response.content[0].text.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : { category: 'general', urgency: 'low', summary: subject };
  } catch {
    return { category: 'general', urgency: 'low', summary: subject };
  }
}

async function draftReply(email, classification) {
  const { subject, from, body } = email;
  const { category, urgency } = classification;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 400,
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' }
      }
    ],
    messages: [
      {
        role: 'user',
        content: `Draft a reply to this email. Return ONLY the reply body text — no subject line, no "Dear ...", start directly with the greeting.

Category: ${category}
Urgency: ${urgency}
From: ${from}
Subject: ${subject}
Message: ${body.slice(0, 1500)}`
      }
    ]
  });

  return response.content[0].text.trim();
}

module.exports = { classifyEmail, draftReply };
