'use strict';

// ---------------------------------------------------------------------------
// Keyword-based email classifier — zero API calls, completely free
// ---------------------------------------------------------------------------

// Emails matching these are skipped — no draft created
const SKIP_RULES = [
  'unsubscribe', 'newsletter', 'weekly digest', 'this week',
  'noreply', 'no-reply', 'donotreply', 'do-not-reply',
  'notification', 'alert', 'your account', 'login', 'sign in',
  'otp', 'verification code', 'confirmation code', 'security alert',
  'paused', 'supabase', 'github', 'linkedin', 'twitter', 'uber',
  'naukri', 'swiggy', 'zomato', 'amazon', 'flipkart', 'youtube',
  'medium.com', 'substack', 'mailchimp', 'promotional', 'offer',
  'discount', 'sale', 'deal', 'free trial', 'chatgpt', 'openai'
];

const RULES = [
  {
    category: 'document-request',
    keywords: [
      'bill copy', 'final bill', 'invoice', 'discharge summary',
      'statement', 'receipt', 'payment receipt', 'detailed bill',
      'certificate', 'report copy', 'send bill', 'share bill',
      'need bill', 'require bill', 'medical certificate', 'bills send',
      'bill chahiye', 'bill bhejo', 'summary bhejo'
    ]
  },
  {
    category: 'corporate-query',
    keywords: [
      'corporate', 'tpa', 'insurance', 'claim', 'authorization',
      'approval letter', 'auth letter', 'empanelled', 'empanelment',
      'cashless', 'reimbursement', 'policy', 'insured', 'echs', 'cghs',
      'esic', 'medclaim', 'health card', 'mediclaim', 'ihx'
    ]
  },
  {
    category: 'approval-needed',
    keywords: [
      'approve', 'approval', 'extension', 'extend stay',
      'conservative', 'please approve', 'kindly approve', 'authorize',
      'sanction', 'clearance', 'preauth', 'pre-auth', 'pre auth',
      'extend admission', 'stay extension'
    ]
  },
  {
    category: 'patient-query',
    keywords: [
      'patient', 'admitted', 'admission', 'discharge', 'doctor',
      'treatment', 'medicine', 'hospital', 'ward', 'ipd', 'opd',
      'billing query', 'billing question', 'charges', 'amount',
      'how much', 'payment', 'fees', 'deposit', 'advance'
    ]
  }
];

const TEMPLATES = {
  'document-request': `Thank you for reaching out to the Hospital Billing Department.

We have received your request for the billing document. Our team will prepare and share the requested document within 24 working hours.

If you need it urgently, please call our billing helpline and mention your patient name and visit date.

Regards,
Hospital Billing Team`,

  'corporate-query': `Thank you for contacting the Hospital Billing Department.

We have received your query regarding the corporate/insurance billing. Our corporate billing team will review your request and get back to you within 1 business day.

Please ensure you have shared the authorization letter and patient details for faster processing.

Regards,
Hospital Billing Team`,

  'approval-needed': `Thank you for your message.

We have received your approval request and it has been forwarded to the Billing Manager for review. You will receive a response within 4 working hours.

For urgent cases, please contact the billing office directly.

Regards,
Hospital Billing Team`,

  'interdepartmental': `Thank you for your message.

Your request has been noted and forwarded to the concerned department. They will coordinate with you directly.

Regards,
Hospital Billing Team`,

  'general': `Thank you for contacting the Hospital Billing Department.

We have received your message and our team will review it and respond shortly. If your matter is urgent, please call the billing helpline directly.

Regards,
Hospital Billing Team`
};

function classifyEmail(subject, body) {
  const text = `${subject} ${body}`.toLowerCase();

  // Skip newsletters, notifications, spam — no draft needed
  for (const skipWord of SKIP_RULES) {
    if (text.includes(skipWord)) {
      return {
        category: 'skip',
        urgency: 'low',
        summary: `Skipped — matched skip rule "${skipWord}"`
      };
    }
  }

  for (const rule of RULES) {
    for (const keyword of rule.keywords) {
      if (text.includes(keyword)) {
        return {
          category: rule.category,
          urgency: detectUrgency(text),
          summary: `Matched keyword "${keyword}" in email`
        };
      }
    }
  }

  return {
    category: 'skip',
    urgency: 'low',
    summary: 'No billing keyword matched — skipped'
  };
}

function detectUrgency(text) {
  const highKeywords = ['urgent', 'emergency', 'immediately', 'asap', 'critical', 'today', 'dying', 'icu'];
  const mediumKeywords = ['soon', 'quickly', 'as early as possible', 'priority', 'important'];

  if (highKeywords.some(k => text.includes(k))) return 'high';
  if (mediumKeywords.some(k => text.includes(k))) return 'medium';
  return 'low';
}

function draftReply(email, classification) {
  return TEMPLATES[classification.category] || TEMPLATES['general'];
}

module.exports = { classifyEmail, draftReply };
