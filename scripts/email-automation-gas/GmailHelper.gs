// ─── LABEL HELPER ────────────────────────────────────────────────────────────

function applyHHLabel(thread, category) {
  var labelName = 'HH/' + category;
  var label = GmailApp.getUserLabelByName(labelName);
  if (!label) {
    label = GmailApp.createLabel(labelName);
  }
  thread.addLabel(label);
}

// ─── DRAFT CREATION ──────────────────────────────────────────────────────────
// Uses Gmail Advanced Service to create a draft inside the original thread.
// Requires: Services → Gmail API → enabled in the Apps Script editor.

function createThreadedDraft(email, replyBody) {
  var replySubject = email.subject.match(/^Re:/i) ? email.subject : 'Re: ' + email.subject;

  var rawLines = [
    'To: ' + email.from,
    'Subject: ' + replySubject,
    'Content-Type: text/plain; charset=utf-8',
    'MIME-Version: 1.0'
  ];
  if (email.messageId) {
    rawLines.push('In-Reply-To: ' + email.messageId);
    rawLines.push('References: ' + email.messageId);
  }
  rawLines.push('');
  rawLines.push(replyBody);

  var raw     = rawLines.join('\r\n');
  var encoded = Utilities.base64EncodeWebSafe(raw);

  Gmail.Users.Drafts.create(
    { message: { raw: encoded, threadId: email.threadId } },
    'me'
  );
}
