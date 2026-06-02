'use strict';

const { google } = require('googleapis');
require('dotenv').config();

function getOAuth2Client() {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    'urn:ietf:wg:oauth:2.0:oob'
  );
  oauth2Client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
  return oauth2Client;
}

function gmail() {
  return google.gmail({ version: 'v1', auth: getOAuth2Client() });
}

function parseEmailMessage(message) {
  const headers = message.payload.headers || [];
  const h = (name) => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';

  let body = '';
  const extractText = (parts) => {
    for (const part of parts || []) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return Buffer.from(part.body.data, 'base64').toString('utf-8');
      }
      if (part.parts) {
        const nested = extractText(part.parts);
        if (nested) return nested;
      }
    }
    return '';
  };

  if (message.payload.parts) {
    body = extractText(message.payload.parts);
    if (!body) {
      for (const part of message.payload.parts) {
        if (part.mimeType === 'text/html' && part.body?.data) {
          body = Buffer.from(part.body.data, 'base64').toString('utf-8')
            .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
          break;
        }
      }
    }
  } else if (message.payload.body?.data) {
    body = Buffer.from(message.payload.body.data, 'base64').toString('utf-8');
  }

  return {
    id: message.id,
    threadId: message.threadId,
    messageId: h('Message-ID'),
    subject: h('Subject'),
    from: h('From'),
    to: h('To'),
    date: h('Date'),
    body: body.slice(0, 2000)
  };
}

async function getUnreadEmails(sinceTimestamp, maxResults = 20) {
  const g = gmail();
  const userId = process.env.GMAIL_USER_EMAIL;

  let q = 'is:unread in:inbox';
  if (sinceTimestamp) {
    q += ` after:${Math.floor(sinceTimestamp / 1000)}`;
  }

  const listRes = await g.users.messages.list({ userId, q, maxResults });
  const messages = listRes.data.messages || [];
  if (messages.length === 0) return [];

  const emails = await Promise.all(
    messages.map(async (msg) => {
      const detail = await g.users.messages.get({ userId, id: msg.id, format: 'full' });
      return parseEmailMessage(detail.data);
    })
  );
  return emails;
}

async function ensureLabel(labelName) {
  const g = gmail();
  const userId = process.env.GMAIL_USER_EMAIL;

  const res = await g.users.labels.list({ userId });
  const existing = res.data.labels || [];
  const found = existing.find(l => l.name === labelName);
  if (found) return found.id;

  const created = await g.users.labels.create({
    userId,
    requestBody: { name: labelName, labelListVisibility: 'labelShow', messageListVisibility: 'show' }
  });
  return created.data.id;
}

async function applyLabel(messageId, labelName) {
  const g = gmail();
  const userId = process.env.GMAIL_USER_EMAIL;
  const labelId = await ensureLabel(labelName);

  await g.users.messages.modify({
    userId,
    id: messageId,
    requestBody: { addLabelIds: [labelId] }
  });
}

async function createDraft(email, replyBody) {
  const g = gmail();
  const userId = process.env.GMAIL_USER_EMAIL;
  const { from, subject, threadId, messageId } = email;

  const replySubject = subject.startsWith('Re:') ? subject : `Re: ${subject}`;
  const lines = [
    `From: ${userId}`,
    `To: ${from}`,
    `Subject: ${replySubject}`,
    'Content-Type: text/plain; charset=utf-8',
    'MIME-Version: 1.0'
  ];
  if (messageId) {
    lines.push(`In-Reply-To: ${messageId}`);
    lines.push(`References: ${messageId}`);
  }
  lines.push('');
  lines.push(replyBody);

  const raw = Buffer.from(lines.join('\r\n'))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  await g.users.drafts.create({
    userId,
    requestBody: { message: { raw, threadId } }
  });
}

module.exports = { getUnreadEmails, applyLabel, createDraft };
