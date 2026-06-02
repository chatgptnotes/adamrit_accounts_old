// ─── ENTRY POINTS ────────────────────────────────────────────────────────────
// These are the two functions you attach to Time-driven triggers:
//   runMorningDigest  → 9:00 AM IST
//   runEveningDigest  → 5:00 PM IST

function runMorningDigest() {
  processEmails('Morning');
}

function runEveningDigest() {
  processEmails('Evening');
}

// ─── MAIN PIPELINE ───────────────────────────────────────────────────────────

function processEmails(runType) {
  var props = PropertiesService.getScriptProperties();
  var lastRunStr = props.getProperty('LAST_RUN');
  var sinceDate  = lastRunStr ? new Date(lastRunStr) : null;

  // Build Gmail search query
  var query = 'is:unread in:inbox';
  if (sinceDate) {
    var dateStr = Utilities.formatDate(sinceDate, 'Asia/Kolkata', 'yyyy/MM/dd');
    query += ' after:' + dateStr;
  }

  var threads = GmailApp.search(query, 0, 20);
  Logger.log(runType + ' Digest | ' + new Date().toLocaleString() + ' | ' + threads.length + ' thread(s)');

  if (threads.length === 0) {
    Logger.log('Inbox clear — nothing to process.');
    props.setProperty('LAST_RUN', new Date().toISOString());
    return;
  }

  var results = [];

  for (var i = 0; i < threads.length; i++) {
    var thread  = threads[i];
    var msgs    = thread.getMessages();
    var latest  = msgs[msgs.length - 1];

    var email = {
      subject:   thread.getFirstMessageSubject(),
      from:      latest.getFrom(),
      body:      latest.getPlainBody().substring(0, 2000),
      messageId: latest.getHeader('Message-ID'),
      threadId:  thread.getId()
    };

    try {
      var classification = classifyEmail(email.subject, email.body);
      var replyText      = draftReply(email, classification);

      applyHHLabel(thread, classification.category);
      createThreadedDraft(email, replyText);

      results.push({
        from:     email.from,
        category: classification.category,
        urgency:  classification.urgency,
        ok:       true
      });

      Logger.log('  ✓ ' + email.subject.substring(0, 50) + ' → ' + classification.category + ' [' + classification.urgency + ']');

    } catch (e) {
      Logger.log('  ✗ Error on "' + email.subject + '": ' + e.message);
      results.push({ from: email.from, category: 'error', urgency: 'low', ok: false });
    }
  }

  props.setProperty('LAST_RUN', new Date().toISOString());
  logSummary(runType, results);
}

// ─── SUMMARY LOG ─────────────────────────────────────────────────────────────

function logSummary(runType, results) {
  var high = results.filter(function(r) { return r.urgency === 'high'; }).length;
  Logger.log('');
  Logger.log('══════════════════════════════════════');
  Logger.log('  ' + runType + ' Digest — ' + results.length + ' processed');
  if (high > 0) Logger.log('  ⚠️  ' + high + ' HIGH urgency email(s)');
  Logger.log('  → Open Gmail Drafts, review, then Send');
  Logger.log('══════════════════════════════════════');
}
