/**
 * CarbonRoute email sender: Google Apps Script web app (free, sends from your own Gmail).
 *
 * Setup (see docs/PERSISTENCE_AND_EMAIL.md, "Gmail through Apps Script"):
 *   1. script.google.com -> New project -> paste this file over Code.gs -> Save.
 *   2. Project Settings (gear) -> Script Properties -> Add property
 *        SECRET = a long random string (the same value goes into GMAIL_SCRIPT_SECRET on Render).
 *   3. Run "testSend" once from the editor and approve the Gmail permission (it emails you).
 *   4. Deploy -> New deployment -> type "Web app"; Execute as: Me; Who has access: Anyone -> Deploy.
 *      Copy the Web app URL (ends in /exec) into GMAIL_SCRIPT_URL on Render.
 *
 * The script sends only when the request carries the secret, and only CarbonRoute verification
 * emails (fixed subject, bounded size, one recipient).
 */

var SUBJECT = 'Your CarbonRoute verification code';

function doPost(e) {
  var req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return reply_({ ok: false, code: 'bad_request' });
  }
  var secret = PropertiesService.getScriptProperties().getProperty('SECRET');
  if (!secret || secret.length < 16 || req.secret !== secret) return reply_({ ok: false, code: 'unauthorized' });
  var to = String(req.to || '');
  if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(to) || to.length > 254) return reply_({ ok: false, code: 'invalid_recipient' });
  if (req.subject !== SUBJECT) return reply_({ ok: false, code: 'subject_not_allowed' });
  if (MailApp.getRemainingDailyQuota() < 1) return reply_({ ok: false, code: 'quota' });
  try {
    MailApp.sendEmail({
      to: to,
      subject: SUBJECT,
      body: String(req.text || '').slice(0, 4000),
      htmlBody: String(req.html || '').slice(0, 8000),
      name: String(req.fromName || 'CarbonRoute').slice(0, 60),
    });
  } catch (err) {
    return reply_({ ok: false, code: 'send_failed' });
  }
  return reply_({ ok: true });
}

/** Run once from the editor: grants the Gmail permission and emails you a test message. */
function testSend() {
  MailApp.sendEmail(Session.getActiveUser().getEmail(), 'CarbonRoute email test', 'The Apps Script sender works.');
}

function reply_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
