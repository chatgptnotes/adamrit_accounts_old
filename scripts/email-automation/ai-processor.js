'use strict';

const Anthropic = require('@anthropic-ai/sdk');
require('dotenv').config();

const client = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY });

// Cached system prompt — shared across all classify/draft calls in a single run
const SYSTEM_PROMPT = `You are a professional billing email assistant for the hospital billing department.
Your job is to help the billing team manage incoming emails efficiently and respond with warmth and professionalism.

Guidelines:
- Always maintain a professional, empathetic, and helpful tone.
- For document requests (bill copy, discharge summary, insurance letter): acknowledge and say it will be shared within 24 hours.
- For corporate billing queries: acknowledge receipt and say the corporate billing team will follow up within 1 business day.
- For approval requests: acknowledge and say it will be reviewed by the billing manager.
- For medical questions or symptoms: do NOT give medical advice. Direct the sender to call the hospital helpline.
- Never share or reference other patients' information.
- Sign off as "Hospital Billing Team".
- Keep replies concise — 3 to 6 sentences is usually enough.`;

// Billing-department categories
const CATEGORIES = ['document-request', 'corporate-query', 'approval-needed', 'interdepartmental', 'general'];

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
