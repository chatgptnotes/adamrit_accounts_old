// Send mail as the hospital's Gmail account.
//
// WHY NOT THE googleapis SDK
// scripts/email-automation/gmail-client.js uses it, but that is a local cron
// script where a 50MB dependency costs nothing. This runs in a Vercel function,
// where it would dominate the bundle and the cold start. The two REST calls
// below are the entire surface we need, so they are made with plain fetch.
//
// CREDENTIALS
// The same three values scripts/email-automation/setup-oauth.js already mints:
//   GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN
// plus GMAIL_USER_EMAIL for the From header. That refresh token is issued
// against the https://mail.google.com/ scope, which includes send.

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

export const gmailConfigured = (): boolean =>
  Boolean(process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN);

/** Exchange the long-lived refresh token for a short-lived access token. */
async function accessToken(): Promise<string> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GMAIL_CLIENT_ID || '',
      client_secret: process.env.GMAIL_CLIENT_SECRET || '',
      refresh_token: process.env.GMAIL_REFRESH_TOKEN || '',
      grant_type: 'refresh_token',
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.access_token) {
    // Surfaced rather than swallowed: a revoked or expired refresh token is
    // otherwise silent, and the only symptom is that nobody gets their code.
    throw new Error(`gmail_token_failed:${payload?.error || response.status}`);
  }
  return String(payload.access_token);
}

/**
 * RFC 2822 message, base64url encoded as the Gmail API expects.
 *
 * Non-ASCII subjects are encoded-word wrapped and the body is sent base64, so a
 * name with an accent does not arrive as mojibake.
 */
function buildRawMessage(to: string, subject: string, html: string, from: string): string {
  const encodedSubject = /^[\x20-\x7E]*$/.test(subject)
    ? subject
    : `=?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`;

  const message = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodedSubject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(html, 'utf8').toString('base64'),
  ].join('\r\n');

  return Buffer.from(message, 'utf8').toString('base64url');
}

export async function sendMail(to: string, subject: string, html: string): Promise<void> {
  if (!gmailConfigured()) throw new Error('gmail_not_configured');

  const sender = process.env.GMAIL_USER_EMAIL || 'info@hopehospital.com';
  const token = await accessToken();

  const response = await fetch(SEND_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw: buildRawMessage(to, subject, html, sender) }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`gmail_send_failed:${response.status}:${detail.slice(0, 200)}`);
  }
}
