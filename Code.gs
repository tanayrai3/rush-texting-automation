// Rush texting automation — sends personalized event texts to PNMs via Twilio.
// Setup: run "Rush Texting > Set Up Twilio Credentials" from the sheet menu once,
// then adjust FIRST_NAME_COLUMN_HEADER / PHONE_COLUMN_HEADER below to match your form's
// actual question titles (these become the column headers in the response sheet).

const TWILIO_SID_PROP = 'TWILIO_ACCOUNT_SID';
const TWILIO_TOKEN_PROP = 'TWILIO_AUTH_TOKEN';
const TWILIO_FROM_PROP = 'TWILIO_FROM_NUMBER';

const FIRST_NAME_COLUMN_HEADER = 'First Name';
const PHONE_COLUMN_HEADER = 'Phone Number';

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Rush Texting')
    .addItem('Send Event Text...', 'showSendEventDialog')
    .addItem('Set Up Twilio Credentials', 'showCredentialsDialog')
    .addToUi();
}

function showCredentialsDialog() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();

  const sidResp = ui.prompt('Twilio Setup (1/3)', 'Enter your Twilio Account SID:', ui.ButtonSet.OK_CANCEL);
  if (sidResp.getSelectedButton() !== ui.Button.OK) return;

  const tokenResp = ui.prompt('Twilio Setup (2/3)', 'Enter your Twilio Auth Token:', ui.ButtonSet.OK_CANCEL);
  if (tokenResp.getSelectedButton() !== ui.Button.OK) return;

  const fromResp = ui.prompt('Twilio Setup (3/3)', 'Enter your Twilio phone number, E.164 format (e.g. +18005551234):', ui.ButtonSet.OK_CANCEL);
  if (fromResp.getSelectedButton() !== ui.Button.OK) return;

  props.setProperties({
    [TWILIO_SID_PROP]: sidResp.getResponseText().trim(),
    [TWILIO_TOKEN_PROP]: tokenResp.getResponseText().trim(),
    [TWILIO_FROM_PROP]: fromResp.getResponseText().trim(),
  });

  ui.alert('Twilio credentials saved. Only people with edit access to this sheet\'s Apps Script project can view them.');
}

function showSendEventDialog() {
  const html = HtmlService.createHtmlOutputFromFile('SendDialog')
    .setWidth(480)
    .setHeight(440);
  SpreadsheetApp.getUi().showModalDialog(html, 'Send Event Text');
}

function normalizePhone(raw) {
  const str = String(raw).trim();
  const digits = str.startsWith('+') ? str.slice(1).replace(/\D/g, '') : str.replace(/\D/g, '');

  let national;
  if (digits.length === 10) {
    national = digits;
  } else if (digits.length === 11 && digits.startsWith('1')) {
    national = digits.slice(1);
  } else {
    return null;
  }

  const areaCode = national.slice(0, 3);
  if (/^[01]/.test(areaCode)) return null; // real US area codes never start with 0 or 1
  if (/^(\d)\1{9}$/.test(national)) return null; // all same digit, e.g. 1111111111
  if (national === '1234567890' || national === '0123456789') return null; // sequential joke entries

  return '+1' + national;
}

function sendTwilioSms(to, body) {
  const props = PropertiesService.getScriptProperties();
  const sid = props.getProperty(TWILIO_SID_PROP);
  const token = props.getProperty(TWILIO_TOKEN_PROP);
  const from = props.getProperty(TWILIO_FROM_PROP);

  if (!sid || !token || !from) {
    throw new Error('Twilio credentials not set. Run "Set Up Twilio Credentials" from the Rush Texting menu first.');
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  const options = {
    method: 'post',
    payload: { To: to, From: from, Body: body },
    headers: { Authorization: 'Basic ' + Utilities.base64Encode(`${sid}:${token}`) },
    muteHttpExceptions: true,
  };

  const response = UrlFetchApp.fetch(url, options);
  const code = response.getResponseCode();
  if (code >= 300) {
    throw new Error(`Twilio error (${code}): ${response.getContentText()}`);
  }
}

function sendEventBlast(eventLabel, template) {
  const sheet = SpreadsheetApp.getActiveSheet();
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(h => String(h).trim());

  const nameCol = headers.indexOf(FIRST_NAME_COLUMN_HEADER.trim());
  const phoneCol = headers.indexOf(PHONE_COLUMN_HEADER.trim());
  if (nameCol === -1 || phoneCol === -1) {
    throw new Error(`Could not find a "${FIRST_NAME_COLUMN_HEADER}" or "${PHONE_COLUMN_HEADER}" column. Actual headers found: [${headers.join(', ')}]. Update FIRST_NAME_COLUMN_HEADER / PHONE_COLUMN_HEADER at the top of Code.gs to match your sheet's actual headers.`);
  }

  const sentHeader = `Sent: ${eventLabel}`;
  let sentCol = headers.indexOf(sentHeader);
  if (sentCol === -1) {
    sentCol = headers.length;
    sheet.getRange(1, sentCol + 1).setValue(sentHeader);
  }

  // Dedupe by phone number (not just row) so duplicate form submissions from the
  // same person don't get texted twice for the same event.
  const alreadyTextedPhones = new Set();
  for (let row = 1; row < data.length; row++) {
    if (data[row][sentCol]) {
      const p = normalizePhone(data[row][phoneCol]);
      if (p) alreadyTextedPhones.add(p);
    }
  }

  let sentCount = 0;
  let skipCount = 0;
  let failCount = 0;
  const failures = [];

  for (let row = 1; row < data.length; row++) {
    if (data[row][sentCol]) { skipCount++; continue; }

    const rawPhone = data[row][phoneCol];
    const rawName = data[row][nameCol];
    if (!rawPhone || !rawName) { skipCount++; continue; }

    const phone = normalizePhone(rawPhone);
    if (!phone) {
      failCount++;
      failures.push(`Row ${row + 1}: invalid phone "${rawPhone}"`);
      continue;
    }

    if (alreadyTextedPhones.has(phone)) {
      sheet.getRange(row + 1, sentCol + 1).setValue('Duplicate - skipped');
      skipCount++;
      continue;
    }

    const firstName = String(rawName).trim();
    const message = template.replace(/\{first_name\}/g, firstName);

    try {
      sendTwilioSms(phone, message);
      sheet.getRange(row + 1, sentCol + 1).setValue(new Date());
      alreadyTextedPhones.add(phone);
      sentCount++;
    } catch (e) {
      failCount++;
      failures.push(`Row ${row + 1} (${rawName}): ${e.message}`);
    }

    Utilities.sleep(300);
  }

  let summary = `Sent: ${sentCount}\nSkipped (already sent / duplicate / missing data): ${skipCount}\nFailed: ${failCount}`;
  if (failures.length) summary += '\n\nFailures:\n' + failures.slice(0, 10).join('\n');
  return summary;
}
